// Unit tests of the 1Click client against a mocked HTTP layer. Fixtures are doc-derived (see
// oneclick-fixtures.ts). No network, no keys, no chain.

import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { validateQuote } from "../game/money";
import { OneClickError, OneClickHttp, type FetchLike } from "../intents/http";
import { OneClickIntents, type OneClickConfig } from "../intents/oneclick";
import type { TransferResult, TreasuryChain } from "../intents/treasury";
import {
  DOC_ARB_REFUND_ADDRESS, DOC_ARB_USDC, DOC_BAD_REQUEST, DOC_CORRELATION_ID, DOC_QUOTE_AMOUNTS, DOC_SOL_RECIPIENT, DOC_SOL_USDC,
  DOC_STATUSES, DOC_SWAP_DETAILS, DOC_TOKENS, MockOneClick, START, TEST_JWT, TEST_TREASURY, TEST_USDC_ASSET_ID, TEST_USDC_TOKEN, tokenList,
} from "./oneclick-fixtures";

class FakeTreasury implements TreasuryChain {
  balance = 50_000_000n; // micro-USDC held (test value)
  transfers: Array<{ tokenContract: string; receiver: string; amount: bigint }> = [];
  mode: "ok" | "fail" | "throw" = "ok";
  balanceThrows = false;
  async ftBalance(): Promise<bigint> {
    if (this.balanceThrows) throw new Error("rpc down");
    return this.balance;
  }
  async ftTransfer(a: { tokenContract: string; receiver: string; amount: bigint }): Promise<TransferResult> {
    this.transfers.push(a);
    if (this.mode === "throw") throw new Error("network died mid-send");
    if (this.mode === "fail") return { ok: false, reason: "token transfer failed" };
    this.balance -= a.amount;
    return { ok: true, txHash: `treasury-tx-${this.transfers.length}` };
  }
}

function setup(over: Partial<OneClickConfig> = {}) {
  const mock = new MockOneClick();
  const treasury = new FakeTreasury();
  const logs: string[] = [];
  const clock = { now: START };
  const client = new OneClickIntents({
    jwt: TEST_JWT, usdcAssetId: TEST_USDC_ASSET_ID, treasuryAccountId: TEST_TREASURY, treasury,
    fetch: mock.fetch, now: () => clock.now, sleep: async () => undefined,
    log: { warn: (...p) => logs.push(p.join(" ")), error: (...p) => logs.push(p.join(" ")) },
    ...over,
  });
  return { mock, treasury, logs, clock, client };
}

const DEPOSIT = { originAsset: DOC_ARB_USDC, amountIn: DOC_QUOTE_AMOUNTS.amountIn, refundAddress: DOC_ARB_REFUND_ADDRESS, userRef: "user-1" };
const WITHDRAW = { fils: "10000", destAsset: DOC_SOL_USDC, destAddress: DOC_SOL_RECIPIENT, ref: "7" }; // 10,000 fils = 1 USDC = '1000000' micro

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof ApiError ? e.code : e instanceof OneClickError ? `one:${e.kind}` : "other";
  }
  return "no-error";
}

// ------------------------------------------------------------------------------------------ HTTP layer

