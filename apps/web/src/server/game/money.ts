// LIVE-mode money routes: POST /api/deposit/quote, GET /api/deposit/status, POST /api/withdraw.
// PLAY mode closes all three (mode gate). The 1Click calls go through IntentsClient; its answers are
// untrusted and validated here. Caps are enforced twice: here (atomically per user, under a database
// lock) and in the contract. Every route fails closed while Intents is not configured.

import {
  DepositQuoteRequestSchema, DepositStatusQuerySchema, PARAMS, WithdrawRequestSchema,
  type DepositQuoteData, type DepositStatusData, type WithdrawData,
} from "@caravan/shared";
import { ApiError, isApiError } from "../errors";
import { assertContractMode, checkMode } from "../guards/mode";
import type { GetCtx, PostSpec } from "../http";
import type { IntentQuote } from "../intents/types";
import type { z } from "zod";

const QUOTE_MAX_VALIDITY_SECONDS = 24 * 3600;
const POS_INT = /^[1-9][0-9]*$/;

const unavailable = (): ApiError => new ApiError("PAUSED", "Deposits and withdrawals are not available right now.");

export function validateQuote(q: IntentQuote, amountIn: string, now: number): void {
  const bad = (why: string): never => {
    throw new ApiError("INTERNAL", `Deposit quote rejected (${why}).`);
  };
  if (typeof q.quoteId !== "string" || q.quoteId.length === 0 || q.quoteId.length > 200) bad("quote id");
  if (typeof q.depositAddress !== "string" || q.depositAddress.length === 0 || q.depositAddress.length > 200) bad("address");
  if (q.amountIn !== amountIn) bad("amount mismatch");
  if (typeof q.expectedFils !== "string" || !POS_INT.test(q.expectedFils)) bad("expected value");
  if (!Number.isInteger(q.deadline) || q.deadline <= now || q.deadline > now + QUOTE_MAX_VALIDITY_SECONDS) bad("deadline");
}

/**
 * Reads a withdrawal id returned by the contract. null/""/undefined/anything non-numeric is NOT an id
 * (Number(null) === 0 would alias withdrawal #0); callers must then rely on reconciliation.
 */
export function parseContractId(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v)) return Number(v);
  return null;
}

export const depositQuoteSpec: PostSpec<z.infer<typeof DepositQuoteRequestSchema>, DepositQuoteData> = {
  kind: "deposit_quote",
  schema: DepositQuoteRequestSchema,
  mode: "LIVE_ONLY",
  async run({ svc, user, body }) {
    if (!svc.intents.configured) throw unavailable();
    const now = svc.now();
    const cap = BigInt(PARAMS.MAX_DEPOSIT_FILS);
    const totals = await svc.repo.depositTotals(user.id);
    if (totals.credited + totals.open >= cap) throw new ApiError("BAD_REQUEST", "Deposit limit reached.");
    const q = await svc.intents.quote({
      originAsset: body.origin_asset, amountIn: body.amount_in, refundAddress: body.refund_address, userRef: user.id,
    });
    validateQuote(q, body.amount_in, now);
    // The authoritative cap check is atomic with the insert (parallel quotes cannot both fit).
    const row = await svc.repo.insertDepositWithinCap({
      userId: user.id, quoteId: q.quoteId, depositAddress: q.depositAddress, originAsset: body.origin_asset,
      amountIn: q.amountIn, expectedFils: q.expectedFils, refundAddress: body.refund_address, deadline: q.deadline, now, signature: q.signature ?? null,
    }, cap);
    if (!row) throw new ApiError("BAD_REQUEST", "This deposit would exceed the deposit limit.");
    return { quote_id: q.quoteId, deposit_address: q.depositAddress, amount_in: q.amountIn, expected_fils: q.expectedFils, deadline: q.deadline };
  },
};

export async function depositStatus(ctx: GetCtx): Promise<DepositStatusData> {
  const { svc, user, req } = ctx;
  checkMode(svc.mode, "LIVE_ONLY");
  await assertContractMode(svc);
  const q = DepositStatusQuerySchema.safeParse({ quote_id: new URL(req.url).searchParams.get("quote_id") ?? "" });
  if (!q.success) throw new ApiError("BAD_REQUEST", "quote_id is required");
  const row = await svc.repo.getDepositByQuote(user!.id, q.data.quote_id);
  if (!row) throw new ApiError("BAD_REQUEST", "Unknown quote.");
  return row.status === "CREDITED" ? { status: row.status, fils_credited: row.credited_fils ?? row.expected_fils } : { status: row.status };
}

export const withdrawSpec: PostSpec<z.infer<typeof WithdrawRequestSchema>, WithdrawData> = {
  kind: "withdraw",
  schema: WithdrawRequestSchema,
  mode: "LIVE_ONLY",
  async run({ svc, user, body, noteTx }) {
    // Fail closed BEFORE anything is debited: Intents must be wired and the treasury must be able to pay.
    if (!svc.intents.configured) throw unavailable();
    const fils = BigInt(body.fils);
    if (fils <= 0n) throw new ApiError("BAD_REQUEST", "Amount must be positive.");
    const available = BigInt(await svc.intents.treasuryBalanceFils());
    if (available < (await svc.repo.outstandingWithdrawalFils()) + fils) {
      svc.log.error("ALERT: treasury cannot cover a withdrawal; refusing");
      throw unavailable();
    }

    const now = svc.now();
    // Cap check and reservation row in one transaction under a per-user lock; the row exists before the chain call.
    const row = await svc.repo.reserveWithdrawal(
      { userId: user.id, fils: body.fils, destAsset: body.dest_asset, destAddress: body.dest_address, now },
      BigInt(PARAMS.DAILY_WITHDRAW_CAP_FILS),
    );
    if (!row) throw new ApiError("BAD_REQUEST", "Daily withdrawal limit reached.");

    let out;
    try {
      out = await svc.relayer.submit(user, "request_withdraw", { fils: body.fils, dest_asset: body.dest_asset, dest_address: body.dest_address });
    } catch (e) {
      // A definite rejection (contract panic, rate limit) means nothing was debited: release the reservation.
      // INTERNAL is ambiguous (the transaction may have executed): keep the reservation for reconciliation.
      if (isApiError(e) && e.code !== "INTERNAL") await svc.repo.cancelWithdrawal(row.id, svc.now());
      throw e;
    }
    noteTx(out);
    const contractId = parseContractId(out.returnValue);
    if (contractId === null) {
      // Debited on chain but the id is unknown: never guess. Reconciliation (cron) links the chain row.
      await svc.repo.noteWithdrawalTx(row.id, out.txHash);
      svc.log.error(`withdrawal ${row.id}: contract returned no usable id; left RESERVED for reconciliation`);
      throw new ApiError("INTERNAL", "Your withdrawal is being processed. Please check back shortly.");
    }
    if (!(await svc.repo.attachWithdrawal(row.id, contractId, out.txHash, svc.now()))) {
      svc.log.error(`ALERT: withdrawal ${row.id} could not be linked to contract id ${contractId}`);
      throw new ApiError("INTERNAL", "Your withdrawal is being processed. Please check back shortly.");
    }
    svc.worldCache.invalidate();
    return { request_id: String(row.id), status: "REQUESTED" };
  },
};
