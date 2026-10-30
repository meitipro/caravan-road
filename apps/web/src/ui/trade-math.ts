// Pure helpers on top of @caravan/shared quote math. All money is bigint fils; nothing here uses Number on money.

import {
  GOODS, GOOD_IDS, PARAMS, findRoute, tradeCost,
  type CityId, type GoodId, type Merchant, type Side,
} from "@caravan/shared";
import { bpOf } from "./format";

export type Cargo = Partial<Record<GoodId, number>>;

export interface TradePreview {
  qty: number;
  unit: bigint;
  total: bigint;
  fee: bigint;
  /** buy: total + fee (what leaves the purse); sell: total - fee (what arrives) */
  net: bigint;
}

export function previewTrade(m: Merchant, good: GoodId, side: Side, qty: number): TradePreview | null {
  if (!Number.isInteger(qty) || qty <= 0) return null;
  const c = tradeCost({
    good, side, qty, merchantStock: m.stock[good], spreadBp: m.policy.spread_bp, biasBp: m.policy.bias_bp,
  });
  return { qty, unit: c.unit, total: c.total, fee: c.fee, net: side === "buy" ? c.total + c.fee : c.total - c.fee };
}

/**
 * limit_total for the API (spec/OPEN_QUESTIONS #7, ASSUMPTION A12):
 * buy: total + fee must be <= limit; sell: total - fee must be >= limit.
 */
export function limitWithSlippage(side: Side, net: bigint, slippageBp: number): bigint {
  const slack = bpOf(net, slippageBp);
  if (side === "buy") return net + slack;
  const v = net - slack;
  return v < 0n ? 0n : v;
}

export const cargoUnits = (c: Cargo): number => GOOD_IDS.reduce((s, g) => s + (c[g] ?? 0), 0);

/** Largest quantity (<= `cap`) whose buy cost fits in `fils`; 0 if even one unit does not. */
export function maxAffordable(m: Merchant, good: GoodId, fils: bigint, cap: number): number {
  let lo = 0;
  let hi = Math.max(0, cap);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const p = previewTrade(m, good, "buy", mid);
    if (p && p.net <= fils) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function maxBuyQty(m: Merchant, good: GoodId, fils: bigint, carried: number): number {
  const cap = Math.min(PARAMS.MAX_QTY_PER_TRADE, m.stock[good], PARAMS.CARGO_CAP - carried);
  return maxAffordable(m, good, fils, cap);
}

/** Most units the merchant can take: limited by holdings, warehouse room, the 40 cap and its treasury. */
export function maxSellQty(m: Merchant, good: GoodId, owned: number): number {
  const room = GOODS[good].cap - m.stock[good];
  const cap = Math.max(0, Math.min(PARAMS.MAX_QTY_PER_TRADE, owned, room));
  const treasury = BigInt(m.treasury);
  let lo = 0;
  let hi = cap;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const p = previewTrade(m, good, "sell", mid);
    if (p && p.total <= treasury) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function cargoBaseValue(c: Cargo): bigint {
  return GOOD_IDS.reduce((s, g) => s + GOODS[g].baseFils * BigInt(c[g] ?? 0), 0n);
}

/** Each guard costs 2% of the cargo's base value (spec 2.4). */
export function guardCostFils(c: Cargo, guards: number): bigint {
  return bpOf(cargoBaseValue(c), PARAMS.GUARD_COST_BP) * BigInt(guards);
}

/** risk = base_risk_bp * 6500^g / 10000^g, applied step by step like the mock (integer, truncated). */
export function riskWithGuards(from: CityId, to: CityId, guards: number): number {
  const route = findRoute(from, to);
  if (!route) return 0;
  let risk = BigInt(route.riskBp);
  for (let i = 0; i < guards; i++) risk = (risk * BigInt(PARAMS.GUARD_RISK_FACTOR_BP)) / 10000n;
  return Number(risk);
}

/** Units lost in an ambush: trunc(qty * 30%) per good (spec 2.4 text; see OPEN_QUESTIONS #6). */
export function ambushLoss(c: Cargo): Cargo {
  const out: Cargo = {};
  for (const g of GOOD_IDS) {
    const n = c[g] ?? 0;
    const l = Number((BigInt(n) * BigInt(PARAMS.AMBUSH_LOSS_BP)) / 10000n);
    if (l > 0) out[g] = l;
  }
  return out;
}

export interface SaleEstimate {
  /** dinars (fils) received after fees for what the merchant can take */
  net: bigint;
  /** units the merchant cannot take now (treasury or warehouse limits) */
  unsold: number;
}

/**
 * What selling `cargo` at merchant `m` would pay right now: goods are sold one trade after another
 * (max 40 units each), each at its midpoint price, stopping where the merchant's treasury or warehouse runs out.
 */
export function estimateSale(m: Merchant, cargo: Cargo): SaleEstimate {
  let net = 0n;
  let unsold = 0;
  let treasury = BigInt(m.treasury);
  const stock = { ...m.stock };
  for (const g of GOOD_IDS) {
    let left = cargo[g] ?? 0;
    while (left > 0) {
      const view: Merchant = { ...m, stock, treasury: treasury.toString() };
      const q = maxSellQty(view, g, Math.min(left, PARAMS.MAX_QTY_PER_TRADE));
      if (q <= 0) break;
      const p = previewTrade(view, g, "sell", q)!;
      net += p.net;
      treasury -= p.total;
      stock[g] += q;
      left -= q;
    }
    unsold += left;
  }
  return { net, unsold };
}

export function estimateSaleNet(m: Merchant, cargo: Cargo): bigint {
  return estimateSale(m, cargo).net;
}

/** Price tag relative to the good's base: "cheap" under 95%, "dear" above 105% (mid price). */
export function priceBand(mid: bigint, good: GoodId): "cheap" | "fair" | "dear" {
  const base = GOODS[good].baseFils;
  if (mid * 100n < base * 95n) return "cheap";
  if (mid * 100n > base * 105n) return "dear";
  return "fair";
}
