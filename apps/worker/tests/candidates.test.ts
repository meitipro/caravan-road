import { describe, expect, it } from "vitest";
import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, GOODS, GOOD_IDS, PARAMS, quoteBig } from "@caravan/shared";
import { computeShipOptions, gapOk, MAX_SHIP_OPTIONS } from "../src/candidates.js";
import { scenarioSnapshot } from "../src/scenario.js";
import { Rng, SimWorld } from "../src/sim-world.js";
import type { WorldSnapshot } from "../src/types.js";

/**
 * Independent oracle written straight from spec 2.8 / OPEN_QUESTIONS #12 with BigInt arithmetic
 * (not sharing code with candidates.ts). It states when a ship call must be accepted.
 */
function oracleAccepts(s: WorldSnapshot, from: CityId, to: CityId, good: GoodId, qty: number): boolean {
  if (from === to) return false;
  if (qty < 1 || qty > 4) return false;
  const target = BigInt(GOODS[good].target);
  const a = BigInt(s.merchants[from].stock[good]);
  const b = BigInt(s.merchants[to].stock[good]);
  if (a < BigInt(qty)) return false;
  if ((a - b) * 10000n < 5000n * target) return false;
  if (b + BigInt(qty) > 2n * target) return false;
  const mid = (st: bigint, bias: number) => quoteBig({ good, stock: st, spreadBp: 800, biasBp: bias }).mid;
  const unit = (mid(a, s.merchants[from].policy.bias_bp) + mid(b, s.merchants[to].policy.bias_bp)) / 2n;
  return s.merchants[to].treasury >= unit * BigInt(qty);
}

describe("gap test is integer and exact", () => {
  it("ships at exactly a 50% gap (the float reference would not)", () => {
    // silk target 30: stock 21 vs 6 -> gap exactly 5000 bp
    expect(gapOk(21, 6, "silk")).toBe(true);
    expect(gapOk(20, 6, "silk")).toBe(false);
    // grain target 200: 100 apart is exactly 5000 bp
    expect(gapOk(250, 150, "grain")).toBe(true);
    expect(gapOk(249, 150, "grain")).toBe(false);
  });
});

describe("computeShipOptions fixtures", () => {
  it("returns no option at equilibrium", () => {
    expect(computeShipOptions(scenarioSnapshot("dasht", { treasury_bp: 10000 }), "dasht")).toEqual([]);
  });

  it("offers a grain shipment for a glut, qty 4, sorted by gap, indexed from 0", () => {
    const snap = scenarioSnapshot("dasht", { treasury_bp: 10000, own_ratio_bp: { grain: 17000, iron: 16000 }, others_ratio_bp: {} });
    const opts = computeShipOptions(snap, "dasht");
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.length).toBeLessThanOrEqual(MAX_SHIP_OPTIONS);
    expect(opts.map((o) => o.index)).toEqual(opts.map((_, i) => i));
    expect(opts[0]).toMatchObject({ good: "grain", qty: 4, gap_bp: 7000 });
    for (let i = 1; i < opts.length; i++) expect(opts[i - 1]!.gap_bp).toBeGreaterThanOrEqual(opts[i]!.gap_bp);
  });

  it("never offers more than 4 options", () => {
    const all = { grain: 20000, salt: 20000, iron: 20000, spice: 20000, silk: 20000 };
    const snap = scenarioSnapshot("bandar", { treasury_bp: 10000, own_ratio_bp: all, others_ratio_bp: { grain: 2000, salt: 2000, iron: 2000, spice: 2000, silk: 2000 } });
    expect(computeShipOptions(snap, "bandar")).toHaveLength(4);
  });

  it("drops options the destination cannot pay for and shrinks qty when it can pay only part", () => {
    const snap = scenarioSnapshot("bandar", { treasury_bp: 10000, own_ratio_bp: { silk: 20000 }, others_ratio_bp: { silk: 2000 } });
    for (const c of CITY_IDS) if (c !== "bandar") snap.merchants[c].treasury = 0n;
    expect(computeShipOptions(snap, "bandar")).toEqual([]);
    snap.merchants.shahr.treasury = 25_000n; // about 1 unit of silk at ~25k? silk mid is ~14-27k
    const opts = computeShipOptions(snap, "bandar");
    for (const o of opts) expect(o.qty).toBeLessThan(4);
  });

  it("respects destination warehouse headroom and source stock", () => {
    const snap = scenarioSnapshot("madan", { treasury_bp: 10000, own_ratio_bp: { silk: 10000 }, others_ratio_bp: {} });
    snap.merchants.madan.stock.silk = 33;
    snap.merchants.dasht.stock.silk = 2;
    snap.merchants.bandar.stock.silk = 59; // only 1 unit of room
    snap.merchants.shahr.stock.silk = 30;
    const opts = computeShipOptions(snap, "madan").filter((o) => o.good === "silk");
    expect(opts.every((o) => o.to === "dasht")).toBe(true);
  });
});

describe("property: every candidate is accepted by the contract rules", () => {
  it("1500 random worlds: an independent oracle accepts every option", () => {
    const rng = new Rng(20260501);
    let withOptions = 0;
    for (let n = 0; n < 1500; n++) {
      const spec: Record<string, number> = {};
      const snap = scenarioSnapshot("dasht", { treasury_bp: 10000 });
      for (const c of CITY_IDS) {
        const m = snap.merchants[c];
        for (const g of GOOD_IDS) m.stock[g] = rng.int(GOODS[g].cap + 1);
        m.treasury = BigInt(rng.int(120_000));
        m.policy = { spread_bp: 400 + rng.int(1601), bias_bp: -1500 + rng.int(3001) };
      }
      void spec;
      for (const from of CITY_IDS) {
        const opts = computeShipOptions(snap, from);
        if (opts.length > 0) withOptions++;
        expect(opts.length).toBeLessThanOrEqual(4);
        for (const o of opts) {
          expect(oracleAccepts(snap, from, o.to, o.good, o.qty), JSON.stringify(o)).toBe(true);
          expect(o.qty).toBeGreaterThanOrEqual(1);
          expect(o.qty).toBeLessThanOrEqual(PARAMS.NPC_SHIP_UNITS_PER_TICK);
        }
      }
    }
    expect(withOptions).toBeGreaterThan(300); // the property was exercised, not vacuous
  });

  it("the sim world (which rejects like the contract is specified to) accepts every candidate", async () => {
    const rng = new Rng(99);
    let shipped = 0;
    for (let n = 0; n < 400; n++) {
      const w = new SimWorld({ bots: 0, seed: n });
      for (const c of CITY_IDS) {
        for (const g of GOOD_IDS) w.stock[c][g] = rng.int(GOODS[g].cap + 1);
        w.treasury[c] = rng.int(100_000);
        w.policy[c] = { spread_bp: 400 + rng.int(1601), bias_bp: -1500 + rng.int(3001) };
      }
      const snap = w.snapshot();
      for (const from of CITY_IDS) {
        for (const o of computeShipOptions(snap, from)) {
          const ww = new SimWorld({ bots: 0, seed: n });
          Object.assign(ww.stock, JSON.parse(JSON.stringify(w.stock)));
          Object.assign(ww.treasury, w.treasury);
          Object.assign(ww.policy, JSON.parse(JSON.stringify(w.policy)));
          await ww.ship(from, o.to, o.good, o.qty);
          shipped++;
          expect(ww.rejected.ship).toBe(0);
        }
      }
    }
    expect(shipped).toBeGreaterThan(100);
  });
});
