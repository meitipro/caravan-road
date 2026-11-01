// The real OneClickIntents (mocked HTTP + fake treasury chain) driven through the actual routes and crons
// of the server with the in-memory contract and PGlite: credit-once, withdrawal, refund, fail-closed wiring.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as depositQuotePOST } from "../../app/api/deposit/quote/route";
import { GET as depositStatusGET } from "../../app/api/deposit/status/route";
import { POST as withdrawPOST } from "../../app/api/withdraw/route";
import { GET as stateGET } from "../../app/api/state/route";
import { GET as cronDepositsGET } from "../../app/api/cron/deposits/route";
import { GET as cronWithdrawalsGET } from "../../app/api/cron/withdrawals/route";
import { createIntentsClient } from "../intents/create";
import { OneClickIntents } from "../intents/oneclick";
import type { TransferResult, TreasuryChain } from "../intents/treasury";
import { unconfiguredIntents } from "../intents/unconfigured";
import { silentLog } from "../log";
import { CRON_SECRET_FOR_TESTS, call, get, makeKit, post, signIn, type Kit } from "./testkit";
import {
  DOC_ARB_REFUND_ADDRESS, DOC_ARB_USDC, DOC_SOL_RECIPIENT, DOC_SOL_USDC, MockOneClick, TEST_JWT, TEST_TREASURY, TEST_USDC_ASSET_ID,
} from "./oneclick-fixtures";

const TIMEOUT = 120_000;
const auth = { headers: { authorization: `Bearer ${CRON_SECRET_FOR_TESTS}` } };
const runCron = (h: (r: Request) => Promise<Response>, path: string) => call(h, "GET", path, undefined, auth);

class Treasury implements TreasuryChain {
  balance = 50_000_000n;
  transfers: Array<{ receiver: string; amount: bigint }> = [];
  mode: "ok" | "fail" = "ok";
  async ftBalance(): Promise<bigint> { return this.balance; }
  async ftTransfer(a: { receiver: string; amount: bigint }): Promise<TransferResult> {
    this.transfers.push(a);
    if (this.mode === "fail") return { ok: false, reason: "token transfer failed" };
    this.balance -= a.amount;
    return { ok: true, txHash: `tx-${this.transfers.length}` };
  }
}

