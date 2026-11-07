import { describe, expect, it } from "vitest";
import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, GOODS, GOOD_IDS, PARAMS, quoteBig } from "@caravan/shared";
import { computeShipOptions, gapOk, MAX_SHIP_OPTIONS } from "../src/candidates.js";
import { baselineDecision } from "../src/baseline.js";
import { buildFeatures, StockHistory } from "../src/features.js";
import { scenarioSnapshot } from "../src/scenario.js";
import { Rng, SimWorld } from "../src/sim-world.js";
import type { WorldSnapshot } from "../src/types.js";

/**
 * Independent oracle written straight from contracts/caravan/src/admin.rs try_ship + apply_shipment and
 * math.rs ship_payment, with BigInt arithmetic (not sharing code with candidates.ts / contract-rules.ts).
 * It states when a ship call must be accepted, in the contract's order of checks.
 */
function oracleAccepts(s: WorldSnapshot, from: CityId, to: CityId, good: GoodId, qty: number): boolean {
  if (from === to) return false;
  if (qty < 1 || qty > 4) return false;
  if (s.merchants[from].shipped_this_tick?.includes(good)) return false; // one shipment per good per tick
  const target = BigInt(GOODS[good].target);
  const a = BigInt(s.merchants[from].stock[good]);
  const b = BigInt(s.merchants[to].stock[good]);
  if (b >= target) return false; // "destination is not short of this good"
  const mid = (st: bigint) => quoteBig({ good, stock: st, spreadBp: 800, biasBp: 0 }).mid; // ship_payment: default policy
  const pay = ((mid(a) + mid(b)) / 2n) * BigInt(qty);
  const paid = s.merchants[to].ship_in_paid ?? 0n;
  const budget = ((s.merchants[to].treasury + paid) * 25n) / 100n; // SHIP_MAX_PAY_PCT
  if (paid + pay > budget) return false;
  if ((a - b) * 10000n < 5000n * target) return false; // stock gap of at least 50%
  if (a < BigInt(qty)) return false;
  if (b + BigInt(qty) > 2n * target) return false; // warehouse full
  return s.merchants[to].treasury >= pay;
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
    const snap = scenarioSnapshot("dasht", { treasury_bp: 10000, own_ratio_bp: { grain: 17000, iron: 16000 }, others_ratio_bp: { grain: 9000, iron: 9000 } });
    const opts = computeShipOptions(snap, "dasht");
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.length).toBeLessThanOrEqual(MAX_SHIP_OPTIONS);
    expect(opts.map((o) => o.index)).toEqual(opts.map((_, i) => i));
    expect(opts[0]).toMatchObject({ good: "grain", qty: 4, gap_bp: 8000 });
    for (let i = 1; i < opts.length; i++) expect(opts[i - 1]!.gap_bp).toBeGreaterThanOrEqual(opts[i]!.gap_bp);
  });

  it("never offers more than 4 options", () => {
    const all = { grain: 20000, salt: 20000, iron: 20000, spice: 20000, silk: 20000 };
    const snap = scenarioSnapshot("bandar", { treasury_bp: 10000, own_ratio_bp: all, others_ratio_bp: { grain: 2000, salt: 2000, iron: 2000, spice: 2000, silk: 2000 } });
    expect(computeShipOptions(snap, "bandar")).toHaveLength(4);
  });

  it("drops options the destination cannot pay for and shrinks qty to its 25% budget", () => {
    const snap = scenarioSnapshot("bandar", { treasury_bp: 10000, own_ratio_bp: { silk: 20000 }, others_ratio_bp: { silk: 2000 } });
    for (const c of CITY_IDS) if (c !== "bandar") snap.merchants[c].treasury = 0n;
    expect(computeShipOptions(snap, "bandar")).toEqual([]);
    const silk = () => computeShipOptions(snap, "bandar").find((o) => o.to === "shahr" && o.good === "silk");
    // silk: bandar 60 (mid 15000), shahr 6 (mid 24800) -> 19900 per unit
    snap.merchants.shahr.treasury = 25_000n; // budget 6250 < one unit
    expect(silk()).toBeUndefined();
    snap.merchants.shahr.treasury = 100_000n; // budget 25000: one unit
    expect(silk()?.qty).toBe(1);
    snap.merchants.shahr.treasury = 160_000n; // budget 40000: two units
    expect(silk()?.qty).toBe(2);
    snap.merchants.shahr.treasury = 1_000_000n; // budget 250000: the full 4 units (79600)
    expect(silk()?.qty).toBe(4);
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

describe("contract rule: destination must be BELOW its target stock", () => {
  it("a large gap is not enough when the destination is at or above target", () => {
    // dasht grain 340 (170%), madan grain 200 (at target): gap 140 >= 100, but the contract refuses
    const snap = scenarioSnapshot("dasht", { treasury_bp: 10000, own_ratio_bp: { grain: 17000 }, others_ratio_bp: { grain: 10000 } });
    expect(computeShipOptions(snap, "dasht").filter((o) => o.good === "grain")).toEqual([]);
    snap.merchants.madan.stock.grain = 199;
    expect(computeShipOptions(snap, "dasht").filter((o) => o.good === "grain").map((o) => o.to)).toEqual(["madan"]);
    snap.merchants.bandar.stock.grain = 250; // above target (and the gap is only 90): no
    expect(computeShipOptions(snap, "dasht").some((o) => o.to === "bandar" && o.good === "grain")).toBe(false);
  });

  it("the old rule offered it: gapOk alone is not sufficient", () => {
    expect(gapOk(340, 200, "grain")).toBe(true);
  });
});

describe("contract rule: the destination pays at most 25% of its treasury per tick (ship_in_paid)", () => {
  // silk: bandar 60 (mid 15000), shahr 6 (mid 24800) -> 19900 per unit
  const world = () => {
    const snap = scenarioSnapshot("bandar", { treasury_bp: 10000, own_ratio_bp: { silk: 20000 }, others_ratio_bp: { silk: 2000 } });
    for (const c of CITY_IDS) if (c !== "bandar" && c !== "shahr") snap.merchants[c].treasury = 0n;
    snap.merchants.shahr.treasury = 200_000n; // budget 50000: two units (39800), not three (59700)
    return snap;
  };
  const silkToShahr = (snap: WorldSnapshot) => computeShipOptions(snap, "bandar").find((o) => o.to === "shahr" && o.good === "silk");

  it("qty is reduced to the budget instead of the option being dropped", () => {
    expect(silkToShahr(world())).toMatchObject({ qty: 2 });
  });

  it("what the destination already paid this tick shrinks the budget: (treasury + paid) * 25% - paid", () => {
    const snap = world();
    // an earlier shipment this tick cost 19900: treasury is 180100, budget (180100 + 19900) / 4 = 50000, left 30100 -> 1 unit
    snap.merchants.shahr.treasury = 180_100n;
    snap.merchants.shahr.ship_in_paid = 19_900n;
    expect(silkToShahr(snap)).toMatchObject({ qty: 1 });
    // paid 40000 of a 50000 budget: 10000 left, less than one unit -> option dropped
    snap.merchants.shahr.treasury = 160_000n;
    snap.merchants.shahr.ship_in_paid = 40_000n;
    expect(silkToShahr(snap)).toBeUndefined();
  });

  it("the budget is exact: pay == budget is allowed, one fils less is not", () => {
    const snap = world();
    snap.merchants.shahr.treasury = 4n * 19_900n * 4n; // budget 79600 = 4 units exactly
    expect(silkToShahr(snap)).toMatchObject({ qty: 4 });
    snap.merchants.shahr.treasury = 4n * 19_900n * 4n - 4n; // budget 79599
    expect(silkToShahr(snap)).toMatchObject({ qty: 3 });
  });

  it("ships are priced at the contract's default policy: neither merchant's bias changes the option", () => {
    const snap = world();
    const base = silkToShahr(snap);
    snap.merchants.bandar.policy = { spread_bp: 800, bias_bp: 1500 };
    snap.merchants.shahr.policy = { spread_bp: 800, bias_bp: 1500 };
    expect(silkToShahr(snap)).toEqual(base);
    snap.merchants.shahr.treasury = 160_000n; // budget 40000 pays 2 units at 19900 each only if the bias is ignored
    expect(silkToShahr(snap)).toMatchObject({ qty: 2 });
  });
});

describe("contract rule: one shipment per good per tick", () => {
  it("a good the merchant already shipped this tick is not offered; other goods still are", () => {
    const snap = scenarioSnapshot("dasht", { treasury_bp: 10000, own_ratio_bp: { grain: 17000, iron: 17000 }, others_ratio_bp: { grain: 5000, iron: 5000 } });
    const before = computeShipOptions(snap, "dasht");
    expect(before.some((o) => o.good === "grain")).toBe(true);
    expect(before.some((o) => o.good === "iron")).toBe(true);
    snap.merchants.dasht.shipped_this_tick = ["grain"];
    const after = computeShipOptions(snap, "dasht");
    expect(after.some((o) => o.good === "grain")).toBe(false);
    expect(after.some((o) => o.good === "iron")).toBe(true);
  });
});

describe("baseline ship choice honours the contract rules", () => {
  it("skips a larger gap the contract would reject and takes the best valid option", () => {
    // grain: biggest gap, but every destination is AT target (invalid). iron: destinations are short (valid).
    const snap = scenarioSnapshot("dasht", { treasury_bp: 10000, own_ratio_bp: { grain: 20000, iron: 17000 }, others_ratio_bp: { grain: 10000, iron: 5000 } });
    const options = computeShipOptions(snap, "dasht");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.good === "iron")).toBe(true);
    const b = baselineDecision(buildFeatures(snap, "dasht", new StockHistory()), options);
    expect(b.ship).toMatchObject({ good: "iron" });
    expect(oracleAccepts(snap, "dasht", b.ship!.to, b.ship!.good, b.ship!.qty)).toBe(true);
  });

  it("no valid option -> no ship", () => {
    const snap = scenarioSnapshot("dasht", { treasury_bp: 10000, own_ratio_bp: { grain: 20000 }, others_ratio_bp: { grain: 10000 } });
    const b = baselineDecision(buildFeatures(snap, "dasht", new StockHistory()), computeShipOptions(snap, "dasht"));
    expect(b.ship).toBeNull();
  });
});

