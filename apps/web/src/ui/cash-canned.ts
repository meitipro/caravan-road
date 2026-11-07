// Canned deposit and withdraw behaviour for previewing the LIVE cash screens without a server
// (mock mode only, /play/cash?live=1). Statuses advance with time: Waiting, Processing, Credited.

import type { ApiResult, DepositQuoteData, DepositStatusData, WithdrawData } from "@caravan/shared";
import { MOCK_TOKENS } from "@caravan/shared";
import { assetById, assetsFromTokens } from "./cash-assets";

const SAMPLE_ASSETS = assetsFromTokens(MOCK_TOKENS);

const quotes = new Map<string, { at: number; fils: string }>();

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });

export async function cannedDepositQuote(body: { origin_asset: string; amount_in: string; refund_address: string }): Promise<ApiResult<DepositQuoteData>> {
  await new Promise((r) => setTimeout(r, 350));
  const a = assetById(SAMPLE_ASSETS, body.origin_asset);
  if (!a) return { ok: false, error: { code: "BAD_REQUEST", message: "Unknown asset" } };
  // Sample rate: 1 USDC = 10,000 fils. Other assets use a fixed sample price so the screen has something to show.
  const perUnit = a.symbol === "USDC" ? 10000n : a.symbol === "NEAR" ? 25000n : a.symbol === "ETH" ? 30000000n : 900000000n;
  const fils = ((BigInt(body.amount_in) * perUnit) / 10n ** BigInt(a.decimals)).toString();
  const id = `sample-${Date.now().toString(36)}`;
  quotes.set(id, { at: Date.now(), fils });
  return ok({
    quote_id: id,
    deposit_address: a.kind === "evm" ? "0x0000000000000000000000000000000000000000" : "sample-deposit-address",
    amount_in: body.amount_in,
    expected_fils: fils,
    deadline: Math.floor(Date.now() / 1000) + 600,
  });
}

export async function cannedDepositStatus(quoteId: string): Promise<ApiResult<DepositStatusData>> {
  const q = quotes.get(quoteId);
  if (!q) return ok({ status: "EXPIRED" });
  const age = (Date.now() - q.at) / 1000;
  if (age < 8) return ok({ status: "PENDING_DEPOSIT" });
  if (age < 16) return ok({ status: "PROCESSING" });
  return ok({ status: "SUCCESS", fils_credited: q.fils });
}

export async function cannedWithdraw(): Promise<ApiResult<WithdrawData>> {
  await new Promise((r) => setTimeout(r, 500));
  return ok({ request_id: `sample-w-${Date.now().toString(36)}`, status: "PROCESSING" });
}
