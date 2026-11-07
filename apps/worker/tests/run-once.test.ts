import { describe, expect, it, vi } from "vitest";
import { PARAMS, type CityId } from "@caravan/shared";
import type { Attestor } from "../src/attest.js";
import { NearAiError, type ModelClient, type ModelReply } from "../src/brain.js";
import { baselineBias, baselineSpread } from "../src/baseline.js";
import { StockHistory } from "../src/features.js";
import { MemoryStore } from "../src/memory-store.js";
import { runMerchantOnce, SKIP_MAX_AGE_SECONDS, type MerchantMemory, type RunDeps } from "../src/run-once.js";
import { SimWorld } from "../src/sim-world.js";
import { silentLogger, type EvidenceRecord } from "../src/types.js";

const reply = (content: string, over: Partial<ModelReply> = {}): ModelReply => ({
  content,
  requestId: "req-42",
  model: "test/model",
  chatId: "chat-42",
  latencyMs: 3,
  requestBody: "{}",
  responseBody: "{}",
  ...over,
});

const answer = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    spread_bp: 1100,
    bias_bp: 250,
    mood: "greedy",
    ship_choice: null,
    line: { en: "Grain is dear today.", fa: "امروز غله گران است." },
    reason: "test",
    ...o,
  });

function scripted(fn: (call: number) => string | Error) {
  const m = {
    calls: 0,
    async complete(): Promise<ModelReply> {
      const r = fn(++m.calls);
      if (r instanceof Error) throw r;
      return reply(r);
    },
  };
  return m satisfies ModelClient & { calls: number };
}

function setup(model: ModelClient | null, opts: { attestor?: Attestor | null; world?: SimWorld } = {}) {
  const world = opts.world ?? new SimWorld({ bots: 0, seed: 1 });
  const store = new MemoryStore();
  let now = 1_800_000_000;
  const memory = new Map<CityId, MerchantMemory>();
  const deps: RunDeps = {
    chain: world,
    store,
    model,
    attestor: opts.attestor ?? null,
    history: new StockHistory(),
    memory,
    now: () => now,
    log: silentLogger,
  };
  return { world, store, deps, memory, setNow: (n: number) => (now = n), getNow: () => now };
}

const glut = (w: SimWorld) => {
  w.stock.dasht.grain = 340; // 170% of target
  // neighbours at 90%: below target (the contract only lets a merchant ship to a city short of the good), gap 8000 bp
  for (const c of ["madan", "bandar", "shahr"] as const) w.stock[c].grain = 180;
};

describe("fallback ladder", () => {
  it("level 1: valid model answer -> source llm, policy applied, request id and model recorded, attested false without evidence", async () => {
    const model = scripted(() => answer());
    const { world, store, deps } = setup(model);
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision).toMatchObject({ source: "llm", spread_bp: 1100, bias_bp: 250, mood: "greedy", model: "test/model", request_id: "req-42", attested: false });
    expect(out.decision.tx_hashes).toHaveLength(1);
    expect(world.policy.dasht).toEqual({ spread_bp: 1100, bias_bp: 250 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(model.calls).toBe(1);
  });

  it("level 2: model down (network error twice) -> baseline, no model/request id, merchant keeps trading", async () => {
    const model = scripted(() => new NearAiError("network", "down"));
    const { world, deps } = setup(model);
    world.treasury.dasht = 30_000; // 6000 bp -> spread 1200 (money check is only in worldTick, not called here)
    const out = await runMerchantOnce(deps, "dasht");
    expect(model.calls).toBe(2); // one retry
    expect(out.decision).toMatchObject({ source: "baseline", model: null, request_id: null, attested: false });
    // baseline target is 1200, but the contract allows 300 bp per change: 800 -> 1100 now, 1200 next round
    expect(baselineSpread(6000)).toBe(1200);
    expect(out.decision.spread_bp).toBe(1100);
    expect(world.policy.dasht.spread_bp).toBe(1100);
    expect(world.rejected.setPolicy).toBe(0);
  });

  it("level 2: invalid JSON twice -> baseline", async () => {
    const model = scripted(() => "I am sorry, I cannot do that");
    const { deps } = setup(model);
    const out = await runMerchantOnce(deps, "madan");
    expect(model.calls).toBe(2);
    expect(out.decision.source).toBe("baseline");
    expect(out.decision.reason).toMatch(/baseline/i);
  });

  it("level 2: bad API key (401) -> immediate baseline, one call only", async () => {
    const model = scripted(() => new NearAiError("http", "HTTP 401", 401));
    const { deps } = setup(model);
    const out = await runMerchantOnce(deps, "dasht");
    expect(model.calls).toBe(1);
    expect(out.decision.source).toBe("baseline");
  });

  it("invalid first answer, valid retry -> llm with firstAttemptValid false", async () => {
    const model = scripted((n) => (n === 1 ? "{broken" : answer()));
    const { deps } = setup(model);
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.source).toBe("llm");
    expect(out.propose?.ok && out.propose.firstAttemptValid).toBe(false);
  });

  it("no model at all -> baseline", async () => {
    const { world, deps } = setup(null);
    world.stock.dasht.grain = 100; // scarce -> positive bias
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.source).toBe("baseline");
    expect(out.decision.bias_bp).toBe(baselineBias(Math.trunc((5000 + 4 * 10000) / 5)));
  });

  it("level 3: chain rejects set_policy -> source keep, previous policy recorded; ship is still attempted", async () => {
    const model = scripted(() => answer({ ship_choice: 0 }));
    const { world, store, deps } = setup(model);
    glut(world);
    world.failNext.setPolicy = "chain unavailable";
    const shipSpy = vi.spyOn(world, "ship");
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision).toMatchObject({ source: "keep", spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0, model: null, request_id: null });
    expect(out.decision.reason).toMatch(/previous policy kept/);
    expect(out.chainErrors[0]).toMatch(/set_policy/);
    expect(world.policy.dasht).toEqual({ spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0 });
    expect(shipSpy).toHaveBeenCalledTimes(1);
    expect(out.decision.ship).not.toBeNull();
    expect(out.decision.tx_hashes).toHaveLength(1); // only the ship
    expect(store.rows).toHaveLength(1); // the failure is still recorded
  });
});

