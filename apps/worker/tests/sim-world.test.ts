import { describe, expect, it } from "vitest";
import { CITY_IDS, GOODS, GOOD_IDS, quoteBig } from "@caravan/shared";
import { SimWorld } from "../src/sim-world.js";
import { simulate } from "../src/simulate.js";
import { FakeModel, scriptedPolicy } from "../src/fake/fake-model.js";
import { ctxFor } from "./helpers.js";

describe("SimWorld", () => {
  it("is deterministic for a seed and conserves money on every tick (throws otherwise)", async () => {
    const run = async (seed: number) => {
      const w = new SimWorld({ bots: 5, seed });
      for (let i = 0; i < 240; i++) await w.worldTick();
      return JSON.stringify(w.stats());
    };
    const a = await run(7);
    expect(await run(7)).toBe(a);
    expect(await run(8)).not.toBe(a);
    const s = JSON.parse(a);
    expect(s.moneyNow).toBe(s.moneyStart);
    expect(s.trips).toBeGreaterThan(0);
  });

  it("keeps stock inside [0, 2 x target]", async () => {
    const w = new SimWorld({ bots: 5, seed: 3 });
    for (let i = 0; i < 300; i++) {
      await w.worldTick();
      for (const c of CITY_IDS) for (const g of GOOD_IDS) {
        expect(w.stock[c][g]).toBeGreaterThanOrEqual(0);
        expect(w.stock[c][g]).toBeLessThanOrEqual(GOODS[g].cap);
      }
    }
  });

  it("setPolicy rejects out-of-range and non-integer values like the contract", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    for (const [s, b] of [[399, 0], [2001, 0], [800, 1501], [800, -1501], [800.5, 0], [800, 0.5], [NaN, 0]] as const) {
      await expect(w.setPolicy("dasht", s, b)).rejects.toThrow(/BAD_REQUEST/);
    }
    expect(w.rejected.setPolicy).toBe(7);
    // the bounds themselves are legal, reached in steps of at most 300 bp (one change per tick)
    await w.setPolicy("dasht", 500, -300);
    await w.worldTick();
    await w.setPolicy("dasht", 400, -600);
    expect(w.policy.dasht).toEqual({ spread_bp: 400, bias_bp: -600 });
  });

  it("ship rejects bad calls: same city, qty, destination not short, small gap, no stock, full warehouse, poor destination", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    w.stock.dasht.grain = 340;
    await expect(w.ship("dasht", "dasht", "grain", 1)).rejects.toThrow();
    await expect(w.ship("dasht", "madan", "grain", 5)).rejects.toThrow(/qty/);
    await expect(w.ship("dasht", "madan", "grain", 0)).rejects.toThrow(/qty/);
    await expect(w.ship("dasht", "madan", "salt", 1)).rejects.toThrow(/not short/); // both at target
    w.stock.madan.grain = 399;
    await expect(w.ship("dasht", "madan", "grain", 1)).rejects.toThrow(/not short/); // above target
    w.stock.madan.grain = 200;
    await expect(w.ship("dasht", "madan", "grain", 1)).rejects.toThrow(/not short/); // exactly at target
    w.stock.dasht.grain = 250;
    w.stock.madan.grain = 199;
    await expect(w.ship("dasht", "madan", "grain", 1)).rejects.toThrow(/gap/); // 51 < 100
    w.stock.dasht.grain = 340;
    w.stock.madan.grain = 150;
    w.treasury.madan = 10;
    await expect(w.ship("dasht", "madan", "grain", 4)).rejects.toThrow(/budget/);
    w.treasury.madan = 50_000;
    const before = w.moneyNow();
    await w.ship("dasht", "madan", "grain", 4);
    expect(w.moneyNow()).toBe(before);
    expect(w.stock.madan.grain).toBe(154);
  });

  it("ship payment is the contract's ship_payment: mids at the default policy, whatever the merchants' bias", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    w.stock.dasht.grain = 340;
    w.stock.madan.grain = 150;
    w.policy.dasht = { spread_bp: 2000, bias_bp: 1500 };
    w.policy.madan = { spread_bp: 2000, bias_bp: -1500 };
    const mid = (stock: number) => quoteBig({ good: "grain", stock, spreadBp: 800, biasBp: 0 }).mid;
    const unit = Number((mid(340) + mid(150)) / 2n);
    const t0 = w.treasury.madan;
    await w.ship("dasht", "madan", "grain", 3);
    expect(t0 - w.treasury.madan).toBe(unit * 3);
  });

  it("ship: the destination pays at most 25% of its treasury per tick, summed over all incoming shipments", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    // silk: bandar 60 (mid 15000), dasht 60, shahr 6 (mid 24800) -> 19900 per unit
    w.stock.bandar.silk = 60;
    w.stock.dasht.silk = 60;
    w.stock.shahr.silk = 6;
    w.treasury.shahr = 110_000; // budget 27500 per tick: one unit (19900), not two
    w.house += w.moneyStart - w.moneyNow(); // keep money conserved after hand-setting treasuries
    await expect(w.ship("bandar", "shahr", "silk", 2)).rejects.toThrow(/RATE_LIMIT.*budget/);
    await w.ship("bandar", "shahr", "silk", 1);
    expect(w.snapshot().merchants.shahr.ship_in_paid).toBe(19_900n);
    // treasury is now 90100; (90100 + 19900) / 4 = 27500 budget, 7600 left: a unit from a DIFFERENT merchant is refused
    await expect(w.ship("dasht", "shahr", "silk", 1)).rejects.toThrow(/budget/);
    await w.worldTick(); // new tick: the paid counter starts over
    expect(w.snapshot().merchants.shahr.ship_in_paid ?? 0n).toBe(0n);
  });

  it("ship: one shipment per good per tick; another good is fine; the next tick resets", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    w.stock.dasht.grain = 340;
    w.stock.dasht.iron = 250;
    w.stock.madan.grain = 100;
    w.stock.madan.iron = 50;
    w.stock.bandar.grain = 100;
    await w.ship("dasht", "madan", "grain", 1);
    expect(w.snapshot().merchants.dasht.shipped_this_tick).toEqual(["grain"]);
    await expect(w.ship("dasht", "bandar", "grain", 1)).rejects.toThrow(/RATE_LIMIT.*one shipment per good/);
    await w.ship("dasht", "madan", "iron", 1);
    const before = w.rejected.ship;
    await w.worldTick();
    expect(w.snapshot().merchants.dasht.shipped_this_tick ?? []).toEqual([]);
    await w.ship("dasht", "bandar", "grain", 1);
    expect(w.rejected.ship).toBe(before);
  });
});