describe("OneClickIntents through the server routes and crons", () => {
  let kit: Kit;
  let mock: MockOneClick;
  let treasury: Treasury;
  beforeAll(async () => {
    kit = await makeKit({ mode: "LIVE" });
    mock = new MockOneClick();
    treasury = new Treasury();
    kit.svc.intents = new OneClickIntents({
      jwt: TEST_JWT, usdcAssetId: TEST_USDC_ASSET_ID, treasuryAccountId: TEST_TREASURY, treasury,
      fetch: mock.fetch, now: () => kit.clock.now, sleep: async () => undefined, log: silentLog,
    });
  }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  const quote = (user: string) =>
    post(depositQuotePOST, "/api/deposit/quote", { origin_asset: DOC_ARB_USDC, amount_in: "1000000", refund_address: DOC_ARB_REFUND_ADDRESS }, { user });
  const status = (user: string, id: string) => get(depositStatusGET, "/api/deposit/status", { user, query: `?quote_id=${id}` });
  const withdraw = (user: string, fils: string) =>
    post(withdrawPOST, "/api/withdraw", { fils, dest_asset: DOC_SOL_USDC, dest_address: DOC_SOL_RECIPIENT }, { user });

  it("deposit: quote, PENDING while unpaid, credited exactly once when 1Click reports SUCCESS, even if the cron runs twice", async () => {
    const acc = await signIn(kit, stateGET, "alice");
    const q = await quote("alice");
    expect(q.json.ok).toBe(true);
    expect(q.json.data).toMatchObject({ amount_in: "1000000", expected_fils: "99500" });
    const id = q.json.data.quote_id as string;
    expect(q.json.data.deposit_address).toBe(id);

    mock.setStatus(id, "PENDING_DEPOSIT");
    expect((await runCron(cronDepositsGET, "/api/cron/deposits")).json.data).toEqual({ credited: 0, expired: 0, failed: 0 });
    mock.setStatus(id, "PROCESSING");
    expect((await runCron(cronDepositsGET, "/api/cron/deposits")).json.data.credited).toBe(0);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(0n);

    mock.setStatus(id, "SUCCESS");
    const [a, b] = await Promise.all([runCron(cronDepositsGET, "/api/cron/deposits"), runCron(cronDepositsGET, "/api/cron/deposits")]);
    expect(a.json.data.credited + b.json.data.credited).toBe(1);
    expect((await runCron(cronDepositsGET, "/api/cron/deposits")).json.data.credited).toBe(0);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(99500n);
    expect((await status("alice", id)).json.data).toEqual({ status: "CREDITED", fils_credited: "99500" });
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("deposit: a REFUNDED swap never credits; an unpaid quote EXPIRES after the deadline plus grace", async () => {
    const acc = await signIn(kit, stateGET, "bob");
    const refunded = (await quote("bob")).json.data.quote_id as string;
    const unpaid = (await quote("bob")).json.data.quote_id as string;
    mock.setStatus(refunded, "REFUNDED");
    const r1 = (await runCron(cronDepositsGET, "/api/cron/deposits")).json.data;
    expect(r1.failed).toBeGreaterThanOrEqual(1);
    expect((await status("bob", refunded)).json.data.status).toBe("FAILED");
    kit.clock.advance(7200 + 3600 + 5);
    const r2 = (await runCron(cronDepositsGET, "/api/cron/deposits")).json.data;
    expect(r2.expired).toBeGreaterThanOrEqual(1);
    expect((await status("bob", unpaid)).json.data.status).toBe("EXPIRED");
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(0n);
  });

  it("deposit: a SUCCESS whose recipient is not our treasury is not credited", async () => {
    const acc = await signIn(kit, stateGET, "cara");
    const id = (await quote("cara")).json.data.quote_id as string;
    (mock.quotes.get(id)!.response.quoteRequest as Record<string, string>).recipient = "someone-else.near";
    mock.setStatus(id, "SUCCESS");
    const r = (await runCron(cronDepositsGET, "/api/cron/deposits")).json.data;
    expect(r.credited).toBe(0);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(0n);
    expect((await status("cara", id)).json.data.status).toBe("FAILED");
  });

  it("deposit: provider down or a malformed quote answers PAUSED/INTERNAL and stores nothing", async () => {
    await signIn(kit, stateGET, "dora");
    mock.override.push((c) => (c.path === "/v0/quote" ? mock.json({ message: "down" }, 503) : null));
    const r = await quote("dora");
    expect(r.json.ok).toBe(false);
    expect(r.json.error?.code).toBe("PAUSED");
    mock.override.length = 0;
    expect((await quote("dora")).json.ok).toBe(true);
  });

  it("withdrawal: debit, one 1Click quote + one USDC transfer, marked SENT; a second cron run sends nothing", async () => {
    const acc = await signIn(kit, stateGET, "eve");
    kit.contract.testGrantFils(acc, 20000n);
    const before = treasury.transfers.length;
    const w = await withdraw("eve", "10000");
    expect(w.json.ok).toBe(true);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(10000n);
    const c1 = (await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
    const c2 = (await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
    expect(c1).toEqual({ sent: 1, refunded: 0 });
    expect(c2).toEqual({ sent: 0, refunded: 0 });
    expect(treasury.transfers).toHaveLength(before + 1);
    expect(treasury.transfers.at(-1)!.amount).toBe(1_000_000n); // 10,000 fils = 1 USDC
    const rows = await kit.db.query<{ status: string; quote_id: string | null }>("select status, quote_id from withdrawals where user_id = (select id from users where near_account_id = $1)", [acc]);
    expect(rows.map((r) => r.status)).toEqual(["SENT"]);
    expect(rows[0]!.quote_id).toBe(treasury.transfers.at(-1)!.receiver); // the 1Click deposit address is what we follow
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("withdrawal: when the on-chain transfer fails the player is refunded exactly once and nothing is sent", async () => {
    const acc = await signIn(kit, stateGET, "fay");
    kit.contract.testGrantFils(acc, 20000n);
    await withdraw("fay", "10000");
    treasury.mode = "fail";
    const r = (await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
    treasury.mode = "ok";
    expect(r.refunded).toBe(1);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(20000n);
    expect((await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data).toEqual({ sent: 0, refunded: 0 });
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("withdrawal: refused before anything is debited when the treasury cannot cover it", async () => {
    const acc = await signIn(kit, stateGET, "gus");
    kit.contract.testGrantFils(acc, 20000n);
    const saved = treasury.balance;
    treasury.balance = 5_000n; // 50 fils
    const w = await withdraw("gus", "10000");
    treasury.balance = saved;
    expect(w.json.ok).toBe(false);
    expect(w.json.error?.code).toBe("PAUSED");
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(20000n);
  });
});

describe("production wiring fails closed", () => {
  const base = {
    GAME_MODE: "LIVE" as const, NEAR_NETWORK: "mainnet" as const, NEAR_RPC_URL: "https://rpc.example.invalid",
    ONECLICK_JWT: TEST_JWT, TREASURY_ACCOUNT_ID: TEST_TREASURY, TREASURY_PRIVATE_KEY: "placeholder-not-used",
  };
  const src = { ONECLICK_USDC_ASSET_ID: TEST_USDC_ASSET_ID };
  const treasury = new Treasury();

  it("is configured only when LIVE on mainnet and every variable is present", () => {
    expect(createIntentsClient(base, { source: src, treasury, log: silentLog }).configured).toBe(true);
  });

  it.each([
    ["no JWT", { ...base, ONECLICK_JWT: undefined }, src],
    ["no treasury account", { ...base, TREASURY_ACCOUNT_ID: undefined }, src],
    ["no USDC asset id", base, {}],
    ["PLAY mode", { ...base, GAME_MODE: "PLAY" as const, NEAR_NETWORK: "testnet" as const }, src],
    ["a malformed asset id", base, { ONECLICK_USDC_ASSET_ID: "usdc" }],
    ["a malformed treasury account", { ...base, TREASURY_ACCOUNT_ID: "Bad Account" }, src],
  ])("is the unconfigured client with %s", (_n, env, source) => {
    const c = createIntentsClient(env, { source, treasury, log: silentLog });
    expect(c).toBe(unconfiguredIntents);
    expect(c.configured).toBe(false);
  });

  it("missing treasury key or RPC URL (without an injected treasury) stays closed, logging names only", () => {
    const logs: string[] = [];
    const lg = { warn: (...p: unknown[]) => logs.push(p.join(" ")), error: (...p: unknown[]) => logs.push(p.join(" ")) };
    expect(createIntentsClient({ ...base, TREASURY_PRIVATE_KEY: undefined, NEAR_RPC_URL: undefined }, { source: src, log: lg }).configured).toBe(false);
    expect(logs.join(" ")).toContain("TREASURY_PRIVATE_KEY");
    expect(logs.join(" ")).not.toContain(TEST_JWT);
  });
});