describe("http layer", () => {
  const mk = (fetchImpl: FetchLike, over: Partial<ConstructorParameters<typeof OneClickHttp>[0]> = {}) =>
    new OneClickHttp({
      baseUrl: "https://1click.example.invalid", jwt: TEST_JWT, authHeader: "x-api-key", fetchImpl, timeoutMs: 25, maxRetries: 2,
      retryBaseMs: 1, sleep: async () => undefined, maxBodyBytes: 1000, ...over,
    });
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

  it("sends the credential as X-API-Key (or Bearer), never in the URL, and refuses redirects", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const f: FetchLike = async (url, init) => { seen.push({ url, init }); return ok([]); };
    await mk(f).get("/v0/tokens");
    await mk(f, { authHeader: "bearer" }).get("/v0/tokens");
    expect(new Headers(seen[0]!.init.headers).get("x-api-key")).toBe(TEST_JWT);
    expect(new Headers(seen[1]!.init.headers).get("authorization")).toBe(`Bearer ${TEST_JWT}`);
    expect(seen.every((s) => !s.url.includes(TEST_JWT) && s.init.redirect === "error")).toBe(true);
  });

  it("requires plain https and a credential", () => {
    expect(() => mk(async () => ok([]), { baseUrl: "http://1click.example.invalid" })).toThrow(OneClickError);
    expect(() => mk(async () => ok([]), { baseUrl: "https://user:pw@1click.example.invalid" })).toThrow(OneClickError);
    expect(() => mk(async () => ok([]), { jwt: "" })).toThrow(OneClickError);
  });

  it("retries GET on network errors, 429 and 5xx, then succeeds", async () => {
    let n = 0;
    const f: FetchLike = async () => {
      n += 1;
      if (n === 1) throw new Error("socket hang up");
      if (n === 2) return ok(DOC_BAD_REQUEST, 503);
      return ok([1]);
    };
    expect((await mk(f).get("/v0/tokens")).body).toEqual([1]);
    expect(n).toBe(3);
  });

  it("gives up after maxRetries on GET", async () => {
    let n = 0;
    const f: FetchLike = async () => { n += 1; return ok(DOC_BAD_REQUEST, 500); };
    await expect(mk(f).get("/v0/tokens")).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(n).toBe(3);
  });

  it("never retries a POST, even on 5xx or a network error", async () => {
    let n = 0;
    await expect(mk(async () => { n += 1; return ok(DOC_BAD_REQUEST, 503); }).post("/v0/quote", {})).rejects.toMatchObject({ status: 503 });
    expect(n).toBe(1);
    n = 0;
    await expect(mk(async () => { n += 1; throw new Error("boom"); }).post("/v0/quote", {})).rejects.toMatchObject({ kind: "network" });
    expect(n).toBe(1);
  });

  it("does not retry 4xx on GET", async () => {
    let n = 0;
    await expect(mk(async () => { n += 1; return ok(DOC_BAD_REQUEST, 401); }).get("/v0/status", { depositAddress: "x" })).rejects.toMatchObject({ status: 401 });
    expect(n).toBe(1);
  });

  it("times out a hanging request (and counts the retries for GET)", async () => {
    let n = 0;
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => { n += 1; init.signal!.addEventListener("abort", () => rej(new Error("aborted"))); });
    await expect(mk(hang).get("/v0/tokens")).rejects.toMatchObject({ kind: "timeout" });
    expect(n).toBe(3);
    n = 0;
    await expect(mk(hang).post("/v0/quote", {})).rejects.toMatchObject({ kind: "timeout" });
    expect(n).toBe(1);
  });

  it("rejects oversized and non-JSON answers", async () => {
    await expect(mk(async () => new Response("x".repeat(2000), { status: 200 })).get("/v0/tokens")).rejects.toMatchObject({ kind: "too_large" });
    await expect(mk(async () => new Response("<html>", { status: 200 })).get("/v0/tokens")).rejects.toMatchObject({ kind: "parse" });
    await expect(mk(async () => new Response("", { status: 200 })).get("/v0/tokens")).rejects.toMatchObject({ kind: "parse" });
  });

  it("the credential never appears in errors, even if the provider echoes it, nor in printed objects", async () => {
    const f: FetchLike = async () => ok({ message: `bad key ${TEST_JWT}\n  Bearer ${TEST_JWT}` }, 400);
    const h = mk(f);
    const err = (await h.post("/v0/quote", {}).catch((e: unknown) => e)) as OneClickError;
    expect(err).toBeInstanceOf(OneClickError);
    expect(JSON.stringify([err.message, err.providerMessage, err.stack ?? ""])).not.toContain(TEST_JWT);
    expect(err.providerMessage).toContain("[token]");
    expect(JSON.stringify(h)).not.toContain(TEST_JWT);
    expect(inspect(h, { depth: 6, showHidden: true })).not.toContain(TEST_JWT);
    expect(inspect(setup().client, { depth: 6 })).not.toContain(TEST_JWT);
    expect(JSON.stringify(setup().client)).not.toContain(TEST_JWT);
  });
});

// ------------------------------------------------------------------------------------------ tokens & config

