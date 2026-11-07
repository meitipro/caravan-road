// Deterministic baseline policy (spec 8.6). No model, no randomness.
//
//   avg_ratio_bp = mean over goods of stock*10000/target
//   treasury_bp  = treasury*10000/initial_treasury
//   spread_bp    = clamp(800 + max(0, 10000-treasury_bp)/10, 400, 2000)   # poorer -> wider
//   bias_bp      = clamp((10000-avg_ratio_bp)/4, -1500, 1500)             # scarce -> pay more
//   ship         = candidate with the largest ratio gap, else null
//
// Integer division truncates toward zero (Math.trunc), as everywhere else.

import type { Mood } from "@caravan/shared";
import { PARAMS } from "@caravan/shared";
import type { ShipOption } from "./candidates.js";
import type { Features } from "./features.js";
import { PERSONAS } from "./personas.js";

export interface BaselineDecision {
  spread_bp: number;
  bias_bp: number;
  mood: Mood;
  ship: ShipOption | null;
  line: string;
  reason: string;
}

/** Clamp; also normalises -0 to 0 (Math.trunc(-0.75) is -0). */
export const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v) + 0;

export function baselineSpread(treasuryBp: number): number {
  return clampInt(
    PARAMS.SPREAD_DEFAULT_BP + Math.trunc(Math.max(0, 10000 - treasuryBp) / 10),
    PARAMS.SPREAD_MIN_BP,
    PARAMS.SPREAD_MAX_BP,
  );
}

export function baselineBias(avgRatioBp: number): number {
  return clampInt(Math.trunc((10000 - avgRatioBp) / 4), PARAMS.BIAS_MIN_BP, PARAMS.BIAS_MAX_BP);
}

/** Mood derived from the same two numbers; also used when the model gives no valid mood. */
export function deriveMood(treasuryBp: number, avgRatioBp: number): Mood {
  if (treasuryBp < 6000) return "worried";
  if (avgRatioBp < 7500) return "greedy";
  if (avgRatioBp > 12500) return "generous";
  return "calm";
}

export function baselineDecision(features: Features, options: ShipOption[]): BaselineDecision {
  const spread_bp = baselineSpread(features.treasury_bp);
  const bias_bp = baselineBias(features.avg_ratio_bp);
  const mood = deriveMood(features.treasury_bp, features.avg_ratio_bp);
  const ship = options.length > 0 ? options[0]! : null;
  return {
    spread_bp,
    bias_bp,
    mood,
    ship,
    line: PERSONAS[features.merchant].fallbackLines[mood],
    reason: `Baseline rule: treasury ${features.treasury_bp} bp of initial, average stock ${features.avg_ratio_bp} bp of target.`,
  };
}
