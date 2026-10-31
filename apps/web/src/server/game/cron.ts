// Cron jobs (master plan 6.5). Routes call these after the CRON_SECRET check.
// Every state change is a compare-and-set on the row, so two overlapping runs never double-credit or
// double-send; the contract also ignores a repeated deposit reference.

import { ContractPanic, mapPanic } from "../errors";
import type { Services } from "../services";

export const HEARTBEAT_STALE_SECONDS = 120;
export const DEPOSIT_EXPIRY_GRACE_SECONDS = 3600;
export const RELAYER_LOW_YOCTO = 2n * 10n ** 24n; // 2 NEAR
const BATCH = 50;

/** /api/cron/tick: fallback world_tick() when the worker heartbeat is stale or missing. */
export async function cronTick(svc: Services): Promise<{ called: boolean; reason: string; ticks?: number }> {
  const hb = await svc.repo.latestHeartbeat();
  const age = hb === null ? null : svc.now() - hb;
  if (age !== null && age <= HEARTBEAT_STALE_SECONDS) return { called: false, reason: "worker alive" };
  if ((await svc.repo.getFlag("PAUSE_ALL")) === "true") return { called: false, reason: "paused" };
  try {
    const out = await svc.contract.worldTick();
    svc.worldCache.invalidate();
    const ticks = (out.returnValue as { ticks?: number } | null)?.ticks;
    return { called: true, reason: hb === null ? "no heartbeat" : "heartbeat stale", ticks };
  } catch (e) {
    svc.log.error("fallback world_tick failed:", e instanceof Error ? e.message : "unknown");
    return { called: false, reason: "tick failed" };
  }
}

export interface HealthReport {
  ok: boolean;
  mode: string;
  paused: boolean;
  contract_paused: boolean;
  relayer_low: boolean;
  treasury_low: boolean | null;
  worker_heartbeat_age: number | null;
  worker_stale: boolean;
  stuck_withdrawals: number;
  mode_mismatch: boolean;
}

/** /api/cron/health: balances, heartbeat, flags. Reports booleans and ages, never balances or keys. */
export async function cronHealth(svc: Services): Promise<HealthReport> {
  const [relayerBal, config, hb, sending, paused] = await Promise.all([
    svc.contract.accountBalance(svc.relayerAccountId),
    svc.contract.getConfig(),
    svc.repo.latestHeartbeat(),
    svc.repo.listWithdrawalsByStatus("SENDING", BATCH),
    svc.repo.getFlag("PAUSE_ALL"),
  ]);
  const treasuryLow = svc.treasuryAccountId ? BigInt(await svc.contract.accountBalance(svc.treasuryAccountId)) < RELAYER_LOW_YOCTO : null;
  const relayerLow = BigInt(relayerBal) < RELAYER_LOW_YOCTO;
  if (relayerLow) svc.log.error("ALERT: relayer balance is low");
  const age = hb === null ? null : svc.now() - hb;
  const stale = age === null || age > HEARTBEAT_STALE_SECONDS;
  const stuck = sending.filter((w) => svc.now() - w.updated_at > 600).length;
  const mismatch = config.mode !== svc.mode;
  return {
    ok: !relayerLow && treasuryLow !== true && !stale && stuck === 0 && !mismatch,
    mode: svc.mode, paused: paused === "true", contract_paused: config.paused, relayer_low: relayerLow,
    treasury_low: treasuryLow, worker_heartbeat_age: age, worker_stale: stale, stuck_withdrawals: stuck, mode_mismatch: mismatch,
  };
}

