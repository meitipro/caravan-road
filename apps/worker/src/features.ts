// Bounded-integer features computed by the worker (spec 8.3 / 8.9 task 2).
// Nothing in here is free text: every leaf is an integer, or a city/good id from the fixed sets.

import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, findRoute, GOODS, GOOD_IDS, PARAMS } from "@caravan/shared";
import type { MerchantSnapshot, WorldSnapshot } from "./types.js";

export const RATIO_CAP_BP = 30000;
export const TREASURY_CAP_BP = 100000;
export const FLOW_CAP_BP = 20000;
export const FLOW_WINDOW_TICKS = 10;

export interface GoodFeature {
  /** stock * 10000 / target, truncated, capped at 30000 */
  stock_ratio_bp: number;
  /** (stock now - stock ~10 ticks ago) * 10000 / target, clamped to +-20000; 0 without history */
  flow10_bp: number;
}

export interface NeighborFeature {
  city: CityId;
  route_risk_bp: number;
  route_seconds: number;
  treasury_bp: number;
  ratios_bp: Record<GoodId, number>;
}

export interface Features {
  merchant: CityId;
  treasury_bp: number;
  avg_ratio_bp: number;
  policy: { spread_bp: number; bias_bp: number };
  goods: Record<GoodId, GoodFeature>;
  neighbors: NeighborFeature[];
}

const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v) + 0; // + 0 turns -0 into 0

export function ratioBp(stock: number, good: GoodId): number {
  return clampInt(Math.trunc((stock * 10000) / GOODS[good].target), 0, RATIO_CAP_BP);
}

export function treasuryBp(treasury: bigint): number {
  const bp = (treasury * 10000n) / BigInt(PARAMS.MERCHANT_TREASURY_FILS);
  return bp > BigInt(TREASURY_CAP_BP) ? TREASURY_CAP_BP : bp < 0n ? 0 : Number(bp);
}

/** Mean over goods of stock*10000/target, integer (spec 8.6). Uses the uncapped ratio (max 20000 anyway). */
export function avgRatioBp(stock: Record<GoodId, number>): number {
  let sum = 0;
  for (const g of GOOD_IDS) sum += Math.trunc((stock[g] * 10000) / GOODS[g].target);
  return Math.trunc(sum / GOOD_IDS.length);
}

/** In-memory ring of recent stocks per merchant; lost on restart (flow is then 0 until history builds up). */
export class StockHistory {
  private readonly rows = new Map<CityId, Array<{ tick: number; stock: Record<GoodId, number> }>>();

  record(snapshot: WorldSnapshot): void {
    for (const city of CITY_IDS) {
      const m = snapshot.merchants[city];
      const list = this.rows.get(city) ?? [];
      const last = list[list.length - 1];
      if (last && last.tick === snapshot.tick) list.pop(); // same tick re-read: overwrite
      list.push({ tick: snapshot.tick, stock: { ...m.stock } });
      while (list.length > 0 && list[0]!.tick < snapshot.tick - FLOW_WINDOW_TICKS) list.shift();
      this.rows.set(city, list);
    }
  }

  /** Stock change over the oldest retained point within the last 10 ticks, in bp of target. */
  flowBp(city: CityId, good: GoodId, nowTick: number, nowStock: number): number {
    const list = this.rows.get(city) ?? [];
    const oldest = list.find((r) => r.tick >= nowTick - FLOW_WINDOW_TICKS && r.tick < nowTick);
    if (!oldest) return 0;
    const delta = nowStock - oldest.stock[good];
    return clampInt(Math.trunc((delta * 10000) / GOODS[good].target), -FLOW_CAP_BP, FLOW_CAP_BP);
  }
}

export function buildFeatures(snapshot: WorldSnapshot, city: CityId, history: StockHistory): Features {
  const me: MerchantSnapshot = snapshot.merchants[city];
  const goods = {} as Record<GoodId, GoodFeature>;
  for (const g of GOOD_IDS) {
    goods[g] = {
      stock_ratio_bp: ratioBp(me.stock[g], g),
      flow10_bp: history.flowBp(city, g, snapshot.tick, me.stock[g]),
    };
  }
  const neighbors: NeighborFeature[] = [];
  for (const other of CITY_IDS) {
    if (other === city) continue;
    const route = findRoute(city, other);
    if (!route) throw new Error(`no route ${city}-${other}`);
    const o = snapshot.merchants[other];
    const ratios = {} as Record<GoodId, number>;
    for (const g of GOOD_IDS) ratios[g] = ratioBp(o.stock[g], g);
    neighbors.push({
      city: other,
      route_risk_bp: route.riskBp,
      route_seconds: route.durationSec,
      treasury_bp: treasuryBp(o.treasury),
      ratios_bp: ratios,
    });
  }
  return {
    merchant: city,
    treasury_bp: treasuryBp(me.treasury),
    avg_ratio_bp: avgRatioBp(me.stock),
    policy: { spread_bp: me.policy.spread_bp, bias_bp: me.policy.bias_bp },
    goods,
    neighbors,
  };
}

const CITY_SET = new Set<string>(CITY_IDS);
const GOOD_SET = new Set<string>(GOOD_IDS);

/**
 * Runtime guard used before anything goes into a prompt: every leaf must be a finite integer, or
 * a string that is exactly a city/good id. Throws otherwise. This is what makes "no player text in
 * the prompt" a checked property rather than a convention.
 */
export function assertNoFreeText(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`non-integer at ${path}`);
    return;
  }
  if (typeof value === "string") {
    if (!CITY_SET.has(value) && !GOOD_SET.has(value)) throw new Error(`free text at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFreeText(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (!/^[a-z0-9_]+$/.test(k)) throw new Error(`odd key at ${path}`);
      assertNoFreeText(v, `${path}.${k}`);
    }
    return;
  }
  throw new Error(`unsupported leaf at ${path}`);
}
