// The real IntentsClient: NEAR Intents "1Click" API (https://1click.chaindefuser.com/v0).
//
// Sources (all read before writing this file; field names appear nowhere else in this folder than in
// schemas.ts and in the request bodies below, and every one is in the OpenAPI document):
//   OpenAPI   https://1click.chaindefuser.com/docs/v0/openapi.yaml
//   Flow      https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md
//   Auth      https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md
//   Swap types https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md
//   Endpoints https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens.md
//             https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote.md
//             https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status.md
//             https://docs.near-intents.org/api-reference/oneclick/submit-deposit-transaction-hash.md
//   No testnet exists: https://docs.near-intents.org/resources/faqs.md
//
// Endpoints used: GET /v0/tokens, POST /v0/quote (dry and real), GET /v0/status?depositAddress=...,
// POST /v0/deposit/submit (optional speed-up after a withdrawal transfer; best effort).
//
// Design (see docs/INTENTS.md and OPEN_ISSUES.md):
//  - 1Click has no quote id. The status endpoint is keyed by the DEPOSIT ADDRESS, so `quoteId` is the
//    deposit address (memo chains are refused: the IntentsClient interface cannot carry a memo).
//  - Deposit: EXACT_INPUT, ORIGIN_CHAIN, destination = USDC on NEAR (ONECLICK_USDC_ASSET_ID), recipient =
//    the treasury account, refund = the player's refund address on the origin chain, with a deadline.
//  - Withdrawal: EXACT_INPUT from USDC on NEAR (ORIGIN_CHAIN) to the player's address; the treasury then sends
//    exactly `amountIn` USDC to the quote's deposit address with ft_transfer.
//  - 1 USDC = 1,000,000 micro = 10,000 fils (spec 2.1): fils = micro / 100, truncating.
//  - Money safety: nothing is trusted before it passes zod AND our own cross-checks (the echoed request must
//    equal what we sent; amounts must match; a memo, a missing deadline or an unknown status fails closed).

import { ApiError, isApiError } from "../errors";
import { log as defaultLog, type Logger } from "../log";
import { DEFAULT_BASE_URL, OneClickError, OneClickHttp, type FetchLike } from "./http";
import {
  QuoteResponseSchema, StatusResponseSchema, TokenSchema,
  type OneClickQuoteResponse, type OneClickStatusResponse, type OneClickToken,
} from "./schemas";
import type { TreasuryChain } from "./treasury";
import type {
  IntentQuote, IntentQuoteRequest, IntentState, IntentStatus, IntentToken, IntentWithdrawRequest, IntentWithdrawResult, IntentsClient,
} from "./types";
import type { z } from "zod";

export interface OneClickConfig {
  jwt: string;
  /** assetId of USDC on NEAR as listed by GET /v0/tokens (checked at runtime against that list). */
  usdcAssetId: string;
  /** TREASURY_ACCOUNT_ID: receives deposits and pays withdrawals. */
  treasuryAccountId: string;
  treasury: TreasuryChain;
  baseUrl?: string;
  authHeader?: "x-api-key" | "bearer";
  fetch?: FetchLike;
  /** Unix seconds. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
  timeoutMs?: number;
  /** Slippage in basis points for quotes (docs: 100 = 1%). */
  slippageBps?: number;
  /** How long a deposit address stays valid (docs: must exceed the time to mine the deposit). */
  depositWindowSeconds?: number;
}

export type OneClickTokenInfo = IntentToken;

export interface DepositPreview {
  amountIn: string;
  /** Quoted USDC value in fils (truncated). */
  expectedFils: string;
  /** Guaranteed minimum in fils after slippage. */
  minFils: string;
  timeEstimateSeconds: number | null;
}

const TOKENS_TTL_SECONDS = 300;
const TOKENS_STALE_OK_SECONDS = 3600;
const MIN_DEPOSIT_WINDOW_LEFT_SECONDS = 300;
const MICRO_PER_FILS = 100n; // USDC has 6 decimals; 1 USDC = 10,000 fils
const USDC_DECIMALS = 6;
const POS_INT = /^[1-9][0-9]{0,77}$/;
const PLAIN = /^[^\s\u0000-\u001f\u007f]{1,200}$/;
const NEAR_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+([-_.][a-z0-9]+)*$/;

