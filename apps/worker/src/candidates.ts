// Ship options (spec 8.3, 8.9 task 2): the ONLY things the model may choose to ship.
// Every option is one the contract accepts (contracts/caravan/src/admin.rs try_ship + apply_shipment,
// math.rs ship_payment); the chain adapter still treats the contract as the final judge.
//
//   - qty 1..4 (NPC_SHIP_UNITS_PER_TICK), not more than the source holds or the destination's warehouse takes
//   - the destination is BELOW its target stock ("destination is not short of this good" otherwise)
//   - stock gap: (stock_from - stock_to) * 10000 >= 5000 * target (spec/OPEN_QUESTIONS.md #12)
//   - one shipment per good per tick: a good this merchant already shipped this tick is not offered
//   - payment = (mid(from) + mid(to)) / 2 per unit, both mids at the DEFAULT policy (spread 800, bias 0),
//     so neither merchant's own bias enters
//   - the destination pays at most 25% of (treasury + already paid this tick) per tick, summed over all
//     incoming merchant shipments. qty is reduced to fit that budget; the option is dropped only when not
//     even one unit fits.
//
// Options are sorted by ratio gap (largest first); the baseline ships options[0].

import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, GOODS, GOOD_IDS, PARAMS } from "@caravan/shared";
import { destinationShort, shipBudgetLeft, shipUnitPayment } from "./contract-rules.js";
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

export function computeShipOptions(snapshot: WorldSnapshot, from: CityId): ShipOption[] {
  const me = snapshot.merchants[from];
  const alreadyShipped = new Set<GoodId>(me.shipped_this_tick ?? []);
  const found: Array<Omit<ShipOption, "index">> = [];
  for (const to of CITY_IDS) {
    if (to === from) continue;
    const dest = snapshot.merchants[to];
    const budget = shipBudgetLeft(dest);
    for (const good of GOOD_IDS) {
      if (alreadyShipped.has(good)) continue;
      const target = GOODS[good].target;
      const fromStock = me.stock[good];
      const toStock = dest.stock[good];
      if (!destinationShort(good, toStock)) continue;
      if (!gapOk(fromStock, toStock, good)) continue;
      const headroom = target * PARAMS.STOCK_CAP_FACTOR - toStock;
      let qty = Math.min(PARAMS.NPC_SHIP_UNITS_PER_TICK, fromStock, headroom);
      // largest qty whose payment fits the destination's remaining budget for this tick
      const unit = shipUnitPayment(good, fromStock, toStock);
      if (unit > 0n) {
        const affordable = budget / unit; // bigint floor
        if (affordable < BigInt(qty)) qty = Number(affordable);
      }
      if (qty <= 0) continue;
      found.push({ to, good, qty, gap_bp: Math.trunc(((fromStock - toStock) * 10000) / target) });
    }
  }
  const order = (a: Omit<ShipOption, "index">) => CITY_IDS.indexOf(a.to) * 10 + GOOD_IDS.indexOf(a.good);
  found.sort((a, b) => b.gap_bp - a.gap_bp || order(a) - order(b));
  return found.slice(0, MAX_SHIP_OPTIONS).map((o, index) => ({ index, ...o }));
}
