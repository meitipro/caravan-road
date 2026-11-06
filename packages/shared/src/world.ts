// World constants copied from spec/GAME.md and spec/ECONOMY.md.
// Money is bigint (fils). Do not change a number here without a spec version bump.

import type { CityId, GoodId } from "./types.js";

export const GOOD_IDS = ["grain", "salt", "iron", "spice", "silk"] as const satisfies readonly GoodId[];
export const CITY_IDS = ["dasht", "madan", "bandar", "shahr"] as const satisfies readonly CityId[];

export interface GoodSpec {
  id: GoodId;
  baseFils: bigint;
  target: number;
  cap: number; // 2 x target
}

export const GOODS: Record<GoodId, GoodSpec> = {
  grain: { id: "grain", baseFils: 1000n, target: 200, cap: 400 },
  salt: { id: "salt", baseFils: 1500n, target: 120, cap: 240 },
  iron: { id: "iron", baseFils: 4000n, target: 100, cap: 200 },
  spice: { id: "spice", baseFils: 12000n, target: 40, cap: 80 },
  silk: { id: "silk", baseFils: 20000n, target: 30, cap: 60 },
};

export interface CitySpec {
  id: CityId;
  produces: Partial<Record<GoodId, number>>; // per tick
  consumes: Partial<Record<GoodId, number>>; // per tick
}

export const CITIES: Record<CityId, CitySpec> = {
  dasht: { id: "dasht", produces: { grain: 8, salt: 3 }, consumes: { iron: 2, spice: 1, silk: 1 } },
  madan: { id: "madan", produces: { iron: 4, salt: 2 }, consumes: { grain: 4, spice: 1, silk: 1 } },
  bandar: { id: "bandar", produces: { spice: 4, silk: 3 }, consumes: { grain: 3, iron: 3, salt: 2 } },
  shahr: { id: "shahr", produces: { iron: 1 }, consumes: { grain: 1, salt: 3, spice: 2, silk: 1 } },
};

export interface RouteSpec {
  a: CityId;
  b: CityId;
  durationSec: number;
  riskBp: number; // ambush risk without guards
}

// Routes are bidirectional; `a` and `b` follow the written order of spec/GAME.md section 2.4.
export const ROUTES: readonly RouteSpec[] = [
  { a: "bandar", b: "shahr", durationSec: 180, riskBp: 800 },
  { a: "shahr", b: "dasht", durationSec: 240, riskBp: 1200 },
  { a: "dasht", b: "madan", durationSec: 300, riskBp: 1500 },
  { a: "madan", b: "bandar", durationSec: 360, riskBp: 2000 },
  { a: "bandar", b: "dasht", durationSec: 270, riskBp: 1000 },
  { a: "shahr", b: "madan", durationSec: 330, riskBp: 1800 },
];

export function findRoute(from: CityId, to: CityId): RouteSpec | undefined {
  return ROUTES.find((r) => (r.a === from && r.b === to) || (r.a === to && r.b === from));
}

// Parameter names and values: spec/ECONOMY.md section 2.5 and Appendix A (world.py).
export const PARAMS = {
  TICK_SECONDS: 60,
  MULT_K_BP: 3000, // spec-v1.2; spec-v1.1 was 4000
  MULT_MIN_BP: 7500,
  MULT_MAX_BP: 13500,
  STOCK_CAP_FACTOR: 2,
  SPREAD_DEFAULT_BP: 800,
  SPREAD_MIN_BP: 400,
  SPREAD_MAX_BP: 2000,
  BIAS_MIN_BP: -1500,
  BIAS_MAX_BP: 1500,
  TRADE_FEE_BP: 100,
  MAX_QTY_PER_TRADE: 40,
  CARGO_CAP: 40,
  GUARD_COST_BP: 200, // of the cargo base value, per guard
  GUARD_RISK_FACTOR_BP: 6500,
  MAX_GUARDS: 3,
  AMBUSH_LOSS_BP: 3000,
  MERCHANT_TREASURY_FILS: 50000, // 5 USDC
  FAUCET_FILS: 50000, // 500 dinar (PLAY only)
  MAX_DEPOSIT_FILS: 200000, // 20 USDC
  DAILY_WITHDRAW_CAP_FILS: 100000, // 10 USDC
  STALL_FEE_BP: 200,
  NPC_SHIP_UNITS_PER_TICK: 4,
  NPC_MIN_RATIO_GAP_BP: 5000,
  REBALANCE_EXCESS_FROM_BP: 15000,
  REBALANCE_PCT: 30,
  HOUSE_RECYCLE_PCT: 10,
} as const;

/** Section 2.8: world_tick() rate limits. */
export const TICK_RULES = { MIN_INTERVAL_SECONDS: 55, MAX_MISSED_TICKS: 10 } as const;

/** Section 2.1. */
export const FILS_PER_DINAR = 100;
export const FILS_PER_USDC = 10000;

/** 100% in basis points, as bigint for money math. */
export const BP = 10000n;
