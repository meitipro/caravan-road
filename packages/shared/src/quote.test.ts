import { describe, expect, it } from "vitest";
import { multBp, quote, quoteBig, tradeCost } from "./quote.js";
import { CITIES, GOODS, GOOD_IDS, PARAMS, ROUTES } from "./world.js";
import type { GoodId } from "./types.js";

// spec/ECONOMY.md: golden vectors table, row by row.
const GOLDEN: Array<{
  good: GoodId; stock: number; spread_bp: number; bias_bp: number; bid: string; mid: string; ask: string;
}> = [
  { good: "grain", stock: 0, spread_bp: 800, bias_bp: 0, bid: "1296", mid: "1350", ask: "1404" },
  { good: "grain", stock: 200, spread_bp: 800, bias_bp: 0, bid: "960", mid: "1000", ask: "1040" },
  { good: "grain", stock: 400, spread_bp: 800, bias_bp: 0, bid: "720", mid: "750", ask: "780" },
  { good: "iron", stock: 37, spread_bp: 800, bias_bp: 0, bid: "4807", mid: "5008", ask: "5208" },
  { good: "spice", stock: 55, spread_bp: 1200, bias_bp: 250, bid: "9827", mid: "10455", ask: "11082" },
  { good: "silk", stock: 12, spread_bp: 400, bias_bp: -1000, bid: "21873", mid: "22320", ask: "22766" },
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
    // target 40, stock 55: 4000 * -15 / 40 = -1500 exactly; use a non-exact case too.
    expect(multBp(55n, 40n)).toBe(8500n);
    // 4000 * -1 / 3 = -1333.33.. -> -1333 (floor would give -1334)
    expect(multBp(4n, 3n)).toBe(10000n - 1333n);
  });
  it("clamps to [7500, 13500]", () => {
    expect(multBp(0n, 200n)).toBe(13500n);
    expect(multBp(400n, 200n)).toBe(7500n);
  });
});

describe("world constants vs spec", () => {
  it("mid price range of each good matches the spec table", () => {
    const table: Record<GoodId, [bigint, bigint]> = {
      grain: [750n, 1350n], salt: [1125n, 2025n], iron: [3000n, 5400n], spice: [9000n, 16200n], silk: [15000n, 27000n],
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
    // grain, stock 200, qty 10 -> midpoint stock 195; mult = 10000 + 4000*5/200 = 10100; mid = 1010; ask = 1010*10400/10000 = 1050
    const c = tradeCost({ good: "grain", side: "buy", qty: 10, merchantStock: 200, spreadBp: 800, biasBp: 0 });
    expect(c.unit).toBe(1050n);
    expect(c.total).toBe(10500n);
    expect(c.fee).toBe(105n);
  });
  it("prices a sell at stock + qty/2 using bid", () => {
    // midpoint stock 205; mult = 10000 + 4000*(-5)/200 = 9900; mid = 990; bid = 990*9600/10000 = 950 (950.4 truncated)
    const c = tradeCost({ good: "grain", side: "sell", qty: 10, merchantStock: 200, spreadBp: 800, biasBp: 0 });
    expect(c.unit).toBe(950n);
    expect(c.total).toBe(9500n);
    expect(c.fee).toBe(95n);
  });
  it("uses integer qty/2 for odd quantities", () => {
    // qty 5 -> half 2 -> buy at stock 198: mult = 10000 + 4000*2/200 = 10040; mid = 1004; ask = 1004*10400/10000 = 1044 (1044.16)
    const c = tradeCost({ good: "grain", side: "buy", qty: 5, merchantStock: 200, spreadBp: 800, biasBp: 0 });
    expect(c.unit).toBe(1044n);
  });
  it("rejects non-positive or fractional quantities", () => {
    expect(() => tradeCost({ good: "grain", side: "buy", qty: 0, merchantStock: 200, spreadBp: 0, biasBp: 0 })).toThrow(RangeError);
    expect(() => tradeCost({ good: "grain", side: "buy", qty: 1.5, merchantStock: 200, spreadBp: 0, biasBp: 0 })).toThrow(RangeError);
  });
});