describe("asset list and configuration", () => {
  it("lists the documented token shape, keeps null contract addresses, ignores malformed entries, caches 5 minutes", async () => {
    const { mock, client, clock, logs } = setup();
    mock.tokens = [...tokenList(), { assetId: 42 }, { nope: true }];
    const list = await client.listTokens();
    expect(list.map((t) => t.symbol)).toEqual(expect.arrayContaining(["wNEAR", "ETH", "BTC", "USDC"]));
    expect(list.find((t) => t.symbol === "ETH")!.contractAddress).toBeNull();
    expect(list.find((t) => t.symbol === "wNEAR")).toEqual({ assetId: "nep141:wrap.near", symbol: "wNEAR", blockchain: "near", decimals: 24, contractAddress: "wrap.near" });
    expect(logs.join("\n")).toContain("2 malformed entries ignored");
    await client.listTokens();
    expect(mock.count("/v0/tokens")).toBe(1);
    clock.now += 301;
    await client.listTokens();
    expect(mock.count("/v0/tokens")).toBe(2);
  });

  it("uses a stale list for up to an hour when the provider is down, then fails", async () => {
    const { mock, client, clock } = setup();
    await client.listTokens();
    mock.override.push(() => mock.json(DOC_BAD_REQUEST, 503));
    clock.now += 400;
    expect((await client.listTokens()).length).toBeGreaterThan(0);
    clock.now += 4000;
    await expect(client.listTokens()).rejects.toBeInstanceOf(OneClickError);
  });

  it("rejects a tokens answer that is not an array or is empty", async () => {
    const a = setup();
    a.mock.tokens = { tokens: [] };
    await expect(a.client.listTokens()).rejects.toMatchObject({ kind: "schema" });
    const b = setup();
    b.mock.tokens = [{ bad: 1 }];
    await expect(b.client.listTokens()).rejects.toMatchObject({ kind: "schema" });
  });

  it("fails closed when the configured USDC asset is missing, not USDC, not 6 decimals, or mismatched", async () => {
    const cases: Array<Record<string, unknown> | null> = [
      null, { ...TEST_USDC_TOKEN, symbol: "USDT" }, { ...TEST_USDC_TOKEN, decimals: 18 }, { ...TEST_USDC_TOKEN, blockchain: "eth" },
      { ...TEST_USDC_TOKEN, contractAddress: "other.near" },
    ];
    for (const bad of cases) {
      const { mock, client } = setup();
      mock.tokens = [...DOC_TOKENS, ...(bad ? [bad] : [])];
      expect(await code(client.treasuryBalanceFils())).toBe("INTERNAL");
      expect(await code(client.quote(DEPOSIT))).toBe("INTERNAL");
      expect(mock.count("/v0/quote")).toBe(0);
    }
  });

  it("constructor refuses malformed configuration", () => {
    expect(() => setup({ usdcAssetId: "usdc" })).toThrow(OneClickError);
    expect(() => setup({ treasuryAccountId: "Bad Account" })).toThrow(OneClickError);
    expect(() => setup({ jwt: "" })).toThrow(OneClickError);
    expect(() => setup({ slippageBps: 5000 })).toThrow(OneClickError);
    expect(() => setup({ depositWindowSeconds: 10 })).toThrow(OneClickError);
  });

  it("treasury balance: micro-USDC / 100 = fils, truncated", async () => {
    const { client, treasury } = setup();
    treasury.balance = 12_345_678n;
    expect(client.configured).toBe(true);
    expect(await client.treasuryBalanceFils()).toBe("123456");
    treasury.balanceThrows = true;
    expect(await code(client.treasuryBalanceFils())).toBe("INTERNAL");
  });
});

// ------------------------------------------------------------------------------------------ deposits

