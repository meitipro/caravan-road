// zod schemas for the 1Click API responses we consume. Every provider answer is untrusted: nothing is
// used before it passes one of these schemas (and the cross-checks in oneclick.ts).
//
// Field names come ONLY from the official OpenAPI document (version 0.1.10 when written):
//   https://1click.chaindefuser.com/docs/v0/openapi.yaml
//   components.schemas: TokenResponse, QuoteRequest, Quote, QuoteResponse, GetExecutionStatusResponse,
//   SwapDetails, SubmitDepositTxRequest, BadRequestResponse
// and the guides:
//   https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md
//   https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote.md
//   https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status.md
//   https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens.md
//
// Unknown extra fields are ignored (zod strips them): the API grows, and we only rely on what we name here.
// Closed sets (the status enum) are strict on purpose: a status we do not know must never be mapped to money.

import { z } from "zod";

/** Non-negative integer in a string (amounts are "smallest unit" strings in the API). */
export const digits = z.string().regex(/^[0-9]{1,78}$/);
const ref = z.string().min(1).max(300);

/** GET /v0/tokens -> TokenResponse[]. `contractAddress` is null for native assets in the docs' example response. */
export const TokenSchema = z.object({
  assetId: z.string().min(1).max(200),
  decimals: z.number().int().min(0).max(36),
  blockchain: z.string().min(1).max(40), // the enum grows over time; do not lock it
  symbol: z.string().min(1).max(40),
  price: z.union([z.number(), z.string()]).optional(), // docs: number in the schema, string in the field example
  priceUpdatedAt: z.string().optional(),
  contractAddress: z.string().max(200).nullable().optional(),
});
export type OneClickToken = z.infer<typeof TokenSchema>;

/** The `quoteRequest` object echoed back inside QuoteResponse (all of these are required in QuoteRequest). */
export const QuoteRequestEchoSchema = z.object({
  swapType: z.string(),
  originAsset: z.string(),
  depositType: z.string(),
  destinationAsset: z.string(),
  amount: z.string(),
  refundTo: z.string(),
  refundType: z.string(),
  recipient: z.string(),
  recipientType: z.string(),
});

/** QuoteResponse.quote. A dry quote has NO depositAddress / deadline / timeWhenInactive (docs, field `dry`). */
export const QuoteBodySchema = z.object({
  depositAddress: z.string().min(1).max(300).optional(),
  depositMemo: z.string().max(300).optional(),
  amountIn: digits,
  minAmountIn: digits,
  amountOut: digits,
  minAmountOut: digits,
  deadline: z.string().max(64).optional(),
  timeEstimate: z.number().optional(),
  refundFee: digits.optional(),
  withdrawFee: digits.optional(),
});

export const QuoteResponseSchema = z.object({
  correlationId: ref,
  timestamp: z.string().max(64),
  signature: z.string().max(2000),
  quoteRequest: QuoteRequestEchoSchema,
  quote: QuoteBodySchema,
});
export type OneClickQuoteResponse = z.infer<typeof QuoteResponseSchema>;

/** GetExecutionStatusResponse.status (closed set from the OpenAPI enum). */
export const StatusEnum = z.enum([
  "KNOWN_DEPOSIT_TX",
  "PENDING_DEPOSIT",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
]);
export type OneClickStatusName = z.infer<typeof StatusEnum>;

const TxDetails = z.object({ hash: z.string().max(300), explorerUrl: z.string().max(1000).optional() });

export const SwapDetailsSchema = z.object({
  nearTxHashes: z.array(z.string().max(300)).max(200).default([]),
  amountIn: digits.optional(),
  amountOut: digits.optional(),
  refundedAmount: digits.optional(),
  refundReason: z.string().max(200).optional(),
  depositedAmount: digits.optional(),
  originChainTxHashes: z.array(TxDetails).max(200).default([]),
  destinationChainTxHashes: z.array(TxDetails).max(200).default([]),
});

export const StatusResponseSchema = z.object({
  correlationId: ref,
  quoteResponse: QuoteResponseSchema,
  status: StatusEnum,
  updatedAt: z.string().max(64),
  swapDetails: SwapDetailsSchema,
});
export type OneClickStatusResponse = z.infer<typeof StatusResponseSchema>;

/** Error bodies (HTTP 400 / 404) are `{ message: string }` (BadRequestResponse). */
export const ErrorBodySchema = z.object({ message: z.string() });
