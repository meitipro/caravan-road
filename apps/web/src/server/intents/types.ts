// Interface to NEAR Intents (1Click) for LIVE deposits and withdrawals. The real implementation is
// Phase 7 (needs ONECLICK_JWT and the verified OpenAPI names from docs.near-intents.org); the server
// logic in game/money.ts is written and tested against this interface with FakeIntents.
//
// Provider responses are untrusted: money.ts validates every field before using it.

export interface IntentQuoteRequest {
  originAsset: string;
  amountIn: string;
  refundAddress: string;
  /** Opaque reference tying the quote to our user (not an address or an e-mail). */
  userRef: string;
}

export interface IntentQuote {
  quoteId: string;
  depositAddress: string;
  amountIn: string;
  /** Value of the deposit in fils at quote time. */
  expectedFils: string;
  /** Unix seconds. */
  deadline: number;
}

export type IntentState = "PENDING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface IntentStatus {
  state: IntentState;
  /** What the provider says arrived, in fils (never trusted above the quoted amount). */
  receivedFils?: string;
}

export interface IntentWithdrawRequest {
  fils: string;
  destAsset: string;
  destAddress: string;
  /** Our withdrawal id as a string, for the provider's idempotency. */
  ref: string;
}

export type IntentWithdrawResult =
  | { ok: true; quoteId: string; txHash: string }
  | { ok: false; reason: string };

export interface IntentsClient {
  quote(req: IntentQuoteRequest): Promise<IntentQuote>;
  status(quoteId: string): Promise<IntentStatus>;
  withdraw(req: IntentWithdrawRequest): Promise<IntentWithdrawResult>;
}
