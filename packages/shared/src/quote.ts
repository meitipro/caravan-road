// Integer price math from spec/ECONOMY.md section 2.6.
// BigInt division truncates toward zero, matching Rust i128; never use Math.floor here.

import type { GoodId, Quote } from "./types.js";
import { BP, GOODS, PARAMS } from "./world.js";

const MULT_K_BP = BigInt(PARAMS.MULT_K_BP);
const MULT_MIN_BP = BigInt(PARAMS.MULT_MIN_BP);
const MULT_MAX_BP = BigInt(PARAMS.MULT_MAX_BP);

function clamp(v: bigint, lo: bigint, hi: bigint): bigint {
  return v < lo ? lo : v > hi ? hi : v;
}

/** mult_bp(stock, target) = clamp(10000 + 4000 * (target - stock) / target, 7500, 13500) */
export function multBp(stock: bigint, target: bigint): bigint {
  return clamp(BP + (MULT_K_BP * (target - stock)) / target, MULT_MIN_BP, MULT_MAX_BP);
}

export interface QuoteInput {
  good: GoodId;
  stock: number | bigint;
  spreadBp: number | bigint;
  biasBp: number | bigint;
}

export interface QuoteBig { bid: bigint; mid: bigint; ask: bigint }

export function quoteBig({ good, stock, spreadBp, biasBp }: QuoteInput): QuoteBig {
  const spec = GOODS[good];
  const spread = BigInt(spreadBp);
  const bias = BigInt(biasBp);
  const m = multBp(BigInt(stock), BigInt(spec.target));
  const base = (spec.baseFils * m) / BP;
  const mid = (base * (BP + bias)) / BP;
  const ask = (mid * (BP + spread / 2n)) / BP;
  const bid = (mid * (BP - spread / 2n)) / BP;
  return { bid, mid, ask };
}

/** Same as quoteBig, with money rendered as decimal strings for the API boundary. */
export function quote(input: QuoteInput): Quote {
  const q = quoteBig(input);
  return { bid: q.bid.toString(), mid: q.mid.toString(), ask: q.ask.toString() };
}

/**
 * OPEN_QUESTIONS #2: net worth = fils + sum(qty * base price). The spec does not define it
 * (spec/OPEN_QUESTIONS.md #2); cargo in transit and stall goods are not counted.
 */
export function netWorthFils(fils: bigint, inventory: Partial<Record<GoodId, number>>): bigint {
  let total = fils;
  for (const [good, qty] of Object.entries(inventory) as Array<[GoodId, number | undefined]>) {
    total += GOODS[good].baseFils * BigInt(qty ?? 0);
  }
  return total;
}

export type Side = "buy" | "sell";

export interface TradeCostInput {
  good: GoodId;
  side: Side;
  qty: number;
  merchantStock: number;
  spreadBp: number;
  biasBp: number;
}

export interface TradeCost {
  /** unit price at the trade's midpoint stock */
  unit: bigint;
  /** qty * unit, before the fee */
  total: bigint;
  /** 1% of total, taken from the player's side */
  fee: bigint;
}

/**
 * Prices a buy (player buys from merchant, at ask) or a sell (player sells to merchant, at bid)
 * at the MIDPOINT stock of the trade: stock - qty/2 for a buy, stock + qty/2 for a sell.
 *
 * Spec 2.6: total = qty * unit, fee = total * TRADE_FEE_BP / BP, both truncated (OPEN_QUESTIONS #7 for limit_total).
 * A buy costs total + fee; a sell pays total - fee.
 */
export function tradeCost(input: TradeCostInput): TradeCost {
  const { good, side, qty, merchantStock, spreadBp, biasBp } = input;
  if (!Number.isInteger(qty) || qty <= 0) throw new RangeError("qty must be a positive integer");
  const half = BigInt(qty) / 2n;
  const stock = BigInt(merchantStock);
  const midStock = side === "buy" ? stock - half : stock + half;
  const q = quoteBig({ good, stock: midStock, spreadBp, biasBp });
  const unit = side === "buy" ? q.ask : q.bid;
  const total = BigInt(qty) * unit;
  const fee = (total * BigInt(PARAMS.TRADE_FEE_BP)) / BP;
  return { unit, total, fee };
}