const short = (a: string): string => (a.length > 10 ? `${a.slice(0, 4)}...${a.slice(-4)}` : "[addr]");
const sameAddr = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

interface UsdcInfo { assetId: string; contract: string }

export class OneClickIntents implements IntentsClient {
  readonly configured = true;
  private readonly http: OneClickHttp;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly slippage: number;
  private readonly window: number;
  private tokensCache: { at: number; byId: Map<string, OneClickToken> } | null = null;
  private tokensInflight: Promise<Map<string, OneClickToken>> | null = null;
  private readonly withdrawRefs = new Set<string>();

  private readonly cfg: Omit<OneClickConfig, "jwt">; // the credential lives only inside OneClickHttp

  constructor(config: OneClickConfig) {
    const { jwt, ...cfg } = config;
    this.cfg = cfg;
    if (!cfg.usdcAssetId || !/^nep141:\S+$/.test(cfg.usdcAssetId)) throw new OneClickError("config", "USDC asset id is missing or malformed");
    if (!cfg.treasuryAccountId || !NEAR_ACCOUNT.test(cfg.treasuryAccountId)) throw new OneClickError("config", "Treasury account is missing or malformed");
    this.now = cfg.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = cfg.log ?? defaultLog;
    this.slippage = cfg.slippageBps ?? 100;
    this.window = cfg.depositWindowSeconds ?? 7200;
    if (!Number.isInteger(this.slippage) || this.slippage < 0 || this.slippage > 1000) throw new OneClickError("config", "Slippage out of range");
    if (!Number.isInteger(this.window) || this.window < 900 || this.window > 23 * 3600) throw new OneClickError("config", "Deposit window out of range");
    this.http = new OneClickHttp({
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL, jwt, authHeader: cfg.authHeader ?? "x-api-key",
      fetchImpl: cfg.fetch ?? ((input, init) => fetch(input, init)), timeoutMs: cfg.timeoutMs ?? 10_000,
      maxRetries: 2, retryBaseMs: 250, sleep: cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      maxBodyBytes: 5_000_000,
    });
  }

  toJSON(): string {
    return "[OneClickIntents]";
  }

  // ------------------------------------------------------------------ tokens

  private parse<S extends z.ZodTypeAny>(schema: S, data: unknown, what: string): z.infer<S> {
    const r = schema.safeParse(data);
    if (!r.success) {
      // Paths only, never values.
      this.log.error(`1Click ${what} answer does not match the documented shape:`, r.error.issues.slice(0, 5).map((i) => i.path.join(".")).join(", "));
      throw new OneClickError("schema", `Unexpected ${what} answer`);
    }
    return r.data;
  }

  private async loadTokens(): Promise<Map<string, OneClickToken>> {
    const { body } = await this.http.get("/v0/tokens");
    if (!Array.isArray(body)) throw new OneClickError("schema", "Unexpected tokens answer");
    const byId = new Map<string, OneClickToken>();
    let dropped = 0;
    for (const item of body) {
      const t = TokenSchema.safeParse(item);
      if (t.success) byId.set(t.data.assetId, t.data);
      else dropped++;
    }
    if (dropped > 0) this.log.warn(`1Click tokens: ${dropped} malformed entries ignored`);
    if (byId.size === 0) throw new OneClickError("schema", "Empty tokens answer");
    return byId;
  }

  private async tokenMap(): Promise<Map<string, OneClickToken>> {
    const t = this.now();
    if (this.tokensCache && t - this.tokensCache.at < TOKENS_TTL_SECONDS) return this.tokensCache.byId;
    if (!this.tokensInflight) {
      this.tokensInflight = this.loadTokens()
        .then((byId) => {
          this.tokensCache = { at: this.now(), byId };
          return byId;
        })
        .finally(() => {
          this.tokensInflight = null;
        });
    }
    try {
      return await this.tokensInflight;
    } catch (e) {
      // A stale list is acceptable for a while (asset ids rarely change); otherwise fail.
      if (this.tokensCache && t - this.tokensCache.at < TOKENS_STALE_OK_SECONDS) return this.tokensCache.byId;
      throw e;
    }
  }

