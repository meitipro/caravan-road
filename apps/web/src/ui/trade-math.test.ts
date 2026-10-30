import { describe, expect, it } from "vitest";
import { worldFixture } from "@caravan/shared";
import { addBuy, basisCost, removeUnits } from "./basis";
import {
  ambushLoss, estimateSale, guardCostFils, limitWithSlippage, maxBuyQty, maxSellQty, previewTrade, priceBand, riskWithGuards,
} from "./trade-math";

const bandar = worldFixture.merchants.find((m) => m.id === "bandar")!;

describe("previewTrade", () => {
  it("buy costs total + fee, sell pays total - fee, fee is 1% truncated", () => {
    const buy = previewTrade(bandar, "grain", "buy", 10)!;
    expect(buy.fee).toBe((buy.total * 100n) / 10000n);
    expect(buy.net).toBe(buy.total + buy.fee);
    const sell = previewTrade(bandar, "grain", "sell", 10)!;
    expect(sell.net).toBe(sell.total - sell.fee);
    expect(buy.unit > sell.unit).toBe(true);
  });
  it("rejects non-positive quantities", () => {
    expect(previewTrade(bandar, "grain", "buy", 0)).toBeNull();
  });
});

describe("limitWithSlippage", () => {
  it("widens a buy and narrows a sell by the slippage", () => {
    expect(limitWithSlippage("buy", 10000n, 200)).toBe(10200n);
    expect(limitWithSlippage("sell", 10000n, 200)).toBe(9800n);
    expect(limitWithSlippage("sell", 10n, 10000)).toBe(0n);
  });
});

describe("quantity limits", () => {
  it("maxBuyQty respects funds, cargo space and the 40 cap", () => {
    expect(maxBuyQty(bandar, "grain", 10_000_000n, 0)).toBe(40);
    expect(maxBuyQty(bandar, "grain", 10_000_000n, 35)).toBe(5);
    expect(maxBuyQty(bandar, "grain", 0n, 0)).toBe(0);
    const n = maxBuyQty(bandar, "iron", 50_000n, 0);
    expect(previewTrade(bandar, "iron", "buy", n)!.net <= 50_000n).toBe(true);
    expect(previewTrade(bandar, "iron", "buy", n + 1)!.net > 50_000n).toBe(true);
  });
  it("maxSellQty respects the merchant treasury", () => {
    const poor = { ...bandar, treasury: "5000" };
    const n = maxSellQty(poor, "iron", 40);
    expect(n).toBeLessThan(40);
    expect(previewTrade(poor, "iron", "sell", n)!.total <= 5000n).toBe(true);
    expect(previewTrade(poor, "iron", "sell", n + 1)!.total > 5000n).toBe(true);
  });
  it("maxSellQty respects holdings", () => {
    expect(maxSellQty(bandar, "grain", 7)).toBe(7);
    expect(maxSellQty(bandar, "grain", 100)).toBe(40);
  });
});

describe("journey math", () => {
  it("guards cost 2% of base value each", () => {
    expect(guardCostFils({ silk: 10 }, 1)).toBe(4000n);
    expect(guardCostFils({ silk: 10 }, 3)).toBe(12000n);
    expect(guardCostFils({ silk: 10 }, 0)).toBe(0n);
  });
  it("risk shrinks by 0.65 per guard", () => {
    expect(riskWithGuards("bandar", "shahr", 0)).toBe(800);
    expect(riskWithGuards("bandar", "shahr", 1)).toBe(520);
    expect(riskWithGuards("madan", "bandar", 3)).toBe(549);
  });
  it("ambush loss truncates 30% per good", () => {
    expect(ambushLoss({ grain: 10, silk: 3 })).toEqual({ grain: 3 });
  });
});

describe("estimateSale", () => {
  it("sells everything when the merchant is rich", () => {
    const rich = { ...bandar, treasury: "100000000" };
    const e = estimateSale(rich, { spice: 4 });
    expect(e.unsold).toBe(0);
    expect(e.net).toBe(previewTrade(rich, "spice", "sell", 4)!.net);
  });
  it("stops where the treasury runs out", () => {
    const poor = { ...bandar, treasury: "100000" };
    const e = estimateSale(poor, { spice: 30 });
    expect(e.unsold).toBeGreaterThan(0);
    expect(e.net > 0n).toBe(true);
  });
});

describe("priceBand", () => {
  it("classifies mid against base", () => {
    expect(priceBand(900n, "grain")).toBe("cheap");
    expect(priceBand(1000n, "grain")).toBe("fair");
    expect(priceBand(1200n, "grain")).toBe("dear");
  });
});

describe("basis", () => {
  it("averages purchases and removes proportionally", () => {
    let b = addBuy({}, "grain", 10, 10000n);
    b = addBuy(b, "grain", 10, 12000n);
    expect(basisCost(b, "grain", 20)).toBe(22000n);
    expect(basisCost(b, "grain", 5)).toBe(5500n);
    b = removeUnits(b, "grain", 10);
    expect(b.grain).toEqual({ qty: 10, cost: "11000" });
    b = removeUnits(b, "grain", 10);
    expect(b.grain).toBeUndefined();
    expect(basisCost(b, "grain", 1)).toBeNull();
  });
});
