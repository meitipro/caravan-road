// Ship options (spec 8.3, 8.9 task 2): the ONLY things the model may choose to ship.
// Rule = the world-tick house-caravan rule (spec 2.8) with the integer gap test recommended in
// spec/OPEN_QUESTIONS.md #12:  (stock_from - stock_to) * 10000 >= 5000 * target.
// qty <= 4 (NPC_SHIP_UNITS_PER_TICK), the destination treasury must be able to pay the midpoint price.
// The chain adapter treats the contract as the final judge: a rejected ship is recorded, never forced.

import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, GOODS, GOOD_IDS, PARAMS, quoteBig } from "@caravan/shared";
import type { WorldSnapshot } from "./types.js";

export interface ShipOption {
  index: number;
  to: CityId;
  good: GoodId;
  qty: number;
  /** (stock_from - stock_to) * 10000 / target, truncated */
  gap_bp: number;
}

export const MAX_SHIP_OPTIONS = 4;

/** Integer gap test, no floats. */
export function gapOk(fromStock: number, toStock: number, good: GoodId): boolean {
  return (fromStock - toStock) * 10000 >= PARAMS.NPC_MIN_RATIO_GAP_BP * GOODS[good].target;
}

/** Midpoint price per unit between two cities: (mid_from + mid_to) / 2, truncated (spec 2.8 step 4). */
export function shipUnitPrice(good: GoodId, fromStock: number, toStock: number, fromBias: number, toBias: number): bigint {
  const q = (stock: number, bias: number) =>
    quoteBig({ good, stock, spreadBp: PARAMS.SPREAD_DEFAULT_BP, biasBp: bias }).mid;
  const withBias = (q(fromStock, fromBias) + q(toStock, toBias)) / 2n;
  const noBias = (q(fromStock, 0) + q(toStock, 0)) / 2n;
  // The contract's exact bias handling is not in the spec; require the destination to afford the
  // higher of the two so the option is acceptable under either reading.
  return withBias > noBias ? withBias : noBias;
}

export function computeShipOptions(snapshot: WorldSnapshot, from: CityId): ShipOption[] {
  const me = snapshot.merchants[from];
  const found: Array<Omit<ShipOption, "index">> = [];
  for (const to of CITY_IDS) {
    if (to === from) continue;
    const dest = snapshot.merchants[to];
    for (const good of GOOD_IDS) {
      const target = GOODS[good].target;
      const fromStock = me.stock[good];
      const toStock = dest.stock[good];
      if (!gapOk(fromStock, toStock, good)) continue;
      const headroom = target * PARAMS.STOCK_CAP_FACTOR - toStock;
      let qty = Math.min(PARAMS.NPC_SHIP_UNITS_PER_TICK, fromStock, headroom);
      while (qty > 0) {
        const unit = shipUnitPrice(good, fromStock, toStock, me.policy.bias_bp, dest.policy.bias_bp);
        if (dest.treasury >= unit * BigInt(qty)) break;
        qty -= 1;
      }
      if (qty <= 0) continue;
      found.push({ to, good, qty, gap_bp: Math.trunc(((fromStock - toStock) * 10000) / target) });
    }
  }
  const order = (a: Omit<ShipOption, "index">) => CITY_IDS.indexOf(a.to) * 10 + GOOD_IDS.indexOf(a.good);
  found.sort((a, b) => b.gap_bp - a.gap_bp || order(a) - order(b));
  return found.slice(0, MAX_SHIP_OPTIONS).map((o, index) => ({ index, ...o }));
}
