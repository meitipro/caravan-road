// Cron jobs (master plan 6.5). Routes call these after the CRON_SECRET check.
// Every state change is a compare-and-set on the row, so two overlapping runs never double-credit or
// double-send; the contract also ignores a repeated deposit reference.

import { PARAMS } from "@caravan/shared";
import { mapPanic, isApiError, isContractPanic } from "../errors";
import { assertContractMode, isPaused } from "../guards/mode";
import type { Services } from "../services";

export const HEARTBEAT_STALE_SECONDS = 120;
export const DEPOSIT_EXPIRY_GRACE_SECONDS = 3600;
export const RESERVATION_STALE_SECONDS = 900;
export const RELAYER_LOW_YOCTO = 2n * 10n ** 24n; // 2 NEAR
const BATCH = 50;
/** Contract refusals that will never succeed on retry; everything else (RATE_LIMIT, PAUSED, INTERNAL...) is retried. */
const PERMANENT_CODES = new Set(["BAD_REQUEST", "MODE_NOT_ALLOWED"]);

/** True when the money crons may run (LIVE, not paused, contract mode matches). */
async function moneyEnabled(svc: Services): Promise<boolean> {
  if (svc.mode !== "LIVE" || (await isPaused(svc.repo, svc.mode))) return false;
  try {
    await assertContractMode(svc);
    return true;
  } catch (e) {
    if (isApiError(e)) return false;
    throw e;
  }
}

/** /api/cron/tick: fallback world_tick() when the worker heartbeat is stale or missing. */
export async function cronTick(svc: Services): Promise<{ called: boolean; reason: string; ticks?: number }> {
  const hb = await svc.repo.latestHeartbeat();
  const age = hb === null ? null : svc.now() - hb;
  if (age !== null && age <= HEARTBEAT_STALE_SECONDS) return { called: false, reason: "worker alive" };
  if (await isPaused(svc.repo, svc.mode)) return { called: false, reason: "paused" };
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
  stale_reservations: number;
  failed_deposits: number;
  mode_mismatch: boolean;
}

/** /api/cron/health: balances, heartbeat, flags. Reports booleans and ages, never balances or keys. */
export async function cronHealth(svc: Services): Promise<HealthReport> {
  const [relayerBal, config, hb, sendingOnly, finalizing, reserved, failedDeposits, paused] = await Promise.all([
    svc.contract.accountBalance(svc.relayerAccountId),
    svc.contract.getConfig(),
    svc.repo.latestHeartbeat(),
    svc.repo.listWithdrawalsByStatus("SENDING", BATCH),
    svc.repo.listWithdrawalsByStatus("FINALIZING", BATCH),
    svc.repo.listWithdrawalsByStatus("RESERVED", BATCH),
    svc.repo.countDepositsByStatus("FAILED"),
    isPaused(svc.repo, svc.mode),
  ]);
  const sending = [...sendingOnly, ...finalizing]; // both mean "a run died half way"
  const treasuryLow = svc.treasuryAccountId ? BigInt(await svc.contract.accountBalance(svc.treasuryAccountId)) < RELAYER_LOW_YOCTO : null;
  const relayerLow = BigInt(relayerBal) < RELAYER_LOW_YOCTO;
  if (relayerLow) svc.log.error("ALERT: relayer balance is low");
  const age = hb === null ? null : svc.now() - hb;
  const stale = age === null || age > HEARTBEAT_STALE_SECONDS;
  const stuck = sending.filter((w) => svc.now() - w.updated_at > 600).length;
  const staleReserved = reserved.filter((w) => svc.now() - w.created_at > RESERVATION_STALE_SECONDS).length;
  const mismatch = config.mode !== svc.mode;
  return {
    ok: !relayerLow && treasuryLow !== true && !stale && stuck === 0 && staleReserved === 0 && !mismatch,
    mode: svc.mode, paused, contract_paused: config.paused, relayer_low: relayerLow,
    treasury_low: treasuryLow, worker_heartbeat_age: age, worker_stale: stale, stuck_withdrawals: stuck,
    stale_reservations: staleReserved, failed_deposits: failedDeposits, mode_mismatch: mismatch,
  };
}

