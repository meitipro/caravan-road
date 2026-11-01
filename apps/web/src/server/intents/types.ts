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
  /** The provider's quote signature; the docs say to keep it for dispute resolution. */
  signature?: string;
}

export type IntentState = "PENDING" | "SUCCESS" | "REFUNDED" | "FAILED";

export interface IntentStatus {
  state: IntentState;
  /** What the provider says arrived, in fils. Required for SUCCESS; credited as min(received, expected). */
  receivedFils?: string;
  /** Account that received the funds; must equal TREASURY_ACCOUNT_ID before anything is credited. */
  recipient?: string;
  /** Asset that arrived; must equal the asset of the quote. */
  asset?: string;
}

export interface IntentWithdrawRequest {
  fils: string;
  destAsset: string;
  destAddress: string;
  /** Our withdrawal id as a string, for the provider's idempotency. */
  ref: string;
}

export type IntentWithdrawResult =
  | { ok: true; quoteId: string; txHash: string; signature?: string }
  | { ok: false; reason: string };

export interface IntentsClient {
  /** False until the real provider is wired: money routes then fail closed before touching the chain. */
  readonly configured: boolean;
  /** Funds available to pay withdrawals, in fils (the treasury hot wallet). */
  treasuryBalanceFils(): Promise<string>;
  quote(req: IntentQuoteRequest): Promise<IntentQuote>;
  status(quoteId: string): Promise<IntentStatus>;
  withdraw(req: IntentWithdrawRequest): Promise<IntentWithdrawResult>;
  /**
   * Follow-up of a withdrawal that was sent (by the quoteId withdraw() returned). `refundedMicro` is what the
   * provider says it returned to the treasury, in USDC micro-units (1 fil = 100 micro).
   */
  withdrawalStatus(quoteId: string): Promise<{ state: IntentState; refundedMicro?: string }>;
}