describe("ship decisions", () => {
  it("successful ship: the chosen option is executed and recorded", async () => {
    const model = scripted(() => answer({ ship_choice: 0 }));
    const { world, deps } = setup(model);
    glut(world);
    const before = world.stock.dasht.grain;
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.options[0]).toMatchObject({ good: "grain" });
    expect(out.decision.ship).toEqual({ to: out.options[0]!.to, good: "grain", qty: out.options[0]!.qty });
    expect(world.stock.dasht.grain).toBe(before - out.options[0]!.qty);
    expect(out.decision.tx_hashes).toHaveLength(2); // set_policy + ship
    expect(world.rejected.ship).toBe(0);
  });

  it("an out-of-range ship_choice from the model ships nothing", async () => {
    const model = scripted(() => answer({ ship_choice: 7 }));
    const { world, deps } = setup(model);
    glut(world);
    const spy = vi.spyOn(world, "ship");
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.ship).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("chain rejects the ship: decision.ship is null, policy stays applied, reason says so", async () => {
    const model = scripted(() => answer({ ship_choice: 0 }));
    const { world, deps } = setup(model);
    glut(world);
    world.failNext.ship = "BAD_REQUEST: gap below minimum";
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.ship).toBeNull();
    expect(out.decision.source).toBe("llm");
    expect(out.decision.reason).toMatch(/rejected/);
    expect(world.policy.dasht.spread_bp).toBe(1100);
  });

  it("baseline ships the candidate with the largest gap", async () => {
    const { world, deps } = setup(null);
    glut(world);
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.decision.source).toBe("baseline");
    expect(out.decision.ship).toMatchObject({ good: "grain" });
    expect(world.rejected.ship).toBe(0);
  });
});