  /** The supported-asset list for the deposit UI (GET /v0/tokens, cached 5 minutes). Not hard-coded anywhere. */
  async listTokens(): Promise<OneClickTokenInfo[]> {
    const m = await this.tokenMap();
    return [...m.values()].map((t) => ({
      assetId: t.assetId, symbol: t.symbol, blockchain: t.blockchain, decimals: t.decimals, contractAddress: t.contractAddress ?? null,
    }));
  }

  /** USDC on NEAR, verified against the live token list (symbol, chain, 6 decimals, contract = asset id). */
  private async usdc(): Promise<UsdcInfo> {
    const t = (await this.tokenMap()).get(this.cfg.usdcAssetId);
    const m = /^nep141:(\S+)$/.exec(this.cfg.usdcAssetId);
    if (!t || !m) throw new OneClickError("config", "Configured USDC asset is not in the 1Click token list");
    const contract = m[1]!;
    if (t.blockchain !== "near" || t.symbol.toUpperCase() !== "USDC" || t.decimals !== USDC_DECIMALS) {
      throw new OneClickError("config", "Configured USDC asset is not USDC on NEAR with 6 decimals");
    }
    if (t.contractAddress && t.contractAddress !== contract) throw new OneClickError("config", "USDC contract does not match its asset id");
    return { assetId: this.cfg.usdcAssetId, contract };
  }

  // ------------------------------------------------------------------ helpers

  private deadlineIso(): string {
    return new Date((this.now() + this.window) * 1000).toISOString();
  }

  /**
   * Cross-checks a quote answer against the request we sent: the echoed request must be identical in every
   * field that moves money, amounts must be consistent, and a real quote must carry a usable deposit address
   * and deadline (and no memo).
   */
  private checkQuote(
    r: OneClickQuoteResponse,
    want: { originAsset: string; destinationAsset: string; recipient: string; refundTo: string; amount: string },
    kind: "dry" | "real",
  ): { depositAddress: string | null; deadline: number | null } {
    const bad = (why: string): never => {
      this.log.error(`1Click quote rejected (${why}) correlation=${r.correlationId.slice(0, 64)}`);
      throw new OneClickError("rejected", `Quote rejected (${why})`);
    };
    const e = r.quoteRequest;
    if (e.swapType !== "EXACT_INPUT") bad("swap type");
    if (e.originAsset !== want.originAsset) bad("origin asset");
    if (e.destinationAsset !== want.destinationAsset) bad("destination asset");
    if (e.depositType !== "ORIGIN_CHAIN" || e.refundType !== "ORIGIN_CHAIN" || e.recipientType !== "DESTINATION_CHAIN") bad("address types");
    // Addresses: case-insensitive (EVM checksums); a different address would differ in more than case.
    if (!sameAddr(e.recipient, want.recipient)) bad("recipient");
    if (!sameAddr(e.refundTo, want.refundTo)) bad("refund address");
    if (e.amount !== want.amount) bad("request amount");
    if (r.quote.amountIn !== want.amount) bad("amount in");
    if (BigInt(r.quote.amountOut) <= 0n || BigInt(r.quote.minAmountOut) > BigInt(r.quote.amountOut)) bad("amount out");

    if (kind === "dry") return { depositAddress: null, deadline: null };

    const addr = r.quote.depositAddress;
    if (!addr || !PLAIN.test(addr)) bad("deposit address");
    if (r.quote.depositMemo) bad("memo deposit not supported");
    if (!r.quote.deadline) bad("deadline missing");
    const ms = Date.parse(r.quote.deadline!);
    if (!Number.isFinite(ms)) bad("deadline format");
    const deadline = Math.floor(ms / 1000);
    if (deadline < this.now() + MIN_DEPOSIT_WINDOW_LEFT_SECONDS) bad("deadline too soon");
    return { depositAddress: addr!, deadline };
  }

  private microToFils(micro: string): bigint {
    return BigInt(micro) / MICRO_PER_FILS;
  }