/** /api/cron/deposits: check provider status, credit through the operator key, expire. */
export async function cronDeposits(svc: Services): Promise<{ credited: number; expired: number; failed: number }> {
  const res = { credited: 0, expired: 0, failed: 0 };
  if (!(await moneyEnabled(svc))) return res;
  const now = svc.now();
  const cap = BigInt(PARAMS.MAX_DEPOSIT_FILS);

  const fail = async (id: number, from: "PENDING" | "CREDITING", why: string): Promise<void> => {
    // FAILED deposits are an alert/refund queue for a human: the user's funds sit at the provider.
    svc.log.error(`ALERT: deposit ${id} failed (${why}); needs manual refund review`);
    if (await svc.repo.transitionDeposit(id, from, "FAILED", svc.now())) res.failed++;
  };

  const credit = async (id: number, userId: string, quoteId: string, fils: string): Promise<void> => {
    const user = await svc.repo.getUser(userId);
    if (!user?.near_account_id) return;
    // Re-check the cap at credit time (the quote-time check cannot see deposits credited since).
    if ((await svc.repo.creditedFilsTotal(userId)) + BigInt(fils) > cap) return fail(id, "CREDITING", "deposit cap");
    try {
      await svc.contract.operatorCall("credit_deposit", { account_id: user.near_account_id, fils, reference: quoteId });
      if (await svc.repo.transitionDeposit(id, "CREDITING", "CREDITED", svc.now(), { creditRef: quoteId, creditedFils: fils })) res.credited++;
    } catch (e) {
      const m = isContractPanic(e) ? mapPanic(e.message) : null;
      if (m && PERMANENT_CODES.has(m.code)) await fail(id, "CREDITING", `contract ${m.code}`);
      else svc.log.error(`deposit ${id} credit failed and will be retried`); // transient: RATE_LIMIT, PAUSED, INTERNAL, network
    }
  };

  // Retry rows left in CREDITING by an earlier run (safe: the contract ignores a repeated reference).
  for (const d of await svc.repo.listDepositsByStatus("CREDITING", BATCH)) {
    await credit(d.id, d.user_id, d.quote_id, d.credited_fils ?? d.expected_fils);
  }

  for (const d of await svc.repo.listDepositsByStatus("PENDING", BATCH)) {
    let st;
    try {
      st = await svc.intents.status(d.quote_id);
    } catch {
      svc.log.error(`deposit ${d.id} status check failed`);
      continue;
    }
    if (st.state === "SUCCESS") {
      // Provider data is untrusted: the money must be a positive amount that arrived at OUR treasury in the quoted asset.
      const received = st.receivedFils !== undefined && /^[1-9][0-9]*$/.test(st.receivedFils) ? BigInt(st.receivedFils) : null;
      const recipientOk = svc.treasuryAccountId !== null && st.recipient === svc.treasuryAccountId;
      if (received === null || !recipientOk || st.asset !== d.origin_asset) {
        await fail(d.id, "PENDING", "unverified provider data");
        continue;
      }
      const expected = BigInt(d.expected_fils);
      const amount = (received < expected ? received : expected).toString();
      if (await svc.repo.transitionDeposit(d.id, "PENDING", "CREDITING", now, { creditedFils: amount })) {
        await credit(d.id, d.user_id, d.quote_id, amount);
      }
    } else if (st.state === "REFUNDED" || st.state === "FAILED") {
      if (await svc.repo.transitionDeposit(d.id, "PENDING", "FAILED", now)) res.failed++;
    } else if (now > d.deadline + DEPOSIT_EXPIRY_GRACE_SECONDS) {
      if (await svc.repo.transitionDeposit(d.id, "PENDING", "EXPIRED", now)) res.expired++;
    }
  }
  return res;
}

/**
 * Links on-chain PENDING withdrawals to database rows. A RESERVED row whose chain call succeeded but whose
 * id was lost is attached to the matching chain withdrawal (same account and amount); a chain withdrawal
 * with no row at all gets one; a RESERVED row with no chain counterpart after the grace period is cancelled
 * (the debit never happened).
 */
