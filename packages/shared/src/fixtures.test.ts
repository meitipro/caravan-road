import { describe, expect, it } from "vitest";
import { decisionsFixture, eventsFixture, leaderboardFixture, playersFixture, worldFixture } from "./fixtures.js";
import { netWorthFils, quote } from "./quote.js";
import { GOOD_IDS } from "./world.js";
import { requestSchemas } from "./schemas.js";

describe("fixtures", () => {
  it("validate against the zod schemas (parsed at import time)", () => {
    expect(worldFixture.merchants).toHaveLength(4);
    expect(Object.keys(playersFixture)).toHaveLength(3);
    expect(eventsFixture).toHaveLength(8);
    expect(decisionsFixture).toHaveLength(4);
    expect(leaderboardFixture.rows.length).toBeGreaterThan(0);
  });

  it("merchant quotes are exactly what quote() computes", () => {
    for (const m of worldFixture.merchants) {
      for (const g of GOOD_IDS) {
        expect(m.quotes[g]).toEqual(
          quote({ good: g, stock: m.stock[g], spreadBp: m.policy.spread_bp, biasBp: m.policy.bias_bp }),
        );
      }
    }
  });

  it("player net worth follows the A2 assumption", () => {
    for (const p of Object.values(playersFixture)) {
      expect(p.net_worth).toBe(netWorthFils(BigInt(p.fils), p.inventory).toString());
    }
  });

  it("leaderboard is sorted by net worth, descending", () => {
    const w = leaderboardFixture.rows.map((r) => BigInt(r.net_worth));
    for (let i = 1; i < w.length; i++) expect(w[i - 1]! >= w[i]!).toBe(true);
  });
});

describe("request schemas", () => {
  it("accept valid bodies", () => {
    expect(requestSchemas.trade.safeParse({ merchant: "dasht", good: "grain", side: "buy", qty: 10, limit_total: "12000" }).success).toBe(true);
    expect(requestSchemas.journeyStart.safeParse({ to: "shahr", cargo: { grain: 20 }, guards: 2 }).success).toBe(true);
  });
  it("reject numbers for money, over-cap quantity, unknown fields and too many guards", () => {
    expect(requestSchemas.trade.safeParse({ merchant: "dasht", good: "grain", side: "buy", qty: 10, limit_total: 12000 }).success).toBe(false);
    expect(requestSchemas.trade.safeParse({ merchant: "dasht", good: "grain", side: "buy", qty: 41, limit_total: "1" }).success).toBe(false);
    expect(requestSchemas.trade.safeParse({ merchant: "dasht", good: "grain", side: "buy", qty: 1, limit_total: "1", x: 1 }).success).toBe(false);
    expect(requestSchemas.journeyStart.safeParse({ to: "shahr", cargo: {}, guards: 4 }).success).toBe(false);
    expect(requestSchemas.trade.safeParse({ merchant: "dasht", good: "grain", side: "buy", qty: 1, limit_total: "01" }).success).toBe(false);
  });
});