  /** Maps provider failures to errors that are safe to show; details go to the (redacting) log. */
  private asApiError(e: unknown, what: string): ApiError {
    if (isApiError(e)) return e;
    if (e instanceof OneClickError) {
      this.log.error(`1Click ${what} failed: kind=${e.kind} status=${e.status ?? "-"}`);
      if (e.kind === "http" && e.status === 400) {
        return new ApiError("BAD_REQUEST", e.providerMessage ? `That deposit cannot be quoted: ${e.providerMessage}` : "That deposit cannot be quoted.");
      }
      if (e.kind === "http" && (e.status === 401 || e.status === 403)) this.log.error("ALERT: 1Click rejected our credentials");
      if (e.kind === "config") this.log.error("ALERT: 1Click/treasury configuration is invalid");
      if (e.kind === "rejected" || e.kind === "schema" || e.kind === "config" || e.kind === "parse") {
        return new ApiError("INTERNAL", "Deposit quote could not be verified. Please try again later.");
      }
      return new ApiError("PAUSED", "Deposits and withdrawals are not available right now.");
    }
    this.log.error(`1Click ${what} failed unexpectedly`);
    return new ApiError("INTERNAL", "Something went wrong. Please try again.");
  }

  // ------------------------------------------------------------------ treasury

  /** USDC held by the treasury account, in fils (micro / 100, truncated). */
  async treasuryBalanceFils(): Promise<string> {
    try {
      const u = await this.usdc();
      return (( await this.cfg.treasury.ftBalance(u.contract)) / MICRO_PER_FILS).toString();
    } catch (e) {
      throw this.asApiError(e, "treasury balance");
    }
  }

  // ------------------------------------------------------------------ deposits

  private async validateDepositRequest(req: IntentQuoteRequest, usdc: UsdcInfo): Promise<void> {
    if (!POS_INT.test(req.amountIn)) throw new ApiError("BAD_REQUEST", "Invalid amount.");
    if (!PLAIN.test(req.refundAddress)) throw new ApiError("BAD_REQUEST", "Invalid refund address.");
    if (req.originAsset === usdc.assetId) throw new ApiError("BAD_REQUEST", "Send a different asset; USDC on NEAR is the settlement asset.");
    if (!(await this.tokenMap()).has(req.originAsset)) throw new ApiError("BAD_REQUEST", "That asset is not supported.");
  }

  private depositBody(req: IntentQuoteRequest, usdc: UsdcInfo, dry: boolean): Record<string, unknown> {
    return {
      dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: this.slippage,
      originAsset: req.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: usdc.assetId,
      amount: req.amountIn,
      refundTo: req.refundAddress,
      refundType: "ORIGIN_CHAIN",
      recipient: this.cfg.treasuryAccountId,
      recipientType: "DESTINATION_CHAIN",
      deadline: this.deadlineIso(),
    };
  }

  /** Dry quote (no deposit address is created): what the player would get, for the UI. */
  async previewDeposit(req: IntentQuoteRequest): Promise<DepositPreview> {
    try {
      const usdc = await this.usdc();
      await this.validateDepositRequest(req, usdc);
      const { body } = await this.http.post("/v0/quote", this.depositBody(req, usdc, true));
      const r = this.parse(QuoteResponseSchema, body, "quote");
      this.checkQuote(r, { originAsset: req.originAsset, destinationAsset: usdc.assetId, recipient: this.cfg.treasuryAccountId, refundTo: req.refundAddress, amount: req.amountIn }, "dry");
      return {
        amountIn: r.quote.amountIn,
        expectedFils: this.microToFils(r.quote.amountOut).toString(),
        minFils: this.microToFils(r.quote.minAmountOut).toString(),
        timeEstimateSeconds: r.quote.timeEstimate ?? null,
      };
    } catch (e) {
      throw this.asApiError(e, "dry quote");
    }
  }

