// Small deterministic world snapshots built from ratios. Used by the few-shot examples, by tests
// and by the evaluation harness. No randomness here.

import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, GOODS, GOOD_IDS, PARAMS } from "@caravan/shared";
import type { WorldSnapshot } from "./types.js";

export interface ScenarioSpec {
  /** merchant treasury as bp of the initial treasury */
  treasury_bp: number;
  /** stock ratios (bp of target) for the merchant itself; unspecified goods sit at 10000 */
  own_ratio_bp?: Partial<Record<GoodId, number>>;
  /** stock ratios for every other city */
  others_ratio_bp?: Partial<Record<GoodId, number>>;
  /** policy currently in force for all merchants */
  policy?: { spread_bp: number; bias_bp: number };
}

const stockFromRatio = (good: GoodId, bp: number): number => Math.trunc((bp * GOODS[good].target) / 10000);

export function scenarioSnapshot(city: CityId, spec: ScenarioSpec): WorldSnapshot {
  const merchants = {} as WorldSnapshot["merchants"];
  for (const id of CITY_IDS) {
    const ratios = id === city ? spec.own_ratio_bp : spec.others_ratio_bp;
    const stock = {} as Record<GoodId, number>;
    for (const g of GOOD_IDS) stock[g] = stockFromRatio(g, ratios?.[g] ?? 10000);
    const treasury =
      id === city ? (BigInt(spec.treasury_bp) * BigInt(PARAMS.MERCHANT_TREASURY_FILS)) / 10000n : BigInt(PARAMS.MERCHANT_TREASURY_FILS);
    merchants[id] = {
      id,
      treasury,
      stock,
      policy: { ...(spec.policy ?? { spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0 }) },
    };
  }
  return { tick: 100, now: 1_800_000_000, merchants };
}
