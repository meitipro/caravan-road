// LIVE-mode money routes: POST /api/deposit/quote, GET /api/deposit/status, POST /api/withdraw.
// PLAY mode closes all three (mode gate). The 1Click calls go through IntentsClient; its answers are
// untrusted and validated here. Caps are enforced twice: here and in the contract.

import {
  DepositQuoteRequestSchema, DepositStatusQuerySchema, PARAMS, WithdrawRequestSchema,
  type DepositQuoteData, type DepositStatusData, type WithdrawData,
} from "@caravan/shared";
import { ApiError } from "../errors";
import { checkMode, checkNotPaused } from "../guards/mode";
import type { GetCtx, PostSpec } from "../http";
import type { IntentQuote } from "../intents/types";
import type { z } from "zod";

const QUOTE_MAX_VALIDITY_SECONDS = 24 * 3600;
const POS_INT = /^[1-9][0-9]*$/;

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

export const depositQuoteSpec: PostSpec<z.infer<typeof DepositQuoteRequestSchema>, DepositQuoteData> = {
  kind: "deposit_quote",
  schema: DepositQuoteRequestSchema,
  mode: "LIVE_ONLY",
  async run({ svc, user, body }) {
    const now = svc.now();
    const totals = await svc.repo.depositTotals(user.id, now);
    const cap = BigInt(PARAMS.MAX_DEPOSIT_FILS);
    if (totals.credited + totals.open >= cap) throw new ApiError("BAD_REQUEST", "Deposit limit reached.");
    const q = await svc.intents.quote({
      originAsset: body.origin_asset, amountIn: body.amount_in, refundAddress: body.refund_address, userRef: user.id,
    });
    validateQuote(q, body.amount_in, now);
    if (totals.credited + totals.open + BigInt(q.expectedFils) > cap) {
      throw new ApiError("BAD_REQUEST", "This deposit would exceed the deposit limit.");
    }
    await svc.repo.insertDeposit({
      userId: user.id, quoteId: q.quoteId, depositAddress: q.depositAddress, originAsset: body.origin_asset,
      amountIn: q.amountIn, expectedFils: q.expectedFils, refundAddress: body.refund_address, deadline: q.deadline, now,
    });
    return { quote_id: q.quoteId, deposit_address: q.depositAddress, amount_in: q.amountIn, expected_fils: q.expectedFils, deadline: q.deadline };
  },
};

export async function depositStatus(ctx: GetCtx): Promise<DepositStatusData> {
  const { svc, user, req } = ctx;
  checkMode(svc.mode, "LIVE_ONLY");
  const q = DepositStatusQuerySchema.safeParse({ quote_id: new URL(req.url).searchParams.get("quote_id") ?? "" });
  if (!q.success) throw new ApiError("BAD_REQUEST", "quote_id is required");
  const row = await svc.repo.getDepositByQuote(user!.id, q.data.quote_id);
  if (!row) throw new ApiError("BAD_REQUEST", "Unknown quote.");
  return row.status === "CREDITED" ? { status: row.status, fils_credited: row.expected_fils } : { status: row.status };
}

export const withdrawSpec: PostSpec<z.infer<typeof WithdrawRequestSchema>, WithdrawData> = {
  kind: "withdraw",
  schema: WithdrawRequestSchema,
  mode: "LIVE_ONLY",
  async run({ svc, user, body, noteTx }) {
    await checkNotPaused(svc.repo);
    const fils = BigInt(body.fils);
    if (fils <= 0n) throw new ApiError("BAD_REQUEST", "Amount must be positive.");
    const now = svc.now();
    const recent = await svc.repo.withdrawnSince(user.id, now - 86400);
    if (recent + fils > BigInt(PARAMS.DAILY_WITHDRAW_CAP_FILS)) throw new ApiError("BAD_REQUEST", "Daily withdrawal limit reached.");
    const out = await svc.relayer.submit(user, "request_withdraw", {
      fils: body.fils, dest_asset: body.dest_asset, dest_address: body.dest_address,
    });
    noteTx(out);
    const contractId = Number(out.returnValue);
    if (!Number.isInteger(contractId)) throw new ApiError("INTERNAL", "Something went wrong. Please try again.");
    const row = await svc.repo.insertWithdrawal({
      userId: user.id, contractWithdrawId: contractId, fils: body.fils, destAsset: body.dest_asset,
      destAddress: body.dest_address, txHash: out.txHash, now,
    });
    svc.worldCache.invalidate();
    return { request_id: String(row.id), status: row.status };
  },
};