  /** Real quote: creates the deposit address and deadline. quoteId === depositAddress (the status key). */
  async quote(req: IntentQuoteRequest): Promise<IntentQuote> {
    try {
      const usdc = await this.usdc();
      await this.validateDepositRequest(req, usdc);
      const { body } = await this.http.post("/v0/quote", this.depositBody(req, usdc, false));
      const r = this.parse(QuoteResponseSchema, body, "quote");
      const { depositAddress, deadline } = this.checkQuote(
        r, { originAsset: req.originAsset, destinationAsset: usdc.assetId, recipient: this.cfg.treasuryAccountId, refundTo: req.refundAddress, amount: req.amountIn }, "real",
      );
      const expected = this.microToFils(r.quote.amountOut);
      if (expected <= 0n) throw new OneClickError("rejected", "Quote rejected (value too small)");
      this.log.warn(`1Click deposit quote created correlation=${r.correlationId.slice(0, 64)} address=${short(depositAddress!)}`);
      return {
        quoteId: depositAddress!, depositAddress: depositAddress!, amountIn: r.quote.amountIn,
        expectedFils: expected.toString(), deadline: deadline!, signature: r.signature,
      };
    } catch (e) {
      throw this.asApiError(e, "deposit quote");
    }
  }

  // ------------------------------------------------------------------ status

  private async fetchStatus(depositAddress: string): Promise<OneClickStatusResponse | null> {
    if (!PLAIN.test(depositAddress)) throw new OneClickError("rejected", "Invalid deposit address");
    const { status, body } = await this.http.get("/v0/status", { depositAddress }, [404]);
    if (status === 404) return null;
    const r = this.parse(StatusResponseSchema, body, "status");
    // The answer must be about the address we asked for.
    if (!r.quoteResponse.quote.depositAddress || !sameAddr(r.quoteResponse.quote.depositAddress, depositAddress)) {
      throw new OneClickError("rejected", "Status answer is for another deposit address");
    }
    return r;
  }

  private static mapState(s: OneClickStatusResponse["status"]): IntentState {
    switch (s) {
      case "SUCCESS": return "SUCCESS";
      case "REFUNDED": return "REFUNDED";
      case "FAILED": return "FAILED";
      // Waiting for or processing a deposit; an INCOMPLETE_DEPOSIT may still be topped up before the deadline.
      // Expiry is decided by the cron from the quote deadline (+ grace), never by this client.
      case "PENDING_DEPOSIT":
      case "KNOWN_DEPOSIT_TX":
      case "INCOMPLETE_DEPOSIT":
      case "PROCESSING":
        return "PENDING";
    }
  }

  /**
   * Deposit status by deposit address (the quote id). SUCCESS carries what the provider says arrived at
   * the recipient, in fils, plus the recipient and the quoted origin asset; game/cron.ts verifies all three
   * before crediting. An unknown address (404) is reported as PENDING so the deadline logic can expire it.
   */
  async status(quoteId: string): Promise<IntentStatus> {
    let r: OneClickStatusResponse | null;
    try {
      r = await this.fetchStatus(quoteId);
    } catch (e) {
      throw this.asApiError(e, "status");
    }
    if (r === null) return { state: "PENDING" };
    const state = OneClickIntents.mapState(r.status);
    if (state !== "SUCCESS") return { state };

    const echo = r.quoteResponse.quoteRequest;
    let usdc: UsdcInfo;
    try {
      usdc = await this.usdc();
    } catch (e) {
      throw this.asApiError(e, "status");
    }
    // The money must have been swapped INTO our USDC and sent to a chain address (not to an Intents account).
    if (echo.destinationAsset !== usdc.assetId || echo.recipientType !== "DESTINATION_CHAIN") {
      this.log.error("ALERT: 1Click reports SUCCESS for a quote that does not settle in our USDC");
      return { state: "FAILED" };
    }
    const out = r.swapDetails.amountOut;
    const fils = out !== undefined ? this.microToFils(out) : 0n;
    return {
      state: "SUCCESS",
      receivedFils: fils > 0n ? fils.toString() : undefined, // omitted -> the cron refuses to credit
      recipient: echo.recipient,
      asset: echo.originAsset,
    };
  }

  /**
   * Withdrawal follow-up by deposit address (the quoteId returned by withdraw()). The IntentsClient
   * interface has no such method and game/cron.ts does not poll SENT withdrawals yet: see OPEN_ISSUES.md.
   */
  async withdrawalStatus(quoteId: string): Promise<{ state: IntentState; refundedMicro?: string }> {
    let r: OneClickStatusResponse | null;
    try {
      r = await this.fetchStatus(quoteId);
    } catch (e) {
      throw this.asApiError(e, "withdrawal status");
    }
    if (r === null) return { state: "PENDING" };
    return { state: OneClickIntents.mapState(r.status), refundedMicro: r.swapDetails.refundedAmount };
  }