describe("policy writes and the model-skip rule", () => {
  it("set_policy is called only when the policy changed", async () => {
    const model = scripted(() => answer({ spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0 }));
    const { world, deps } = setup(model);
    const spy = vi.spyOn(world, "setPolicy");
    const out = await runMerchantOnce(deps, "dasht");
    expect(spy).not.toHaveBeenCalled();
    expect(out.decision.tx_hashes).toEqual([]);
    expect(out.decision.source).toBe("llm");
  });

  it("skips the model (source keep) when nothing moved and the last model decision is under 10 minutes old", async () => {
    const model = scripted(() => answer());
    const { deps, setNow, getNow, world } = setup(model);
    await runMerchantOnce(deps, "dasht");
    expect(model.calls).toBe(1);
    setNow(getNow() + 60);
    const spy = vi.spyOn(world, "setPolicy");
    const out = await runMerchantOnce(deps, "dasht");
    expect(model.calls).toBe(1); // no credits spent
    expect(out.skippedModel).toBe(true);
    expect(out.decision).toMatchObject({ source: "keep", spread_bp: 1100, bias_bp: 250, mood: "greedy", model: null, request_id: null });
    expect(out.decision.line.en).toBe("Grain is dear today.");
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls the model again after 10 minutes", async () => {
    const model = scripted(() => answer());
    const { deps, setNow, getNow } = setup(model);
    await runMerchantOnce(deps, "dasht");
    setNow(getNow() + SKIP_MAX_AGE_SECONDS);
    await runMerchantOnce(deps, "dasht");
    expect(model.calls).toBe(2);
  });

  it("calls the model when a stock ratio moved by >= 300 bp or treasury by >= 500 bp", async () => {
    const m1 = scripted(() => answer());
    const a = setup(m1);
    await runMerchantOnce(a.deps, "dasht");
    a.setNow(a.getNow() + 60);
    a.world.stock.dasht.grain += 6; // 300 bp of 200
    await runMerchantOnce(a.deps, "dasht");
    expect(m1.calls).toBe(2);

    const m2 = scripted(() => answer());
    const b = setup(m2);
    await runMerchantOnce(b.deps, "dasht");
    b.setNow(b.getNow() + 60);
    b.world.stock.dasht.grain += 5; // 250 bp: still skipped
    await runMerchantOnce(b.deps, "dasht");
    expect(m2.calls).toBe(1);

    const m3 = scripted(() => answer());
    const c = setup(m3);
    await runMerchantOnce(c.deps, "dasht");
    c.setNow(c.getNow() + 60);
    c.world.treasury.dasht -= 2500; // 500 bp of 50000
    await runMerchantOnce(c.deps, "dasht");
    expect(m3.calls).toBe(2);
  });

  it("a skipped round still ships by the deterministic rule if a candidate exists", async () => {
    const model = scripted(() => answer());
    const { deps, setNow, getNow, world } = setup(model);
    glut(world);
    await runMerchantOnce(deps, "dasht"); // llm round (no ship chosen)
    setNow(getNow() + 60);
    const out = await runMerchantOnce(deps, "dasht");
    expect(out.skippedModel).toBe(true);
    expect(out.decision.ship).toMatchObject({ good: "grain" });
  });
});

describe("attested is never set unless the evidence says so", () => {
  const evidence = (attested: boolean): EvidenceRecord => ({
    merchant: "dasht",
    at: 1,
    model: "test/model",
    request_id: "req-42",
    chat_id: "chat-42",
    request_sha256: "a".repeat(64),
    response_sha256: "b".repeat(64),
    signature: null,
    checks: { signature: attested ? "ok" : "unavailable", tee_quote: attested ? "ok" : "not_verified" },
    attested,
    note: "test",
  });

  it("attestor says false -> false; says true -> true; throws -> false; absent -> false", async () => {
    for (const [attestor, expected] of [
      [{ capture: async () => evidence(false) }, false],
      [{ capture: async () => evidence(true) }, true],
      [{ capture: async () => { throw new Error("evidence endpoint down"); } }, false],
      [null, false],
    ] as Array<[Attestor | null, boolean]>) {
      const { deps, store } = setup(scripted(() => answer()), { attestor });
      const out = await runMerchantOnce(deps, "dasht");
      expect(out.decision.attested).toBe(expected);
      expect(out.decision.source).toBe("llm");
      expect(store.rows[0]!.evidence?.attested ?? false).toBe(expected);
    }
  });

  it("baseline and keep decisions are never attested, even if an attestor would say true", async () => {
    const attestor: Attestor = { capture: async () => evidence(true) };
    const down = setup(scripted(() => new NearAiError("network", "x")), { attestor });
    expect((await runMerchantOnce(down.deps, "dasht")).decision.attested).toBe(false);
    const nomodel = setup(null, { attestor });
    expect((await runMerchantOnce(nomodel.deps, "dasht")).decision.attested).toBe(false);
  });
});

describe("authority limits end to end", () => {
  it("a model that asks for absurd values never moves the world's policy out of range", async () => {
    const model = scripted(() => answer({ spread_bp: 999999, bias_bp: -999999, withdraw_all: true, treasury: 0 }));
    const { world, deps } = setup(model);
    const out = await runMerchantOnce(deps, "dasht");
    expect(world.rejected.setPolicy).toBe(0);
    // clamped to 2000 / -1500, then stepped: at most 300 bp from the 800 / 0 in force
    expect(world.policy.dasht).toEqual({ spread_bp: 1100, bias_bp: -300 });
    expect(out.decision.spread_bp).toBe(1100);
    expect(out.decision.bias_bp).toBe(-300);
    expect(out.decision.source).toBe("llm");
  });

  it("a store failure does not break the run", async () => {
    const { deps, world } = setup(scripted(() => answer()));
    deps.store = { insertDecision: async () => { throw new Error("db down"); }, heartbeat: async () => {} };
    await expect(runMerchantOnce(deps, "dasht")).resolves.toBeDefined();
    expect(world.policy.dasht.spread_bp).toBe(1100);
  });

  it("a throwing observer does not break the run", async () => {
    const { deps } = setup(null);
    deps.observe = () => { throw new Error("observer bug"); };
    await expect(runMerchantOnce(deps, "dasht")).resolves.toBeDefined();
  });
});