/** /api/cron/deposits: check provider status, credit through the operator key, expire. */
export async function cronDeposits(svc: Services): Promise<{ credited: number; expired: number; failed: number }> {
  const res = { credited: 0, expired: 0, failed: 0 };
  if (svc.mode !== "LIVE" || (await svc.repo.getFlag("PAUSE_ALL")) === "true") return res;
  const now = svc.now();

  const credit = async (id: number, userId: string, quoteId: string, fils: string): Promise<void> => {
    const user = await svc.repo.getUser(userId);
    if (!user?.near_account_id) return;
    try {
      await svc.contract.operatorCall("credit_deposit", { account_id: user.near_account_id, fils, reference: quoteId });
      if (await svc.repo.transitionDeposit(id, "CREDITING", "CREDITED", svc.now(), quoteId)) res.credited++;
    } catch (e) {
      const m = e instanceof ContractPanic ? mapPanic(e.message) : null;
      if (m && m.code !== "INTERNAL" && m.code !== "PAUSED") {
        // The contract refused for good (e.g. deposit cap): do not retry forever, needs manual review.
        svc.log.error(`deposit ${id} rejected by contract: ${m.code}`);
        if (await svc.repo.transitionDeposit(id, "CREDITING", "FAILED", svc.now())) res.failed++;
      } else {
        svc.log.error(`deposit ${id} credit will be retried`);
      }
    }
  };

  // Retry rows left in CREDITING by an earlier run (safe: the contract ignores a repeated reference).
  for (const d of await svc.repo.listDepositsByStatus("CREDITING", BATCH)) await credit(d.id, d.user_id, d.quote_id, d.expected_fils);

  for (const d of await svc.repo.listDepositsByStatus("PENDING", BATCH)) {
    let st;
    try {
      st = await svc.intents.status(d.quote_id);
    } catch {
      svc.log.error(`deposit ${d.id} status check failed`);
      continue;
    }
    if (st.state === "SUCCESS") {
      if (st.receivedFils !== undefined && (!/^[0-9]+$/.test(st.receivedFils) || BigInt(st.receivedFils) < BigInt(d.expected_fils))) {
        svc.log.error(`deposit ${d.id} received less than quoted: manual review`);
        if (await svc.repo.transitionDeposit(d.id, "PENDING", "FAILED", now)) res.failed++;
        continue;
      }
      if (await svc.repo.transitionDeposit(d.id, "PENDING", "CREDITING", now)) await credit(d.id, d.user_id, d.quote_id, d.expected_fils);
    } else if (st.state === "REFUNDED" || st.state === "FAILED") {
      if (await svc.repo.transitionDeposit(d.id, "PENDING", "FAILED", now)) res.failed++;
    } else if (now > d.deadline + DEPOSIT_EXPIRY_GRACE_SECONDS) {
      if (await svc.repo.transitionDeposit(d.id, "PENDING", "EXPIRED", now)) res.expired++;
    }
  }
  return res;
}

/** /api/cron/withdrawals: send through Intents, then mark (or refund on a definite failure). */
export async function cronWithdrawals(svc: Services): Promise<{ sent: number; refunded: number }> {
  const res = { sent: 0, refunded: 0 };
  if (svc.mode !== "LIVE" || (await svc.repo.getFlag("PAUSE_ALL")) === "true") return res;
  for (const w of await svc.repo.listWithdrawalsByStatus("REQUESTED", BATCH)) {
    if (w.contract_withdraw_id === null) continue;
    // CAS first: a second overlapping run cannot send the same withdrawal again.
    if (!(await svc.repo.transitionWithdrawal(w.id, "REQUESTED", "SENDING", svc.now()))) continue;
    let result;
    try {
      result = await svc.intents.withdraw({ fils: w.fils, destAsset: w.dest_asset, destAddress: w.dest_address, ref: String(w.id) });
    } catch {
      // Outcome unknown (the provider may have sent): stay in SENDING for a human, never retry blindly.
      svc.log.error(`withdrawal ${w.id} send outcome unknown: manual review`);
      continue;
    }
    if (result.ok) {
      try {
        await svc.contract.operatorCall("mark_withdraw", { id: w.contract_withdraw_id, reference: result.txHash });
        if (await svc.repo.transitionWithdrawal(w.id, "SENDING", "SENT", svc.now(), { quoteId: result.quoteId, txHash: result.txHash })) res.sent++;
      } catch {
        svc.log.error(`withdrawal ${w.id} was sent but could not be marked: manual review`);
      }
    } else {
      try {
        await svc.contract.operatorCall("refund_withdraw", { id: w.contract_withdraw_id });
        if (await svc.repo.transitionWithdrawal(w.id, "SENDING", "REFUNDED", svc.now())) res.refunded++;
      } catch {
        svc.log.error(`withdrawal ${w.id} failed and could not be refunded: manual review`);
      }
    }
  }
  return res;
}