export async function reconcileWithdrawals(svc: Services): Promise<{ attached: number; adopted: number; cancelled: number }> {
  const res = { attached: 0, adopted: 0, cancelled: 0 };
  const reserved = await svc.repo.listWithdrawalsByStatus("RESERVED", BATCH);
  const maxId = await svc.repo.maxContractWithdrawId();
  const chain = await svc.contract.getWithdrawals(Math.max(0, (maxId ?? 0) - 50), 200);
  const used = new Set<number>();
  for (const w of chain) {
    if (w.status !== "PENDING" || (await svc.repo.getWithdrawalByContractId(w.id))) continue;
    const owner = await svc.repo.getUserByAccount(w.account_id);
    if (!owner) {
      svc.log.error(`ALERT: on-chain withdrawal ${w.id} belongs to an unknown account`);
      continue;
    }
    const match = reserved.find((r) => !used.has(r.id) && r.user_id === owner.id && r.fils === w.fils);
    if (match) {
      used.add(match.id);
      if (await svc.repo.attachWithdrawal(match.id, w.id, null, svc.now())) res.attached++;
    } else if (w.dest_asset && w.dest_address) {
      await svc.repo.insertWithdrawal({ userId: owner.id, contractWithdrawId: w.id, fils: w.fils, destAsset: w.dest_asset, destAddress: w.dest_address, txHash: null, now: svc.now() });
      svc.log.error(`ALERT: adopted on-chain withdrawal ${w.id} that had no database row`);
      res.adopted++;
    }
  }
  for (const r of reserved) {
    if (used.has(r.id) || svc.now() - r.created_at <= RESERVATION_STALE_SECONDS) continue;
    if (await svc.repo.cancelWithdrawal(r.id, svc.now())) res.cancelled++;
  }
  return res;
}

