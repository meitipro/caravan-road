// Cost basis per good (units and total fils paid), kept in localStorage so the UI can show an
// estimated profit. This is a display convenience only: the server stays the source of truth for balances.

import { GOOD_IDS, type GoodId } from "@caravan/shared";
import { safeGet, safeSet } from "./storage";

export interface BasisEntry { qty: number; cost: string }
export type Basis = Partial<Record<GoodId, BasisEntry>>;

const KEY = "caravan.basis.v1";

export function loadBasis(): Basis {
  const raw = safeGet(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Basis;
    const out: Basis = {};
    for (const g of GOOD_IDS) {
      const e = parsed[g];
      if (e && Number.isInteger(e.qty) && e.qty > 0 && /^\d+$/.test(e.cost)) out[g] = { qty: e.qty, cost: e.cost };
    }
    return out;
  } catch {
    return {};
  }
}

function save(b: Basis): void {
  safeSet(KEY, JSON.stringify(b));
}

export function addBuy(b: Basis, good: GoodId, qty: number, costFils: bigint): Basis {
  const prev = b[good];
  const next: Basis = { ...b, [good]: { qty: (prev?.qty ?? 0) + qty, cost: (BigInt(prev?.cost ?? "0") + costFils).toString() } };
  return next;
}

/** Remove `qty` units, reducing the cost in proportion (integer, truncated). */
export function removeUnits(b: Basis, good: GoodId, qty: number): Basis {
  const prev = b[good];
  if (!prev) return b;
  const left = prev.qty - qty;
  const next = { ...b };
  if (left <= 0) {
    delete next[good];
    return next;
  }
  const cost = (BigInt(prev.cost) * BigInt(left)) / BigInt(prev.qty);
  next[good] = { qty: left, cost: cost.toString() };
  return next;
}

/** Cost of `qty` units of a good at the average price paid; null if unknown. */
export function basisCost(b: Basis, good: GoodId, qty: number): bigint | null {
  const e = b[good];
  if (!e || e.qty <= 0) return null;
  return (BigInt(e.cost) * BigInt(Math.min(qty, e.qty))) / BigInt(e.qty);
}

export function persistBasis(b: Basis): void {
  save(b);
}
