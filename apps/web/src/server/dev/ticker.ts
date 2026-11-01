// In-process world ticker and a deterministic NPC stand-in for the dev backend.
//
// The stand-in mirrors the baseline rules of apps/worker/src/baseline.ts (no model, no randomness):
//   spread_bp = clamp(800 + max(0, 10000 - treasury_bp) / 10, 400, 2000)    poorer -> wider
//   bias_bp   = clamp((10000 - avg_ratio_bp) / 4, -1500, 1500)              scarcer -> pay more
// It is re-implemented here (a few lines) instead of imported because the worker is a separate app with its
// own build; the contract limits (300 bp per step, one policy change per tick) are enforced by the fake contract.

import { CITY_IDS, GOODS, GOOD_IDS, PARAMS, type CityId } from "@caravan/shared";
import type { FakeContract } from "../contract/fake";
import type { Services } from "../services";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v) + 0;
const toward = (cur: number, want: number, step = 300) => cur + clamp(want - cur, -step, step);

export function baselineTargets(treasury: bigint, stock: Record<string, number>): { spread_bp: number; bias_bp: number } {
  const treasuryBp = Number((treasury * 10000n) / BigInt(PARAMS.MERCHANT_TREASURY_FILS));
  const ratios = GOOD_IDS.map((g) => Math.trunc((stock[g]! * 10000) / GOODS[g].target));
  const avg = Math.trunc(ratios.reduce((a, b) => a + b, 0) / ratios.length);
  return {
    spread_bp: clamp(PARAMS.SPREAD_DEFAULT_BP + Math.trunc(Math.max(0, 10000 - treasuryBp) / 10), PARAMS.SPREAD_MIN_BP, PARAMS.SPREAD_MAX_BP),
    bias_bp: clamp(Math.trunc((10000 - avg) / 4), PARAMS.BIAS_MIN_BP, PARAMS.BIAS_MAX_BP),
  };
}

/** One NPC round: each merchant moves its policy one step toward the baseline, then ships what the rules allow. */
export async function runNpcStandIn(contract: FakeContract): Promise<{ policies: number; shipments: number }> {
  const out = { policies: 0, shipments: 0 };
  for (const city of CITY_IDS) {
    const m = await contract.getMerchant(city);
    const t = baselineTargets(BigInt(m.treasury), m.stock);
    try {
      await contract.merchantCall(city, "set_policy", { spread_bp: toward(m.spread_bp, t.spread_bp), bias_bp: toward(m.bias_bp, t.bias_bp) });
      out.policies++;
    } catch {
      /* rate limited or out of range: try again next tick */
    }
  }
  for (const good of GOOD_IDS) {
    const ms = await Promise.all(CITY_IDS.map((c) => contract.getMerchant(c)));
    const hi = ms.reduce((a, b) => (b.stock[good] > a.stock[good] ? b : a), ms[0]!);
    const lo = ms.reduce((a, b) => (b.stock[good] < a.stock[good] ? b : a), ms[0]!);
    if (hi.id === lo.id) continue;
    try {
      await contract.merchantCall(hi.id as CityId, "ship", { to: lo.id as CityId, good, qty: PARAMS.NPC_SHIP_UNITS_PER_TICK });
      out.shipments++;
    } catch {
      /* gap too small, destination full or over budget */
    }
  }
  return out;
}

type TickerServices = Pick<Services, "worldCache" | "repo" | "now" | "log">;

export async function tickOnce(contract: FakeContract, svc: TickerServices): Promise<void> {
  try {
    await contract.worldTick();
    await runNpcStandIn(contract);
    await svc.repo.setHeartbeat("dev-ticker", svc.now());
    svc.worldCache.invalidate();
  } catch (e) {
    svc.log.error("dev ticker failed:", e instanceof Error ? e : "unknown");
  }
}

/** Calls tickOnce every `seconds` (DEV_TICK_SECONDS, default 60). Returns a stop function. */
export function startDevTicker(contract: FakeContract, svc: TickerServices, seconds: number): () => void {
  const timer = setInterval(() => void tickOnce(contract, svc), Math.max(1, seconds) * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
