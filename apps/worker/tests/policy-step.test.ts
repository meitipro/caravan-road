// Finding 1: set_policy moves each of spread_bp / bias_bp by at most 300 bp from the CURRENT policy, at most
// once per tick (contracts/caravan/src/admin.rs try_set_policy). The worker must clamp toward its target,
// record what it really sent, and keep shipping even when set_policy fails.

import { describe, expect, it, vi } from "vitest";
import { PARAMS, type CityId } from "@caravan/shared";
import type { ModelClient, ModelReply } from "../src/brain.js";
import { baselineBias, baselineSpread } from "../src/baseline.js";
import { policyStepOk, stepPolicyToward, stepToward } from "../src/contract-rules.js";
import { StockHistory } from "../src/features.js";
import { MemoryStore } from "../src/memory-store.js";
import { runMerchantOnce, type MerchantMemory, type RunDeps } from "../src/run-once.js";
import { SimWorld } from "../src/sim-world.js";
import { simulate } from "../src/simulate.js";
import { FakeModel } from "../src/fake/fake-model.js";
import { silentLogger } from "../src/types.js";

describe("stepToward / stepPolicyToward", () => {
  it("moves at most 300 toward the target, in both directions, and lands exactly when close", () => {
    expect(stepToward(800, 1800, 400, 2000)).toBe(1100);
    expect(stepToward(1800, 800, 400, 2000)).toBe(1500);
    expect(stepToward(800, 1100, 400, 2000)).toBe(1100);
    expect(stepToward(800, 800, 400, 2000)).toBe(800);
    expect(stepToward(0, -1500, -1500, 1500)).toBe(-300);
    expect(stepToward(0, 0, -1500, 1500)).toBe(0); // no -0
    expect(stepToward(100, -500, -1500, 1500)).toBe(-200);
    expect(Object.is(stepToward(-300, 0, -1500, 1500) + 300, 300)).toBe(true);
    expect(Object.is(stepToward(150, 0, -1500, 1500), 0)).toBe(true);
  });

  it("re-clamps into the legal range even if the current policy was odd", () => {
    expect(stepToward(1900, 5000, 400, 2000)).toBe(2000);
    expect(stepToward(450, -5000, 400, 2000)).toBe(400);
  });

  it("every stepped policy passes the contract step check (random pairs)", () => {
    for (let i = 0; i < 2000; i++) {
      const cur = { spread_bp: 400 + ((i * 7919) % 1601), bias_bp: -1500 + ((i * 104729) % 3001) };
      const tgt = { spread_bp: 400 + ((i * 6151) % 1601), bias_bp: -1500 + ((i * 15485863) % 3001) };
      expect(policyStepOk(cur, stepPolicyToward(cur, tgt)), JSON.stringify({ cur, tgt })).toBe(true);
    }
  });
});

describe("SimWorld.setPolicy enforces the step and the once-per-tick rule like the contract", () => {
  it("rejects a step above 300 on either axis; accepts exactly 300", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    await expect(w.setPolicy("dasht", 1101, 0)).rejects.toThrow(/300 bp/);
    await expect(w.setPolicy("dasht", 800, 301)).rejects.toThrow(/300 bp/);
    await expect(w.setPolicy("dasht", 800, -301)).rejects.toThrow(/300 bp/);
    await expect(w.setPolicy("dasht", 499, 0)).rejects.toThrow(/300 bp/);
    expect(w.rejected.setPolicy).toBe(4);
    expect(w.policy.dasht).toEqual({ spread_bp: 800, bias_bp: 0 });
    await w.setPolicy("dasht", 1100, -300);
    expect(w.policy.dasht).toEqual({ spread_bp: 1100, bias_bp: -300 });
  });

  it("allows one change per tick per merchant; the next tick allows another", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    await w.setPolicy("dasht", 900, 0);
    await expect(w.setPolicy("dasht", 1000, 0)).rejects.toThrow(/RATE_LIMIT.*once per tick/);
    await w.setPolicy("madan", 900, 0); // another merchant is independent
    expect(w.rejected.setPolicy).toBe(1);
    await w.worldTick();
    await w.setPolicy("dasht", 1000, 0);
    expect(w.policy.dasht.spread_bp).toBe(1000);
  });

  it("the step is measured from the current policy, so a target 1000 away needs four calls", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    for (const s of [1100, 1400, 1700, 1800]) {
      await w.setPolicy("dasht", s, 0);
      await w.worldTick();
    }
    expect(w.policy.dasht.spread_bp).toBe(1800);
  });
});

/** Empty a merchant's treasury into the house so the world still conserves money. */
const drain = (w: SimWorld, c: CityId) => { w.house += w.treasury[c]; w.treasury[c] = 0; };

const answer = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ spread_bp: 1800, bias_bp: 0, mood: "worried", ship_choice: null, line: "Hard times.", reason: "treasury low", ...o });

function setup(model: ModelClient | null) {
  const world = new SimWorld({ bots: 0, seed: 1 });
  const store = new MemoryStore();
  let now = 1_800_000_000;
  const deps: RunDeps = {
    chain: world, store, model, attestor: null, history: new StockHistory(),
    memory: new Map<CityId, MerchantMemory>(), now: () => now, log: silentLogger,
  };
  return { world, store, deps, advance: async () => { await world.worldTick(); now = world.snapshot().now; } };
}

const modelReturning = (content: string): ModelClient => ({
  async complete(): Promise<ModelReply> {
    return { content, requestId: "req-1", model: "test/model", chatId: "c", latencyMs: 1, requestBody: "{}", responseBody: "{}" };
  },
});