describe("dry-run simulation with the FAKE model", () => {
  it("runs the real worker cycle for 60 ticks; every decision is in range and recorded", async () => {
    const res = await simulate({ ticks: 60, bots: 5, seed: 7, model: new FakeModel(7, { noJson: 0.1, outOfRange: 0.1, wrongType: 0.1, timeout: 0.05 }) });
    expect(res.decisions).toHaveLength(60 * 4);
    for (const d of res.decisions) {
      expect(d.spread_bp).toBeGreaterThanOrEqual(400);
      expect(d.spread_bp).toBeLessThanOrEqual(2000);
      expect(d.bias_bp).toBeGreaterThanOrEqual(-1500);
      expect(d.bias_bp).toBeLessThanOrEqual(1500);
      expect(d.attested).toBe(false);
      if (d.source !== "llm") expect(d.request_id).toBeNull();
      if (d.source === "llm") expect(d.model).toBe("fake-scripted");
    }
    // Nothing the worker sends is rejected by the contract-strict SimWorld: set_policy is stepped to within 300 bp of the
    // current policy, and ship options are priced like the contract (bias 0), so a policy change cannot invalidate them.
    // (Before the fix this seed had 2 ship rejections: "destination cannot pay", caused by pricing ships at the new bias.)
    expect(res.world.rejected).toEqual({ setPolicy: 0, ship: 0 });
    expect(res.stats.moneyNow).toBe(res.stats.moneyStart);
    expect(res.bySource.llm).toBeGreaterThan(0);
  });

  it("baseline-only mode never calls a model", async () => {
    const res = await simulate({ ticks: 20, bots: 3, seed: 1, model: null });
    expect(res.bySource).toEqual({ llm: 0, baseline: 80, keep: 0 });
  });

  it("scripted policy differs by persona in the intended direction", () => {
    const state = { treasury_bp: 10000 };
    const spread = (c: "dasht" | "madan" | "bandar" | "shahr") => scriptedPolicy(ctxFor(c, state).features, 0).spread_bp;
    expect(spread("dasht")).toBeLessThan(spread("madan"));
    expect(spread("madan")).toBeLessThan(spread("bandar"));
    expect(spread("bandar")).toBeLessThan(spread("shahr"));
  });
});

describe("fake-model rows can never look like real evidence", () => {
  it("every row has model fake-scripted, a fake-* request id, attested=false and no evidence", async () => {
    const { isFakeDecision, FAKE_MODEL_NAME } = await import("../src/fake/fake-model.js");
    const res = await simulate({ ticks: 30, bots: 3, seed: 2, model: new FakeModel(2, { outOfRange: 0.2, noJson: 0.2 }) });
    const modelRows = res.decisions.filter((d) => d.source === "llm");
    expect(modelRows.length).toBeGreaterThan(0);
    for (const d of modelRows) {
      expect(d.model).toBe(FAKE_MODEL_NAME);
      expect(d.request_id).toMatch(/^fake-/);
      expect(d.attested).toBe(false);
      expect(isFakeDecision(d)).toBe(true);
    }
    expect(res.decisions.some((d) => d.attested)).toBe(false);
  });

  it("the dry-run CLI prints a FAKE MODEL banner", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../src/dry-run.ts", import.meta.url), "utf8");
    expect(text).toContain("=== FAKE MODEL ===");
    expect(text).toContain("[FAKE]");
  });
});
