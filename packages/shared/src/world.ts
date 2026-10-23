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

// Routes are bidirectional; `a` and `b` follow the spec's written order.
export const ROUTES: readonly RouteSpec[] = [
  { a: "shahr", b: "bandar", durationSec: 180, riskBp: 800 },
  { a: "dasht", b: "shahr", durationSec: 240, riskBp: 1200 },
  { a: "madan", b: "dasht", durationSec: 300, riskBp: 1500 },
  { a: "bandar", b: "madan", durationSec: 360, riskBp: 2000 },
  { a: "dasht", b: "bandar", durationSec: 270, riskBp: 1000 },
  { a: "madan", b: "shahr", durationSec: 330, riskBp: 1800 },
];

export function findRoute(from: CityId, to: CityId): RouteSpec | undefined {
  return ROUTES.find((r) => (r.a === from && r.b === to) || (r.a === to && r.b === from));
}

// ASSUMPTION(A15): constant names are ours; only numbers written in the spec appear here.
export const PARAMS = {
  BP: 10000n,
  MULT_K_BP: 4000n,
  MULT_MIN_BP: 7500n,
  MULT_MAX_BP: 13500n,
  TRADE_FEE_BP: 100n,
  STALL_FEE_BP: 200n,
  MAX_TRADE_QTY: 40,
  CARAVAN_CAPACITY: 40,
  STOCK_CAP_FACTOR: 2,
  FILS_PER_DINAR: 100n,
  FILS_PER_USDC: 10000n,
  PLAY_FAUCET_FILS: 50000n, // 500 dinar
  GUARD_COST_BP: 200n, // of the cargo base value, per guard
  GUARD_RISK_MULT_BP: 6500n, // 0.65
  MAX_GUARDS: 3,
  AMBUSH_LOSS_BP: 3000n,
  TICK_SECONDS: 60,
  TICK_MIN_INTERVAL_SECONDS: 55,
  TICK_MAX_BACKLOG: 10,
  TREASURY_REDISTRIBUTE_ABOVE_BP: 15000n, // of the initial treasury
  TREASURY_REDISTRIBUTE_SHARE_BP: 3000n,
  HOUSE_RECYCLE_BP: 1000n,
  HOME_CARAVAN_GAP_BP: 5000n,
  HOME_CARAVAN_MAX_UNITS: 4,
} as const;
