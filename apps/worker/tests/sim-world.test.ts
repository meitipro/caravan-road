import { describe, expect, it } from "vitest";
import { CITY_IDS, GOODS, GOOD_IDS } from "@caravan/shared";
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
    await w.setPolicy("dasht", 400, -1500);
    await w.setPolicy("dasht", 2000, 1500);
  });

  it("ship rejects bad calls: same city, qty, no stock, small gap, full warehouse, poor destination", async () => {
    const w = new SimWorld({ bots: 0, seed: 1 });
    w.stock.dasht.grain = 340;
    await expect(w.ship("dasht", "dasht", "grain", 1)).rejects.toThrow();
    await expect(w.ship("dasht", "madan", "grain", 5)).rejects.toThrow(/qty/);
    await expect(w.ship("dasht", "madan", "grain", 0)).rejects.toThrow(/qty/);
    await expect(w.ship("dasht", "madan", "salt", 1)).rejects.toThrow(/gap/);
    w.stock.madan.grain = 399;
    await expect(w.ship("dasht", "madan", "grain", 1)).rejects.toThrow(/gap/);
    w.stock.madan.grain = 150;
    w.treasury.madan = 10;
    await expect(w.ship("dasht", "madan", "grain", 4)).rejects.toThrow(/pay/);
    w.treasury.madan = 50_000;
    const before = w.moneyNow();
    await w.ship("dasht", "madan", "grain", 4);
    expect(w.moneyNow()).toBe(before);
    expect(w.stock.madan.grain).toBe(154);
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
    // setPolicy is always in range. spec-v1.2 (MULT_K_BP 3000) changed the prices, so with this seed two ship calls are now
    // rejected with "destination cannot pay": the option is checked against the tick-start snapshot (old bias), but run-once
    // applies set_policy first and the merchant's new bias raises the midpoint price that ship() charges. That race exists
    // under any prices; under spec-v1.1 (K=4000) this seed happened to give ship: 0. Numbers are from a real run.
    expect(res.world.rejected).toEqual({ setPolicy: 0, ship: 2 });
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
