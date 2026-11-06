import { describe, expect, it } from "vitest";
import { multBp, quote, quoteBig, tradeCost } from "./quote.js";
import { CITIES, GOODS, GOOD_IDS, PARAMS, ROUTES } from "./world.js";
import type { GoodId } from "./types.js";

// spec/ECONOMY.md section 2.7: golden vectors table, row by row (spec-v1.2, MULT_K_BP = 3000).
// Hand-checked with integer math; K=3000 values were also produced by a local copy of the Python reference.
// The spec-v1.1 table (K=4000) differed in rows 1, 4, 5, 6 (grain 0: 1296/1350/1404, iron 37: 4807/5008/5208,
// spice 55: 9827/10455/11082, silk 12: 21873/22320/22766).
const GOLDEN: Array<{
  good: GoodId; stock: number; spread_bp: number; bias_bp: number; bid: string; mid: string; ask: string;
}> = [
  { good: "grain", stock: 0, spread_bp: 800, bias_bp: 0, bid: "1248", mid: "1300", ask: "1352" },
  { good: "grain", stock: 200, spread_bp: 800, bias_bp: 0, bid: "960", mid: "1000", ask: "1040" },
  { good: "grain", stock: 400, spread_bp: 800, bias_bp: 0, bid: "720", mid: "750", ask: "780" },
  { good: "iron", stock: 37, spread_bp: 800, bias_bp: 0, bid: "4565", mid: "4756", ask: "4946" },
  { good: "spice", stock: 55, spread_bp: 1200, bias_bp: 250, bid: "10261", mid: "10916", ask: "11570" },
  { good: "silk", stock: 12, spread_bp: 400, bias_bp: -1000, bid: "20815", mid: "21240", ask: "21664" },
  { good: "silk", stock: 60, spread_bp: 2000, bias_bp: 1500, bid: "15525", mid: "17250", ask: "18975" },
];

describe("golden vectors", () => {
  it.each(GOLDEN)("$good stock=$stock spread=$spread_bp bias=$bias_bp", (row) => {
    const q = quote({ good: row.good, stock: row.stock, spreadBp: row.spread_bp, biasBp: row.bias_bp });
    expect(q).toEqual({ bid: row.bid, mid: row.mid, ask: row.ask });
  });
});

describe("multBp", () => {
  it("truncates toward zero when target - stock is negative", () => {
    // target 40, stock 55: 3000 * -15 / 40 = -1125 exactly; use a non-exact case too.
    expect(multBp(55n, 40n)).toBe(8875n);
    // target 7, stock 8: 3000 * -1 / 7 = -428.57.. -> -428 (floor would give -429)
    expect(multBp(8n, 7n)).toBe(10000n - 428n);
  });
  it("clamps to [7500, 13500]; at K=3000 only the low clamp can bind", () => {
    // high side: 10000 + 3000 = 13000 at stock 0 is below 13500, so the upper clamp is never reached
    expect(multBp(0n, 200n)).toBe(13000n);
    // low side: stock 366 of target 200: 3000 * -166 / 200 = -2490 -> 7510 (not clamped); stock 367: -2505 -> 7495 -> 7500
    expect(multBp(366n, 200n)).toBe(7510n);
    expect(multBp(367n, 200n)).toBe(7500n);
    expect(multBp(400n, 200n)).toBe(7500n);
  });
});

describe("world constants vs spec", () => {
  it("mid price range of each good matches the spec table", () => {
    const table: Record<GoodId, [bigint, bigint]> = {
      grain: [750n, 1300n], salt: [1125n, 1950n], iron: [3000n, 5200n], spice: [9000n, 15600n], silk: [15000n, 26000n],
    };
    for (const g of GOOD_IDS) {
      const lo = quoteBig({ good: g, stock: GOODS[g].cap, spreadBp: 0, biasBp: 0 }).mid;
      const hi = quoteBig({ good: g, stock: 0, spreadBp: 0, biasBp: 0 }).mid;
      expect([lo, hi]).toEqual(table[g]);
    }
  });
  it("cap is twice the target", () => {
    for (const g of GOOD_IDS) expect(GOODS[g].cap).toBe(GOODS[g].target * PARAMS.STOCK_CAP_FACTOR);
  });
  it("world-wide production equals consumption for every good", () => {
    for (const g of GOOD_IDS) {
      let made = 0, used = 0;
      for (const c of Object.values(CITIES)) { made += c.produces[g] ?? 0; used += c.consumes[g] ?? 0; }
      expect({ g, made }).toEqual({ g, made: used });
    }
  });
  it("routes connect every pair of the four cities exactly once", () => {
    const pairs = new Set(ROUTES.map((r) => [r.a, r.b].sort().join("-")));
    expect(pairs.size).toBe(6);
  });
});

describe("tradeCost", () => {
  it("prices a buy at stock - qty/2 using ask, fee 1%", () => {
    // grain, stock 200, qty 10 -> midpoint stock 195; mult = 10000 + 3000*5/200 = 10075; mid = 1007 (1007.5); ask = 1007*10400/10000 = 1047 (1047.28)
    const c = tradeCost({ good: "grain", side: "buy", qty: 10, merchantStock: 200, spreadBp: 800, biasBp: 0 });
    expect(c.unit).toBe(1047n);
    expect(c.total).toBe(10470n);
    expect(c.fee).toBe(104n); // 104.7 truncated
  });
  it("prices a sell at stock + qty/2 using bid", () => {
    // midpoint stock 205; mult = 10000 + 3000*(-5)/200 = 9925; mid = 992 (992.5); bid = 992*9600/10000 = 952 (952.32 truncated)
    const c = tradeCost({ good: "grain", side: "sell", qty: 10, merchantStock: 200, spreadBp: 800, biasBp: 0 });
    expect(c.unit).toBe(952n);
    expect(c.total).toBe(9520n);
    expect(c.fee).toBe(95n); // 95.2 truncated
  });
  it("uses integer qty/2 for odd quantities", () => {
    // qty 5 -> half 2 -> buy at stock 198: mult = 10000 + 3000*2/200 = 10030; mid = 1003; ask = 1003*10400/10000 = 1043 (1043.12)
    const c = tradeCost({ good: "grain", side: "buy", qty: 5, merchantStock: 200, spreadBp: 800, biasBp: 0 });
    expect(c.unit).toBe(1043n);
  });
  it("rejects non-positive or fractional quantities", () => {
    expect(() => tradeCost({ good: "grain", side: "buy", qty: 0, merchantStock: 200, spreadBp: 0, biasBp: 0 })).toThrow(RangeError);
    expect(() => tradeCost({ good: "grain", side: "buy", qty: 1.5, merchantStock: 200, spreadBp: 0, biasBp: 0 })).toThrow(RangeError);
  });
});