describe("runMerchantOnce clamps to the step and records what was sent", () => {
  it("baseline with a target 1000 bp away sends +300 and is never rejected; converges over ticks", async () => {
    const { world, store, deps, advance } = setup(null);
    drain(world, "dasht"); // treasury_bp 0 -> baseline spread 1800
    expect(baselineSpread(0)).toBe(1800);
    const sent: number[] = [];
    for (let i = 0; i < 6; i++) {
      drain(world, "dasht"); // keep the target at 1800 (house recycling would refill the treasury)
      const out = await runMerchantOnce(deps, "dasht");
      sent.push(out.decision.spread_bp);
      expect(out.chainErrors).toEqual([]);
      expect(out.decision.spread_bp).toBe(world.policy.dasht.spread_bp); // the log says what is on chain
      await advance();
    }
    expect(sent).toEqual([1100, 1400, 1700, 1800, 1800, 1800]);
    expect(world.rejected.setPolicy).toBe(0);
    expect(store.rows).toHaveLength(6);
  });

  it("bias is stepped on its own axis and the reason says the move was limited", async () => {
    const { world, deps } = setup(null);
    world.stock.dasht.grain = 0; // scarce -> baseline bias pushes up
    world.stock.dasht.salt = 0;
    world.stock.dasht.iron = 0;
    const target = baselineBias(Math.trunc((0 + 0 + 0 + 10000 + 10000) / 5));
    expect(target).toBeGreaterThan(300);
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.bias_bp).toBe(300);
    expect(out.decision.reason).toMatch(/limited|step/i);
    expect(world.policy.dasht.bias_bp).toBe(300);
    expect(world.rejected.setPolicy).toBe(0);
  });

  it("a model that asks for spread 1800 is stepped; the llm decision records 1100, not 1800", async () => {
    const { world, deps } = setup(modelReturning(answer()));
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.source).toBe("llm");
    expect(out.decision.spread_bp).toBe(1100);
    expect(world.policy.dasht.spread_bp).toBe(1100);
    expect(world.rejected.setPolicy).toBe(0);
  });

  it("out-of-range asks are clamped to the range first and then stepped (never leaves 400..2000 / -1500..1500)", async () => {
    const { world, deps } = setup(modelReturning(answer({ spread_bp: 999999, bias_bp: -999999 })));
    const out = await runMerchantOnce(deps, "dasht");
    expect(world.policy.dasht).toEqual({ spread_bp: 1100, bias_bp: -300 });
    expect(out.decision).toMatchObject({ spread_bp: 1100, bias_bp: -300 });
    expect(world.rejected.setPolicy).toBe(0);
  });

  it("no setPolicy call when the stepped policy equals the current one", async () => {
    const { world, deps } = setup(modelReturning(answer({ spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0 })));
    const spy = vi.spyOn(world, "setPolicy");
    await runMerchantOnce(deps, "dasht");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("a failed set_policy does not silence ship", () => {
  const glut = (w: SimWorld) => { w.stock.dasht.grain = 340; w.stock.madan.grain = 100; };

  it("set_policy rejected by the chain: previous policy recorded, ship still attempted and recorded", async () => {
    const { world, deps } = setup(null);
    glut(world);
    drain(world, "dasht"); // baseline wants a different spread, so set_policy is attempted
    world.failNext.setPolicy = "chain unavailable";
    const shipSpy = vi.spyOn(world, "ship");
    const out = await runMerchantOnce(deps, "dasht");
    expect(shipSpy).toHaveBeenCalledTimes(1);
    expect(out.chainErrors).toHaveLength(1);
    expect(out.chainErrors[0]).toMatch(/set_policy/);
    expect(out.decision.spread_bp).toBe(PARAMS.SPREAD_DEFAULT_BP);
    expect(out.decision.bias_bp).toBe(0);
    expect(out.decision.ship).toMatchObject({ good: "grain" });
    expect(out.decision.reason).toMatch(/previous policy kept/);
    expect(world.policy.dasht).toEqual({ spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0 });
  });

  it("a contract RATE_LIMIT on set_policy (second change in one tick) still lets the ship through", async () => {
    const { world, deps } = setup(null);
    glut(world);
    drain(world, "dasht");
    await world.setPolicy("dasht", 900, 0); // someone already changed the policy this tick
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.chainErrors.some((e) => /set_policy.*RATE_LIMIT/.test(e))).toBe(true);
    expect(out.decision.ship).toMatchObject({ good: "grain" });
    expect(world.stock.dasht.grain).toBeLessThan(340);
  });

  it("a rejected ship does not undo an accepted policy (unchanged behaviour)", async () => {
    const { world, deps } = setup(null);
    glut(world);
    drain(world, "dasht");
    world.failNext.ship = "BAD_REQUEST: nope";
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.spread_bp).toBe(1100);
    expect(out.decision.ship).toBeNull();
  });
});

describe("whole-cycle simulation: the contract-strict SimWorld never rejects a worker call because of the step rule", () => {
  it("baseline, 120 ticks: zero rejected set_policy", async () => {
    const res = await simulate({ ticks: 120, bots: 5, seed: 11, model: null });
    expect(res.world.rejected.setPolicy).toBe(0);
  });
  it("fake model with out-of-range faults, 120 ticks: zero rejected set_policy", async () => {
    const res = await simulate({ ticks: 120, bots: 5, seed: 11, model: new FakeModel(11, { outOfRange: 0.3, noJson: 0.1 }) });
    expect(res.world.rejected.setPolicy).toBe(0);
  });
});
