// In-memory IntentsClient for tests.

import type {
  IntentQuote, IntentQuoteRequest, IntentState, IntentStatus, IntentWithdrawRequest, IntentWithdrawResult, IntentsClient,
} from "./types";

export class FakeIntents implements IntentsClient {
  readonly configured = true;
  treasuryFils = 10_000_000n;
  recipient = "treasury.fake";
  async treasuryBalanceFils(): Promise<string> {
    return this.treasuryFils.toString();
  }
  private n = 0;
  readonly quotes = new Map<string, IntentQuote & { state: IntentState; receivedFils?: string; recipient?: string; asset?: string }>();
  readonly withdrawals: IntentWithdrawRequest[] = [];
  withdrawResult: IntentWithdrawResult | null = null;
  /** fils per unit of amount_in (decimal) used for expected_fils. */
  filsPerUnit = 1n;

  constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}

  async quote(req: IntentQuoteRequest): Promise<IntentQuote> {
    const id = `fakeq-${++this.n}`;
    const q: IntentQuote = {
      quoteId: id, depositAddress: `deposit-${this.n}.fake`, amountIn: req.amountIn,
      expectedFils: (BigInt(req.amountIn) * this.filsPerUnit).toString(), deadline: this.now() + 600,
    };
    this.quotes.set(id, { ...q, state: "PENDING", asset: req.originAsset });
    return q;
  }

  async status(quoteId: string): Promise<IntentStatus> {
    const q = this.quotes.get(quoteId);
    if (!q) return { state: "FAILED" };
    return { state: q.state, receivedFils: q.receivedFils, recipient: q.recipient ?? this.recipient, asset: q.asset };
  }

  async withdraw(req: IntentWithdrawRequest): Promise<IntentWithdrawResult> {
    this.withdrawals.push(req);
    return this.withdrawResult ?? { ok: true, quoteId: `fakew-${req.ref}`, txHash: `fakeintenttx-${req.ref}` };
  }

  // test controls
  /** SUCCESS defaults to receiving exactly the quoted amount at the treasury. */
  setState(quoteId: string, state: IntentState, receivedFils?: string, over: { recipient?: string; asset?: string; omitReceived?: boolean } = {}): void {
    const q = this.quotes.get(quoteId);
    if (!q) return;
    q.state = state;
    q.receivedFils = over.omitReceived ? undefined : (receivedFils ?? (state === "SUCCESS" ? q.expectedFils : undefined));
    if (over.recipient) q.recipient = over.recipient;
    if (over.asset) q.asset = over.asset;
  }
}
