// The contract's merchant-call rules that the worker must respect, written once.
// Ground truth: contracts/caravan/src/admin.rs (try_set_policy, try_ship) and math.rs (ship_payment,
// pct, POLICY_MAX_STEP_BP, SHIP_MAX_PAY_PCT). The strict FakeContract in apps/web mirrors them.
// SimWorld enforces the same rules, so the dry run and the tests cannot drift from the contract.

import type { GoodId } from "@caravan/shared";
import { GOODS, PARAMS, quoteBig } from "@caravan/shared";
import type { MerchantSnapshot } from "./types.js";

/** set_policy: spread_bp and bias_bp may each move at most this far from the CURRENT policy per call. */
export const POLICY_MAX_STEP_BP = 300;
/** ship: the destination pays at most this % of (treasury + already paid this tick) per tick. */
export const SHIP_MAX_PAY_PCT = 25n;

export interface Policy {
  spread_bp: number;
  bias_bp: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v) + 0;

/**
 * Move one value from `current` toward `target` by at most POLICY_MAX_STEP_BP, then keep it in [lo, hi].
 * `target` is expected to be in range already; the final clamp is a guard.
 */
export function stepToward(current: number, target: number, lo: number, hi: number): number {
  const delta = target - current;
  const step = Math.abs(delta) > POLICY_MAX_STEP_BP ? Math.sign(delta) * POLICY_MAX_STEP_BP : delta;
  return clamp(current + step, lo, hi);
}

/** The policy the worker can actually send: within +-300 bp of `current` on each axis, then within the legal ranges. */
export function stepPolicyToward(current: Policy, target: Policy): Policy {
  return {
    spread_bp: stepToward(current.spread_bp, target.spread_bp, PARAMS.SPREAD_MIN_BP, PARAMS.SPREAD_MAX_BP),
    bias_bp: stepToward(current.bias_bp, target.bias_bp, PARAMS.BIAS_MIN_BP, PARAMS.BIAS_MAX_BP),
  };
}

/** True when a set_policy of `next` over `current` passes the contract's range and step checks. */
export function policyStepOk(current: Policy, next: Policy): boolean {
  return (
    Number.isInteger(next.spread_bp) && Number.isInteger(next.bias_bp) &&
    next.spread_bp >= PARAMS.SPREAD_MIN_BP && next.spread_bp <= PARAMS.SPREAD_MAX_BP &&
    next.bias_bp >= PARAMS.BIAS_MIN_BP && next.bias_bp <= PARAMS.BIAS_MAX_BP &&
    Math.abs(next.spread_bp - current.spread_bp) <= POLICY_MAX_STEP_BP &&
    Math.abs(next.bias_bp - current.bias_bp) <= POLICY_MAX_STEP_BP
  );
}

/**
 * Contract `ship_payment`: (mid(from) + mid(to)) / 2 per unit, truncated, both mids at the DEFAULT policy
 * (spread 800, bias 0), times qty. The merchants' own policies do not enter.
 */
export function shipUnitPayment(good: GoodId, fromStock: number, toStock: number): bigint {
  const mid = (stock: number) => quoteBig({ good, stock, spreadBp: PARAMS.SPREAD_DEFAULT_BP, biasBp: 0 }).mid;
  return (mid(fromStock) + mid(toStock)) / 2n;
}

/** What the destination can still be charged this tick: 25% of (treasury + paid) minus paid, never negative. */
export function shipBudgetLeft(dest: Pick<MerchantSnapshot, "treasury" | "ship_in_paid">): bigint {
  const paid = dest.ship_in_paid ?? 0n;
  const budget = ((dest.treasury + paid) * SHIP_MAX_PAY_PCT) / 100n;
  const left = budget - paid;
  return left > 0n ? left : 0n;
}

/** Same stock rule the contract applies before pricing: the destination must be below its target. */
export function destinationShort(good: GoodId, toStock: number): boolean {
  return toStock < GOODS[good].target;
}