describe("deposit quote", () => {
  it("sends exactly the documented request: EXACT_INPUT, ORIGIN_CHAIN, USDC on NEAR to the treasury, refund address and deadline", async () => {
    const { mock, client } = setup();
    const q = await client.quote(DEPOSIT);
    const body = mock.last("/v0/quote", "POST").body!;
    expect(body).toEqual({
      dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: DOC_ARB_USDC, depositType: "ORIGIN_CHAIN",
      destinationAsset: TEST_USDC_ASSET_ID, amount: "1000000", refundTo: DOC_ARB_REFUND_ADDRESS, refundType: "ORIGIN_CHAIN",
      recipient: TEST_TREASURY, recipientType: "DESTINATION_CHAIN", deadline: new Date((START + 7200) * 1000).toISOString(),
    });
    expect(JSON.stringify(body)).not.toContain("user-1"); // our user reference is not sent to the provider
    expect(q.quoteId).toBe(q.depositAddress);
    expect(q.amountIn).toBe("1000000");
    expect(q.expectedFils).toBe("99500"); // docs' amountOut '9950000' micro / 100
    expect(q.deadline).toBe(START + 7200);
    // The server's own validation accepts it.
    expect(() => validateQuote(q, DEPOSIT.amountIn, START)).not.toThrow();
  });

  it("the dry quote previews the result and creates no deposit address", async () => {
    const { mock, client } = setup();
    const p = await client.previewDeposit(DEPOSIT);
    expect(mock.last("/v0/quote").body!.dry).toBe(true);
    expect(p).toEqual({ amountIn: "1000000", expectedFils: "99500", minFils: "99000", timeEstimateSeconds: 120 });
    expect(mock.quotes.size).toBe(0);
  });

  it("validates the request before calling the provider", async () => {
    const { mock, client } = setup();
    const bad = [
      { ...DEPOSIT, amountIn: "0" }, { ...DEPOSIT, amountIn: "1.5" }, { ...DEPOSIT, amountIn: "-3" }, { ...DEPOSIT, refundAddress: "" },
      { ...DEPOSIT, refundAddress: "has space" }, { ...DEPOSIT, originAsset: "nep141:unknown.near" }, { ...DEPOSIT, originAsset: TEST_USDC_ASSET_ID },
    ];
    for (const r of bad) expect(await code(client.quote(r))).toBe("BAD_REQUEST");
    expect(mock.count("/v0/quote")).toBe(0);
  });

  it.each([
    ["a memo deposit", (r: Record<string, any>) => { r.quote.depositMemo = "1111111"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a missing deposit address", (r: Record<string, any>) => { delete r.quote.depositAddress; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a deposit address with spaces", (r: Record<string, any>) => { r.quote.depositAddress = "a b"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a missing deadline", (r: Record<string, any>) => { delete r.quote.deadline; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a deadline in the past", (r: Record<string, any>) => { r.quote.deadline = "2019-08-24T14:15:22Z"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a deadline that is not a date", (r: Record<string, any>) => { r.quote.deadline = "soon"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["another recipient", (r: Record<string, any>) => { r.quoteRequest.recipient = "attacker.near"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["another destination asset", (r: Record<string, any>) => { r.quoteRequest.destinationAsset = DOC_SOL_USDC; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["another origin asset", (r: Record<string, any>) => { r.quoteRequest.originAsset = DOC_SOL_USDC; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["another refund address", (r: Record<string, any>) => { r.quoteRequest.refundTo = "0xattacker"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an Intents-account recipient type", (r: Record<string, any>) => { r.quoteRequest.recipientType = "INTENTS"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a different amount in the echo", (r: Record<string, any>) => { r.quoteRequest.amount = "2000000"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a different amountIn", (r: Record<string, any>) => { r.quote.amountIn = "2000000"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a zero amountOut", (r: Record<string, any>) => { r.quote.amountOut = "0"; r.quote.minAmountOut = "0"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["an amountOut that truncates to zero fils", (r: Record<string, any>) => { r.quote.amountOut = "99"; r.quote.minAmountOut = "50"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a decimal amountOut", (r: Record<string, any>) => { r.quote.amountOut = "9.95"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a missing quote object", (r: Record<string, any>) => { delete r.quote; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["a swap type other than EXACT_INPUT", (r: Record<string, any>) => { r.quoteRequest.swapType = "FLEX_INPUT"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])("refuses %s", async (_name, mutate) => {
    const { mock, client } = setup();
    mock.tamper = (resp) => mutate(resp as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await code(client.quote(DEPOSIT))).toBe("INTERNAL");
  });

  it("accepts address case differences in the echo (EVM checksums) but not other addresses", async () => {
    const { mock, client } = setup();
    mock.tamper = (resp) => { (resp.quoteRequest as Record<string, string>).refundTo = DOC_ARB_REFUND_ADDRESS.toLowerCase(); };
    await expect(client.quote(DEPOSIT)).resolves.toMatchObject({ amountIn: "1000000" });
  });

  it("maps provider errors: 400 -> BAD_REQUEST with the sanitised message; 401/5xx/network -> PAUSED", async () => {
    const a = setup();
    a.mock.override.push((c) => (c.path === "/v0/quote" ? a.mock.json({ message: "Amount is too low" }, 400) : null));
    await expect(a.client.quote(DEPOSIT)).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Amount is too low") });

    for (const status of [401, 403, 429, 500, 503]) {
      const s = setup();
      s.mock.override.push((c) => (c.path === "/v0/quote" ? s.mock.json(DOC_BAD_REQUEST, status) : null));
      expect(await code(s.client.quote(DEPOSIT))).toBe("PAUSED");
      expect(s.mock.count("/v0/quote")).toBe(1); // never retried
      if (status === 401) expect(s.logs.join("\n")).toContain("rejected our credentials");
    }
    const n = setup({ fetch: async () => { throw new Error("offline"); } });
    expect(await code(n.client.quote(DEPOSIT))).toBe("PAUSED");
  });

  it("never logs the credential, the full deposit address or the refund address", async () => {
    const { client, logs, mock } = setup();
    const q = await client.quote(DEPOSIT);
    await client.status(q.quoteId);
    mock.tamper = (r) => { delete (r.quote as Record<string, unknown>).depositAddress; };
    await client.quote(DEPOSIT).catch(() => undefined);
    const all = logs.join("\n");
    expect(all).toContain(DOC_CORRELATION_ID);
    expect(all).not.toContain(TEST_JWT);
    expect(all).not.toContain(q.depositAddress);
    expect(all).not.toContain(DOC_ARB_REFUND_ADDRESS);
  });
});

// ------------------------------------------------------------------------------------------ status

describe("deposit status", () => {
  async function quoted() {
    const s = setup();
    const q = await s.client.quote(DEPOSIT);
    return { ...s, q };
  }

  it("asks by deposit address and maps every documented status", async () => {
    const { mock, client, q } = await quoted();
    const expected: Record<string, string> = {
      PENDING_DEPOSIT: "PENDING", KNOWN_DEPOSIT_TX: "PENDING", INCOMPLETE_DEPOSIT: "PENDING", PROCESSING: "PENDING",
      SUCCESS: "SUCCESS", REFUNDED: "REFUNDED", FAILED: "FAILED",
    };
    for (const st of DOC_STATUSES) {
      mock.setStatus(q.depositAddress, st);
      expect((await client.status(q.quoteId)).state).toBe(expected[st]);
    }
    const c = mock.last("/v0/status");
    expect(c.method).toBe("GET");
    expect(c.query.get("depositAddress")).toBe(q.depositAddress);
    expect([...c.query.keys()]).toEqual(["depositAddress"]);
  });

  it("SUCCESS reports what arrived (fils), the recipient and the quoted origin asset", async () => {
    const { mock, client, q } = await quoted();
    mock.setStatus(q.depositAddress, "SUCCESS");
    expect(await client.status(q.quoteId)).toEqual({ state: "SUCCESS", receivedFils: "99500", recipient: TEST_TREASURY, asset: DOC_ARB_USDC });
  });

  it("SUCCESS without a usable amount carries no receivedFils (the cron then refuses to credit)", async () => {
    const { mock, client, q } = await quoted();
    mock.setStatus(q.depositAddress, "SUCCESS", { ...DOC_SWAP_DETAILS, amountOut: undefined });
    expect((await client.status(q.quoteId)).receivedFils).toBeUndefined();
    mock.setStatus(q.depositAddress, "SUCCESS", { ...DOC_SWAP_DETAILS, amountOut: "99" }); // < 1 fil
    expect((await client.status(q.quoteId)).receivedFils).toBeUndefined();
  });

  it("SUCCESS for a quote that does not settle in our USDC is FAILED and alerts", async () => {
    const { mock, client, q, logs } = await quoted();
    (mock.quotes.get(q.depositAddress)!.response.quoteRequest as Record<string, string>).destinationAsset = DOC_SOL_USDC;
    mock.setStatus(q.depositAddress, "SUCCESS");
    expect((await client.status(q.quoteId)).state).toBe("FAILED");
    expect(logs.join("\n")).toContain("ALERT");
  });

  it("reports an echoed recipient other than ours as-is so game/cron.ts refuses to credit", async () => {
    const { mock, client, q } = await quoted();
    (mock.quotes.get(q.depositAddress)!.response.quoteRequest as Record<string, string>).recipient = "someone-else.near";
    mock.setStatus(q.depositAddress, "SUCCESS");
    expect((await client.status(q.quoteId)).recipient).toBe("someone-else.near");
  });

  it("an unknown address (404) is PENDING so the deadline logic can expire it", async () => {
    const { client } = setup();
    expect(await client.status("0xunknown")).toEqual({ state: "PENDING" });
  });

  it("throws on an unknown status value, a malformed answer, an answer for another address, or a refused address", async () => {
    const { mock, client, q } = await quoted();
    mock.quotes.get(q.depositAddress)!.status = "EXPIRED" as never;
    expect(await code(client.status(q.quoteId))).toBe("INTERNAL");
    mock.quotes.get(q.depositAddress)!.status = "SUCCESS";
    mock.quotes.get(q.depositAddress)!.swapDetails = "nope" as never;
    expect(await code(client.status(q.quoteId))).toBe("INTERNAL");

    // An answer about another deposit address than the one we asked for is refused.
    const aResp = mock.quotes.get(q.depositAddress)!.response;
    mock.override.push((c) => (c.path === "/v0/status" ? mock.json({ correlationId: DOC_CORRELATION_ID, quoteResponse: aResp, status: "SUCCESS", updatedAt: "x", swapDetails: DOC_SWAP_DETAILS }) : null));
    expect(await code(client.status("0xdifferent"))).toBe("INTERNAL");
    expect(await code(client.status("bad address"))).toBe("INTERNAL");
  });

  it("provider downtime on a status check surfaces as PAUSED (the cron logs and retries next minute)", async () => {
    const { mock, client, q } = await quoted();
    mock.override.push((c) => (c.path === "/v0/status" ? mock.json(DOC_BAD_REQUEST, 503) : null));
    expect(await code(client.status(q.quoteId))).toBe("PAUSED");
    expect(mock.count("/v0/status")).toBe(3); // GET: retried twice
  });
});

// ------------------------------------------------------------------------------------------ withdrawals

describe("withdrawal", () => {
  it("quotes from the treasury's USDC and sends exactly amountIn to the quote's deposit address", async () => {
    const { mock, client, treasury } = setup();
    const r = await client.withdraw(WITHDRAW);
    const body = mock.last("/v0/quote").body!;
    expect(body).toEqual({
      dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: TEST_USDC_ASSET_ID, depositType: "ORIGIN_CHAIN",
      destinationAsset: DOC_SOL_USDC, amount: "1000000", refundTo: TEST_TREASURY, refundType: "ORIGIN_CHAIN",
      recipient: DOC_SOL_RECIPIENT, recipientType: "DESTINATION_CHAIN", deadline: new Date((START + 7200) * 1000).toISOString(),
    });
    const addr = [...mock.quotes.keys()][0]!;
    expect(treasury.transfers).toEqual([{ tokenContract: "usdc-test-placeholder.near", receiver: addr, amount: 1_000_000n }]);
    expect(r).toEqual({ ok: true, quoteId: addr, txHash: "treasury-tx-1" });
    expect(mock.count("/v0/deposit/submit", "POST")).toBe(1);
    expect(mock.last("/v0/deposit/submit").body).toEqual({ txHash: "treasury-tx-1", depositAddress: addr, nearSenderAccount: TEST_TREASURY });
  });

  it("a failing optional deposit notification does not change the result", async () => {
    const { mock, client } = setup();
    mock.override.push((c) => (c.path === "/v0/deposit/submit" ? mock.json(DOC_BAD_REQUEST, 500) : null));
    expect((await client.withdraw(WITHDRAW)).ok).toBe(true);
  });

  it("refuses without touching the chain when input is invalid, the asset unsupported, or the treasury too small", async () => {
    const cases: Array<[Partial<typeof WITHDRAW>, (t: FakeTreasury) => void]> = [
      [{ fils: "0" }, () => undefined], [{ fils: "1.5" }, () => undefined], [{ destAddress: "a b" }, () => undefined], [{ destAddress: "" }, () => undefined],
      [{ destAsset: "nep141:unknown.near" }, () => undefined], [{ ref: "bad ref!" }, () => undefined],
      [{}, (t) => { t.balance = 999_999n; }], [{}, (t) => { t.balanceThrows = true; }],
    ];
    for (const [over, prep] of cases) {
      const { client, treasury, mock } = setup();
      prep(treasury);
      const r = await client.withdraw({ ...WITHDRAW, ...over });
      expect(r.ok).toBe(false);
      expect(treasury.transfers).toHaveLength(0);
      expect(mock.quotes.size).toBe(0);
    }
  });

  it("a refused or broken quote is ok:false and nothing is sent", async () => {
    const mutations: Array<(r: Record<string, any>) => void> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      (r) => { r.quoteRequest.recipient = "attacker"; },
      (r) => { r.quote.amountIn = "2000000"; },
      (r) => { r.quote.depositMemo = "123"; },
      (r) => { delete r.quote.depositAddress; },
      (r) => { r.quote.depositAddress = "0xNotANearAccount"; },
      (r) => { r.quote.amountOut = "0"; r.quote.minAmountOut = "0"; },
      (r) => { r.quote.deadline = "2019-08-24T14:15:22Z"; },
    ];
    for (const m of mutations) {
      const { client, treasury, mock } = setup();
      mock.tamper = (resp) => m(resp as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect((await client.withdraw(WITHDRAW)).ok).toBe(false);
      expect(treasury.transfers).toHaveLength(0);
    }
    for (const status of [400, 401, 503]) {
      const { client, treasury, mock } = setup();
      mock.override.push((c) => (c.path === "/v0/quote" ? mock.json(DOC_BAD_REQUEST, status) : null));
      expect((await client.withdraw(WITHDRAW)).ok).toBe(false);
      expect(treasury.transfers).toHaveLength(0);
      expect(mock.count("/v0/quote")).toBe(1);
    }
  });

  it("a transfer that definitely failed on chain is ok:false (the player can be refunded)", async () => {
    const { client, treasury } = setup();
    treasury.mode = "fail";
    expect(await client.withdraw(WITHDRAW)).toEqual({ ok: false, reason: "transfer failed" });
  });

  it("an unknown transfer outcome THROWS (stays SENDING for a human) and the same ref is never processed twice", async () => {
    const { client, treasury, mock } = setup();
    treasury.mode = "throw";
    await expect(client.withdraw(WITHDRAW)).rejects.toThrow("network died");
    treasury.mode = "ok";
    await expect(client.withdraw(WITHDRAW)).rejects.toMatchObject({ kind: "rejected" });
    expect(treasury.transfers).toHaveLength(1);
    expect(mock.count("/v0/quote")).toBe(1);
    // a different withdrawal id is independent
    expect((await client.withdraw({ ...WITHDRAW, ref: "8" })).ok).toBe(true);
  });

  it("follows a sent withdrawal by deposit address", async () => {
    const { client, mock } = setup();
    const r = await client.withdraw(WITHDRAW);
    if (!r.ok) throw new Error("expected ok");
    expect(await client.withdrawalStatus(r.quoteId)).toEqual({ state: "PENDING", refundedMicro: undefined });
    mock.setStatus(r.quoteId, "SUCCESS");
    expect((await client.withdrawalStatus(r.quoteId)).state).toBe("SUCCESS");
    mock.setStatus(r.quoteId, "REFUNDED", { ...DOC_SWAP_DETAILS, refundedAmount: "1000000" });
    expect(await client.withdrawalStatus(r.quoteId)).toEqual({ state: "REFUNDED", refundedMicro: "1000000" });
    mock.setStatus(r.quoteId, "FAILED");
    expect((await client.withdrawalStatus(r.quoteId)).state).toBe("FAILED");
  });
});