describe("property: every candidate is accepted by the contract rules", () => {
  /** random state incl. what was already paid / shipped this tick */
  function randomSnapshot(rng: Rng): WorldSnapshot {
    const snap = scenarioSnapshot("dasht", { treasury_bp: 10000 });
    for (const c of CITY_IDS) {
      const m = snap.merchants[c];
      for (const g of GOOD_IDS) m.stock[g] = rng.int(GOODS[g].cap + 1);
      m.treasury = BigInt(rng.int(120_000));
      m.policy = { spread_bp: 400 + rng.int(1601), bias_bp: -1500 + rng.int(3001) };
      if (rng.int(3) === 0) m.ship_in_paid = BigInt(rng.int(40_000));
      if (rng.int(3) === 0) m.shipped_this_tick = GOOD_IDS.filter(() => rng.int(3) === 0);
    }
    return snap;
  }

  it("1500 random worlds: an independent oracle (contract rules) accepts every option", () => {
    const rng = new Rng(20260501);
    let withOptions = 0;
    let withBudgetState = 0;
    for (let n = 0; n < 1500; n++) {
      const snap = randomSnapshot(rng);
      for (const from of CITY_IDS) {
        const opts = computeShipOptions(snap, from);
        if (opts.length > 0) withOptions++;
        expect(opts.length).toBeLessThanOrEqual(4);
        for (const o of opts) {
          if (snap.merchants[o.to].ship_in_paid !== undefined || snap.merchants[from].shipped_this_tick !== undefined) withBudgetState++;
          expect(oracleAccepts(snap, from, o.to, o.good, o.qty), JSON.stringify(o)).toBe(true);
          expect(o.qty).toBeGreaterThanOrEqual(1);
          expect(o.qty).toBeLessThanOrEqual(PARAMS.NPC_SHIP_UNITS_PER_TICK);
        }
      }
    }
    expect(withOptions).toBeGreaterThan(300); // the property was exercised, not vacuous
    expect(withBudgetState).toBeGreaterThan(100);
  });

  it("maximality: qty cannot be raised (the option uses the whole budget it is allowed) and no valid (to, good) is missed", () => {
    const rng = new Rng(7);
    let checked = 0;
    for (let n = 0; n < 600; n++) {
      const snap = randomSnapshot(rng);
      for (const from of CITY_IDS) {
        // options are capped at MAX_SHIP_OPTIONS, so compare against the oracle only for what is offered
        const opts = computeShipOptions(snap, from);
        for (const o of opts) {
          if (o.qty < PARAMS.NPC_SHIP_UNITS_PER_TICK) {
            expect(oracleAccepts(snap, from, o.to, o.good, o.qty + 1), JSON.stringify(o)).toBe(false);
            checked++;
          }
        }
        if (opts.length < 4) {
          // fewer than the cap: then NO other (to, good) pair is acceptable with qty 1
          for (const to of CITY_IDS) for (const g of GOOD_IDS) {
            if (opts.some((o) => o.to === to && o.good === g)) continue;
            expect(oracleAccepts(snap, from, to, g, 1), `${from}->${to} ${g}`).toBe(false);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  /** copy the mutable world state of `src` into a fresh world */
  function clone(src: SimWorld, seed: number): SimWorld {
    const w = new SimWorld({ bots: 0, seed });
    Object.assign(w.stock, JSON.parse(JSON.stringify(src.stock)));
    Object.assign(w.treasury, src.treasury);
    Object.assign(w.policy, JSON.parse(JSON.stringify(src.policy)));
    Object.assign(w.shipIn, JSON.parse(JSON.stringify(src.shipIn)));
    Object.assign(w.lastShipTick, JSON.parse(JSON.stringify(src.lastShipTick)));
    return w;
  }

  it("the sim world (which enforces the contract's ship rules) accepts every candidate, with budget and per-tick state", async () => {
    const rng = new Rng(99);
    let shipped = 0;
    let withState = 0;
    for (let n = 0; n < 500; n++) {
      const w = new SimWorld({ bots: 0, seed: n });
      for (const c of CITY_IDS) {
        for (const g of GOOD_IDS) w.stock[c][g] = rng.int(GOODS[g].cap + 1);
        w.treasury[c] = rng.int(100_000);
        w.policy[c] = { spread_bp: 400 + rng.int(1601), bias_bp: -1500 + rng.int(3001) };
        if (rng.int(3) === 0) w.shipIn[c] = { tick: w.tick, paid: rng.int(30_000) };
        for (const g of GOOD_IDS) if (rng.int(4) === 0) w.lastShipTick[c][g] = w.tick;
      }
      const snap = w.snapshot();
      for (const from of CITY_IDS) {
        for (const o of computeShipOptions(snap, from)) {
          const ww = clone(w, n);
          await ww.ship(from, o.to, o.good, o.qty);
          shipped++;
          if (w.shipIn[o.to].paid > 0 || Object.keys(w.lastShipTick[from]).length > 0) withState++;
          expect(ww.rejected.ship).toBe(0);
        }
      }
    }
    expect(shipped).toBeGreaterThan(100);
    expect(withState).toBeGreaterThan(20);
  });

  it("whole cycles in one tick: merchants ship in turn from fresh snapshots (the real run-once order); the sim accepts every call", async () => {
    const rng = new Rng(2026);
    let shipped = 0;
    for (let n = 0; n < 300; n++) {
      const w = new SimWorld({ bots: 0, seed: n });
      for (const c of CITY_IDS) {
        for (const g of GOOD_IDS) w.stock[c][g] = rng.int(GOODS[g].cap + 1);
        w.treasury[c] = 20_000 + rng.int(60_000);
      }
      for (let round = 0; round < 3; round++) {
        for (const from of CITY_IDS) {
          const opts = computeShipOptions(w.snapshot(), from);
          if (opts.length === 0) continue;
          const o = opts[0]!;
          await w.ship(from, o.to, o.good, o.qty);
          shipped++;
        }
      }
      expect(w.rejected.ship).toBe(0);
    }
    expect(shipped).toBeGreaterThan(100);
  });
});