  // ------------------------------------------------------------------ withdrawals

  /**
   * Quote from the treasury's USDC to the player's asset/address, then ft_transfer to the deposit address.
   *  - Failure BEFORE the transfer is submitted (bad input, quote refused, balance too low): { ok:false }, no funds moved.
   *  - The transfer definitely failed on chain: { ok:false }.
   *  - The transfer outcome is unknown (network error, timeout): THROWS; the cron keeps the row in SENDING for a human.
   *  - The same `ref` is never processed twice by one process (a second call throws).
   */
  async withdraw(req: IntentWithdrawRequest): Promise<IntentWithdrawResult> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(req.ref)) return { ok: false, reason: "invalid reference" };
    if (this.withdrawRefs.has(req.ref)) throw new OneClickError("rejected", "Withdrawal reference already processed in this process");
    this.withdrawRefs.add(req.ref);

    if (!POS_INT.test(req.fils)) return { ok: false, reason: "invalid amount" };
    if (!PLAIN.test(req.destAddress)) return { ok: false, reason: "invalid destination address" };
    const micro = BigInt(req.fils) * MICRO_PER_FILS;

    let usdc: UsdcInfo;
    let depositAddress: string;
    let signature: string | undefined;
    try {
      usdc = await this.usdc();
      if (!(await this.tokenMap()).has(req.destAsset)) return { ok: false, reason: "unsupported destination asset" };

      // Hard guard: never ask 1Click for an address to fund if the treasury cannot pay.
      if ((await this.cfg.treasury.ftBalance(usdc.contract)) < micro) {
        this.log.error("ALERT: treasury balance below withdrawal amount; refusing to send");
        return { ok: false, reason: "treasury balance too low" };
      }

      const amount = micro.toString();
      const { body } = await this.http.post("/v0/quote", {
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: this.slippage,
        originAsset: usdc.assetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: req.destAsset,
        amount,
        refundTo: this.cfg.treasuryAccountId,
        refundType: "ORIGIN_CHAIN",
        recipient: req.destAddress,
        recipientType: "DESTINATION_CHAIN",
        deadline: this.deadlineIso(),
      });
      const r = this.parse(QuoteResponseSchema, body, "quote");
      const checked = this.checkQuote(
        r, { originAsset: usdc.assetId, destinationAsset: req.destAsset, recipient: req.destAddress, refundTo: this.cfg.treasuryAccountId, amount }, "real",
      );
      // The deposit address is on NEAR (origin chain = NEAR): it must look like a NEAR account id.
      if (!NEAR_ACCOUNT.test(checked.depositAddress!)) throw new OneClickError("rejected", "Quote rejected (deposit address is not a NEAR account)");
      depositAddress = checked.depositAddress!;
      signature = r.signature;
      this.log.warn(`1Click withdrawal quote created correlation=${r.correlationId.slice(0, 64)} address=${short(depositAddress)}`);
    } catch (e) {
      // Nothing has been sent yet, so the player can be refunded safely.
      const kind = e instanceof OneClickError ? e.kind : "unexpected";
      this.log.error(`withdrawal ${req.ref} not sent before transfer: ${kind}`);
      return { ok: false, reason: e instanceof OneClickError && e.kind === "rejected" ? "quote rejected" : "quote unavailable" };
    }

    // From here the outcome of a thrown error is UNKNOWN: let it propagate.
    const t = await this.cfg.treasury.ftTransfer({ tokenContract: usdc.contract, receiver: depositAddress, amount: micro });
    if (!t.ok) {
      this.log.error(`withdrawal ${req.ref}: transfer to the quote address failed on chain`);
      return { ok: false, reason: "transfer failed" };
    }

    // Optional speed-up (docs: "Optionally notifies the 1Click service"); never affects the result.
    try {
      await this.http.post("/v0/deposit/submit", {
        txHash: t.txHash, depositAddress, nearSenderAccount: this.cfg.treasuryAccountId,
      });
    } catch {
      this.log.warn(`withdrawal ${req.ref}: deposit notification failed (harmless)`);
    }
    return { ok: true, quoteId: depositAddress, txHash: t.txHash, signature };
  }
}