/** /api/cron/withdrawals: reconcile, verify each row against the chain, send through Intents, then mark (or refund). */
export async function cronWithdrawals(svc: Services): Promise<{ sent: number; refunded: number }> {
  const res = { sent: 0, refunded: 0 };
  if (!(await moneyEnabled(svc))) return res;
  await reconcileWithdrawals(svc); // links debits whose id was lost; independent of the provider
  if (!svc.intents.configured) return res;

  for (const w of await svc.repo.listWithdrawalsByStatus("REQUESTED", BATCH)) {
    if (w.contract_withdraw_id === null) continue;
    // The database row must describe exactly the pending on-chain withdrawal it points at (same account,
    // amount and still PENDING) before anything is sent or refunded.
    const user = await svc.repo.getUser(w.user_id);
    const chain = await svc.contract.getWithdraw(w.contract_withdraw_id);
    if (!user?.near_account_id || !chain || chain.account_id !== user.near_account_id || chain.fils !== w.fils || chain.status !== "PENDING") {
      svc.log.error(`ALERT: withdrawal ${w.id} does not match the chain; not sending`);
      await svc.repo.transitionWithdrawal(w.id, "REQUESTED", "FAILED", svc.now());
      continue;
    }
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
        // SENT (not DONE): the contract keeps a refund possible until the provider reports the final outcome.
        await svc.contract.operatorCall("mark_withdraw", { id: w.contract_withdraw_id, status: "SENT", reference: result.txHash });
        if (await svc.repo.transitionWithdrawal(w.id, "SENDING", "SENT", svc.now(), { quoteId: result.quoteId, txHash: result.txHash, signature: result.signature })) res.sent++;
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
  await followSentWithdrawals(svc, res);
  return res;
}

export const FINALIZING_STALE_SECONDS = 300;

/**
 * Finishes withdrawals that were sent: asks the provider for the outcome and
 *  - SUCCESS: contract DONE, row DONE;
 *  - REFUNDED/FAILED: the money came back to (or never left) the treasury, so the player is refunded on chain
 *    with refund_withdraw, after checking the chain state (account, amount, status SENT).
 * A run claims a row with a compare-and-set to FINALIZING; every chain step first reads the chain state, so a
 * concurrent or restarted run cannot mark twice, refund twice, or refund a withdrawal that is already DONE.
 */
export async function followSentWithdrawals(svc: Services, res: { sent: number; refunded: number }): Promise<{ done: number }> {
  const out = { done: 0 };
  const sent = await svc.repo.listWithdrawalsByStatus("SENT", BATCH);
  const stuck = (await svc.repo.listWithdrawalsByStatus("FINALIZING", BATCH)).filter((w) => svc.now() - w.updated_at > FINALIZING_STALE_SECONDS);
  const claimed: Array<{ id: number; user_id: string; fils: string; quote_id: string | null; contract_withdraw_id: number | null; from: "SENT" | "FINALIZING" }> = [];
  for (const w of sent) {
    if (!w.quote_id || w.contract_withdraw_id === null) continue;
    if (await svc.repo.transitionWithdrawal(w.id, "SENT", "FINALIZING", svc.now())) claimed.push({ ...w, from: "SENT" });
  }
  for (const w of stuck) {
    if (w.quote_id && w.contract_withdraw_id !== null && (await svc.repo.reclaimWithdrawal(w.id, svc.now(), svc.now() - FINALIZING_STALE_SECONDS))) {
      claimed.push({ ...w, from: "FINALIZING" });
    }
  }

  const release = async (id: number): Promise<void> => {
    await svc.repo.transitionWithdrawal(id, "FINALIZING", "SENT", svc.now()); // try again next run
  };

  for (const w of claimed) {
    const cid = w.contract_withdraw_id!;
    let st;
    try {
      st = await svc.intents.withdrawalStatus(w.quote_id!);
    } catch {
      svc.log.error(`withdrawal ${w.id} status check failed; will retry`);
      await release(w.id);
      continue;
    }
    if (st.state === "PENDING") {
      await release(w.id);
      continue;
    }
    try {
      const user = await svc.repo.getUser(w.user_id);
      const chain = await svc.contract.getWithdraw(cid);
      if (!user?.near_account_id || !chain || chain.account_id !== user.near_account_id || chain.fils !== w.fils) {
        svc.log.error(`ALERT: withdrawal ${w.id} does not match the chain; not finishing it`);
        await svc.repo.transitionWithdrawal(w.id, "FINALIZING", "FAILED", svc.now());
        continue;
      }
      if (st.state === "SUCCESS") {
        if (chain.status === "SENT") {
          try {
            await svc.contract.operatorCall("mark_withdraw", { id: cid, status: "DONE" });
          } catch (e) {
            if (!(isContractPanic(e) && (await svc.contract.getWithdraw(cid))?.status === "DONE")) throw e; // lost a race: already DONE
          }
        } else if (chain.status !== "DONE") {
          svc.log.error(`ALERT: withdrawal ${w.id} succeeded at the provider but the chain says ${chain.status}`);
          await svc.repo.transitionWithdrawal(w.id, "FINALIZING", "FAILED", svc.now());
          continue;
        }
        if (await svc.repo.transitionWithdrawal(w.id, "FINALIZING", "DONE", svc.now())) out.done++;
        continue;
      }
      // REFUNDED or FAILED: return the player's dinars, but only against a verified refund where we can verify it.
      if (st.state === "REFUNDED" && st.refundedMicro !== undefined && BigInt(st.refundedMicro) < BigInt(w.fils) * 100n) {
        svc.log.error(`ALERT: withdrawal ${w.id} was only partly refunded by the provider; manual review`);
        await svc.repo.transitionWithdrawal(w.id, "FINALIZING", "FAILED", svc.now());
        continue;
      }
      if (chain.status === "SENT" || chain.status === "PENDING") {
        try {
          await svc.contract.operatorCall("refund_withdraw", { id: cid });
        } catch (e) {
          if (!(isContractPanic(e) && (await svc.contract.getWithdraw(cid))?.status === "REFUNDED")) throw e; // lost a race: already refunded
        }
      } else if (chain.status !== "REFUNDED") {
        svc.log.error(`ALERT: withdrawal ${w.id} was refunded by the provider but the chain says ${chain.status}; manual review`);
        await svc.repo.transitionWithdrawal(w.id, "FINALIZING", "FAILED", svc.now());
        continue;
      }
      if (await svc.repo.transitionWithdrawal(w.id, "FINALIZING", "REFUNDED", svc.now())) res.refunded++;
    } catch {
      svc.log.error(`withdrawal ${w.id} could not be finished; will retry`);
      // stays FINALIZING: picked up again after FINALIZING_STALE_SECONDS
    }
  }
  return out;
}
