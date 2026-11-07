// One group of tests per finding of the independent security review of Phase 3.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PARAMS, type ErrorCode } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as faucetPOST } from "../../app/api/faucet/route";
import { POST as tradePOST } from "../../app/api/trade/route";
import { POST as depositQuotePOST } from "../../app/api/deposit/quote/route";
import { POST as withdrawPOST } from "../../app/api/withdraw/route";
import { GET as leaderboardGET } from "../../app/api/leaderboard/route";
import { GET as cronDepositsGET } from "../../app/api/cron/deposits/route";
import { GET as cronWithdrawalsGET } from "../../app/api/cron/withdrawals/route";
import { parseOutcome } from "../contract/near";
import { ContractPanic, PUBLIC_MESSAGES, mapPanic } from "../errors";
import { decodeEncSecret, loadEnv } from "../env";
import { parsePauseFlag } from "../guards/mode";
import { trustedClientIp } from "../http";
import { log, type Logger } from "../log";
import { parseContractId } from "../game/money";
import { toApiEvents, PUBLIC_EVENT_FIELDS } from "../game/views";
import { unconfiguredIntents } from "../intents/unconfigured";
import { CRON_SECRET_FOR_TESTS, call, get, makeKit, post, signIn, type Kit } from "./testkit";

const TIMEOUT = 180_000;
const auth = { headers: { authorization: `Bearer ${CRON_SECRET_FOR_TESTS}` } };
const cron = (h: (r: Request) => Promise<Response>, path: string) => call(h, "GET", path, undefined, auth);

function expectErr(r: { json: { ok: boolean; error?: { code: string } } }, code: ErrorCode) {
  expect(r.json.ok).toBe(false);
  expect(r.json.error?.code).toBe(code);
}

const withdraw = (user: string, fils: string) =>
  post(withdrawPOST, "/api/withdraw", { fils, dest_asset: "nep141:usdc.fake", dest_address: "dest.fake" }, { user });
const quote = (user: string, amount_in: string) =>
  post(depositQuotePOST, "/api/deposit/quote", { origin_asset: "nep141:usdc.fake", amount_in, refund_address: "refund.fake" }, { user });
const userRow = async (kit: Kit, account: string) => (await kit.svc.repo.getUserByAccount(account))!;

describe("1 (HIGH) withdrawal ids come from the contract's receipt, never from null", () => {
  it("parseOutcome reads the return value of the contract's receipt when the top-level value is empty (NEP-366)", () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
    const res = {
      status: { SuccessValue: "" },
      transaction: { hash: "TXHASH" },
      receipts_outcome: [
        { outcome: { executor_id: "player.fake", logs: [], status: { SuccessValue: "" } } },
        { outcome: { executor_id: "caravan.fake", logs: ['EVENT_JSON:{"standard":"caravan","event":"withdraw_requested","data":[{"id":7,"ts":1800000000}]}'], status: { SuccessValue: b64(7) } } },
      ],
    };
    const out = parseOutcome(res, "caravan.fake", (() => { let n = 0; return () => ++n; })());
    expect(out.returnValue).toBe(7);
    expect(out.txHash).toBe("TXHASH");
    expect(out.events[0]).toMatchObject({ event: "withdraw_requested", data: { id: 7, tx_hash: "TXHASH" } });
    // a receipt of some other account is never mistaken for the contract's answer
    expect(parseOutcome({ ...res, receipts_outcome: [{ outcome: { executor_id: "other.fake", status: { SuccessValue: b64(99) } } }] }, "caravan.fake", () => 1).returnValue).toBeNull();
    expect(parseOutcome({ status: { SuccessValue: "" } }, "caravan.fake", () => 1).returnValue).toBeNull();
  });

  it("parseOutcome turns a failure inside a receipt into a panic", () => {
    const res = {
      status: { SuccessValue: "" },
      receipts_outcome: [{ outcome: { executor_id: "caravan.fake", status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: SLIPPAGE: price moved" } } } } } } }],
    };
    expect(() => parseOutcome(res, "caravan.fake", () => 1)).toThrow(ContractPanic);
    try { parseOutcome(res, "caravan.fake", () => 1); } catch (e) { expect(mapPanic((e as Error).message).code).toBe("SLIPPAGE"); }
  });

  it("parseContractId never turns null, empty or junk into 0", () => {
    for (const bad of [null, undefined, "", "abc", -1, 1.5, "1.5", "-3", {}, [], true, Number.NaN]) expect(parseContractId(bad)).toBeNull();
    expect(parseContractId(0)).toBe(0);
    expect(parseContractId("12")).toBe(12);
    expect(parseContractId(7)).toBe(7);
  });

  describe("route and cron", () => {
    let kit: Kit;
    beforeAll(async () => { kit = await makeKit({ mode: "LIVE" }); }, TIMEOUT);
    afterAll(async () => { await kit.close(); });

    it("a debit with no readable id stays RESERVED (never id 0) and the cron links it to the right chain row", async () => {
      const alice = await signIn(kit, stateGET, "alice");
      const bob = await signIn(kit, stateGET, "bob");
      kit.contract.testGrantFils(alice, 50000n);
      kit.contract.testGrantFils(bob, 50000n);
      // bob has a real withdrawal #1 on chain; it must not be touched by alice's row
      expect((await withdraw("bob", "7000")).json.ok).toBe(true);
      kit.contract.testNullReturns = true;
      const r = await withdraw("alice", "9000");
      kit.contract.testNullReturns = false;
      expectErr(r, "INTERNAL");
      const rows = await kit.db.query<{ status: string; contract_withdraw_id: number | null; fils: string }>("select status, contract_withdraw_id, fils from withdrawals order by id");
      expect(rows.map((x) => x.status)).toEqual(["REQUESTED", "RESERVED"]);
      expect(rows[1]!.contract_withdraw_id).toBeNull();
      expect(rows.some((x) => x.contract_withdraw_id === 0)).toBe(false);

      const c = (await cron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
      expect(c.sent).toBe(2);
      const after = await kit.db.query<{ status: string; contract_withdraw_id: number; fils: string }>("select status, contract_withdraw_id, fils from withdrawals order by id");
      expect(after.map((x) => [x.status, Number(x.contract_withdraw_id), String(x.fils)])).toEqual([
        ["SENT", 1, "7000"],
        ["SENT", 2, "9000"],
      ]);
      expect(kit.intents.withdrawals.map((w) => w.fils)).toEqual(["7000", "9000"]);
      expect((await kit.contract.getWithdraw(2))!.status).toBe("SENT");
    });

    it("the cron refuses to send a row that does not match the chain (amount or account)", async () => {
      const carol = await signIn(kit, stateGET, "carol");
      kit.contract.testGrantFils(carol, 50000n);
      await withdraw("carol", "5000");
      await kit.db.query("update withdrawals set fils = '90000' where contract_withdraw_id = 3");
      const sentBefore = kit.intents.withdrawals.length;
      await cron(cronWithdrawalsGET, "/api/cron/withdrawals");
      expect(kit.intents.withdrawals.length).toBe(sentBefore);
      expect((await kit.db.query<{ status: string }>("select status from withdrawals where contract_withdraw_id = 3"))[0]!.status).toBe("FAILED");
      expect((await kit.contract.getWithdraw(3))!.status).toBe("PENDING"); // nothing was marked or refunded
    });

    it("adopts an on-chain withdrawal that has no database row (alert), then sends it", async () => {
      const dave = await signIn(kit, stateGET, "dave");
      kit.contract.testGrantFils(dave, 20000n);
      await kit.svc.relayer.submit(await userRow(kit, dave), "request_withdraw", { fils: "4000", dest_asset: "nep141:usdc.fake", dest_address: "dest.fake" });
      const c = (await cron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
      expect(c.sent).toBe(1);
      expect(String((await kit.db.query<{ fils: string }>("select fils from withdrawals where user_id = $1", [(await userRow(kit, dave)).id]))[0]!.fils)).toBe("4000");
    });

    it("cancels a stale reservation that never reached the chain, releasing the cap", async () => {
      const erin = await signIn(kit, stateGET, "erin");
      const u = await userRow(kit, erin);
      await kit.svc.repo.reserveWithdrawal({ userId: u.id, fils: "100000", destAsset: "a", destAddress: "b", now: kit.clock.now }, 100000n);
      kit.contract.testGrantFils(erin, 100000n);
      expectErr(await withdraw("erin", "1000"), "BAD_REQUEST"); // an open reservation blocks a second withdrawal (and uses the cap)
      kit.clock.advance(901);
      expect((await cron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.ok).toBe(true);
      expect((await withdraw("erin", "1000")).json.ok).toBe(true);
    });
  });
});

describe("2 and 6: the withdraw cap is atomic and a reservation row exists before the chain call", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit({ mode: "LIVE" }); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  it("parallel requests with different Idempotency-Keys: exactly one reserves (one open withdrawal, cap 10 USDC/day)", async () => {
    const acc = await signIn(kit, stateGET, "alice");
    kit.contract.testGrantFils(acc, 500000n);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => withdraw("alice", "30000")));
    expect(results.filter((r) => r.json.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.json.ok).every((r) => r.json.error!.code === "BAD_REQUEST")).toBe(true);
    const total = (await kit.db.query<{ t: string }>("select sum(fils)::text as t from withdrawals where status <> 'CANCELLED'"))[0]!.t;
    expect(BigInt(total)).toBeLessThanOrEqual(BigInt(PARAMS.DAILY_WITHDRAW_CAP_FILS));
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(500000n - 30000n);
  });

  it("the daily cap counts finished (DONE) rows too: 3 x 30,000 fit in 100,000, the 4th does not", async () => {
    const acc = await signIn(kit, stateGET, "cap-racer");
    const u = (await kit.svc.repo.getUserByAccount(acc))!;
    const reserve = () => kit.svc.repo.reserveWithdrawal({ userId: u.id, fils: "30000", destAsset: "a", destAddress: "b", now: kit.clock.now }, 100000n);
    // The one-open rule would also stop a second row, so each one is finished before the next: only the cap can refuse.
    let granted = 0;
    for (let i = 0; i < 5; i++) {
      const r = await reserve();
      if (typeof r === "object") {
        granted++;
        await kit.db.query("update withdrawals set status = 'DONE' where id = $1", [r.id]);
      }
    }
    expect(granted).toBe(3);
  });

  it("a definite chain rejection releases the reservation", async () => {
    await signIn(kit, stateGET, "bea"); // balance 0
    expectErr(await withdraw("bea", "50000"), "INSUFFICIENT_FUNDS");
    const rows = await kit.db.query<{ status: string }>("select w.status from withdrawals w join users u on u.id = w.user_id where u.display_name = 'Bea'");
    expect(rows).toEqual([{ status: "CANCELLED" }]);
    const acc = (await get(stateGET, "/api/state", { user: "bea" })).json.data.me.account_id;
    kit.contract.testGrantFils(acc, 100000n);
    expect((await withdraw("bea", "100000")).json.ok).toBe(true); // the cancelled 50000 no longer counts
  });
});

describe("3: the deposit cap is atomic, counts every open quote and is re-checked at credit time", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit({ mode: "LIVE" }); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  it("parallel quotes cannot exceed 20 USDC", async () => {
    await signIn(kit, stateGET, "alice");
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => quote("alice", "60000")));
    expect(results.filter((r) => r.json.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.json.ok).every((r) => r.json.error!.code === "BAD_REQUEST")).toBe(true);
  });

  it("a PENDING quote past its deadline still counts until it expires", async () => {
    await signIn(kit, stateGET, "bob");
    expect((await quote("bob", "150000")).json.ok).toBe(true);
    kit.clock.advance(601); // past the 600 s deadline, inside the grace period
    expectErr(await quote("bob", "60000"), "BAD_REQUEST");
    kit.clock.advance(3600);
    await cron(cronDepositsGET, "/api/cron/deposits"); // expires it
    expect((await quote("bob", "60000")).json.ok).toBe(true);
  });

  it("the cron re-checks the cap before crediting", async () => {
    const acc = await signIn(kit, stateGET, "carol");
    const u = await userRow(kit, acc);
    const q1 = (await quote("carol", "150000")).json.data;
    kit.intents.setState(q1.quote_id, "SUCCESS");
    await cron(cronDepositsGET, "/api/cron/deposits");
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(150000n);
    // a second row that slipped past quote time (e.g. inserted by an older server version)
    await kit.db.query(
      `insert into deposits (user_id, quote_id, deposit_address, origin_asset, amount_in, expected_fils, status, deadline, created_at, updated_at)
       values ($1, 'late-q', 'x', 'nep141:usdc.fake', '100000', 100000, 'PENDING', $2, 1, 1)`,
      [u.id, kit.clock.now + 600],
    );
    kit.intents.quotes.set("late-q", { quoteId: "late-q", depositAddress: "x", amountIn: "100000", expectedFils: "100000", deadline: kit.clock.now + 600, state: "SUCCESS", receivedFils: "100000", asset: "nep141:usdc.fake" });
    const r = (await cron(cronDepositsGET, "/api/cron/deposits")).json.data;
    expect(r.failed).toBe(1);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(150000n);
  });
});

describe("4 and 5: provisioning obeys PAUSE_ALL, a global cap and a back-off; per-user relayer budget", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit(); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  it("PAUSE_ALL: GET /api/state serves the world but creates no account", async () => {
    await kit.svc.repo.setFlag("PAUSE_ALL", "true");
    const r = await get(stateGET, "/api/state", { user: "newbie" });
    expect(r.json.ok).toBe(true);
    expect(r.json.data.me).toBeNull();
    expect(r.json.data.world.merchants).toHaveLength(4);
    expect((await kit.db.query("select 1 from users where near_account_id is not null"))).toHaveLength(0);
    expect(kit.contract.calls).toHaveLength(0);
    await kit.svc.repo.setFlag("PAUSE_ALL", "false");
  });

  it("a global daily cap on account creation (existing users are unaffected)", async () => {
    const existing = await signIn(kit, stateGET, "early");
    const day = 86400;
    await kit.db.query("insert into rate_limits (key, window_start, count) values ('accounts:day', $1, 500) on conflict (key, window_start) do update set count = 500", [Math.floor(kit.clock.now / day) * day]);
    const r = await get(stateGET, "/api/state", { user: "late" });
    expect(r.json.data.me).toBeNull();
    expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "late" }), "RATE_LIMIT");
    expect((await get(stateGET, "/api/state", { user: "early" })).json.data.me.account_id).toBe(existing);
    await kit.db.query("delete from rate_limits where key = 'accounts:day'");
  });

  it("a user stuck in CREATED is retried at most a few times a minute, not on every poll", async () => {
    const orig = kit.contract.playerCall.bind(kit.contract);
    let registerCalls = 0;
    kit.contract.playerCall = (async (...a: Parameters<typeof orig>) => {
      if (a[1] === "register") {
        registerCalls++;
        throw new Error("rpc down");
      }
      return orig(...a);
    }) as typeof orig;
    for (let i = 0; i < 10; i++) await get(stateGET, "/api/state", { user: "stuck" }); // ten 3-second polls
    expect(registerCalls).toBeLessThanOrEqual(3);
    expect(registerCalls).toBeGreaterThan(0);
    kit.clock.advance(61); // next minute: allowed again
    kit.contract.playerCall = orig;
    expect((await get(stateGET, "/api/state", { user: "stuck" })).json.data.me).not.toBeNull();
  });

  it("5: one user cannot use more than their share of the relayer budget, and the global budget is not burned for them", async () => {
    const acc = await signIn(kit, stateGET, "heavy");
    const u = await userRow(kit, acc);
    const day = 86400;
    const ws = Math.floor(kit.clock.now / day) * day;
    await kit.db.query("insert into rate_limits (key, window_start, count) values ($1, $2, 200) on conflict (key, window_start) do update set count = 200", [`relayer:user:${u.id}:day`, ws]);
    const before = Number((await kit.db.query<{ count: number }>("select count from rate_limits where key = 'relayer:day' and window_start = $1", [ws]))[0]?.count ?? 0);
    expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "heavy" }), "RATE_LIMIT");
    const after = Number((await kit.db.query<{ count: number }>("select count from rate_limits where key = 'relayer:day' and window_start = $1", [ws]))[0]?.count ?? 0);
    expect(after).toBe(before);
    // another user is unaffected
    await signIn(kit, stateGET, "light");
    expect((await post(faucetPOST, "/api/faucet", {}, { user: "light" })).json.ok).toBe(true);
  });
});

describe("7: money routes fail closed before touching the chain", () => {
  it("LIVE with Intents not configured: no debit, PAUSED", async () => {
    const kit = await makeKit({ mode: "LIVE" });
    try {
      const acc = await signIn(kit, stateGET, "alice");
      kit.contract.testGrantFils(acc, 10000n);
      kit.svc.intents = unconfiguredIntents;
      expectErr(await withdraw("alice", "1000"), "PAUSED");
      expectErr(await quote("alice", "1000"), "PAUSED");
      expect(kit.contract.calls.filter((c) => c.method === "request_withdraw")).toHaveLength(0);
      expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(10000n);
      expect(await kit.db.query("select 1 from withdrawals")).toHaveLength(0);
    } finally { await kit.close(); }
  }, TIMEOUT);

  it("treasury below the amount (plus what is already owed): no debit", async () => {
    const kit = await makeKit({ mode: "LIVE" });
    try {
      const acc = await signIn(kit, stateGET, "alice");
      kit.contract.testGrantFils(acc, 50000n);
      kit.intents.treasuryFils = 5000n;
      expect((await withdraw("alice", "3000")).json.ok).toBe(true);
      expectErr(await withdraw("alice", "3000"), "PAUSED"); // 3000 already owed + 3000 > 5000
      expect(kit.contract.calls.filter((c) => c.method === "request_withdraw")).toHaveLength(1);
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("10: transient contract errors are retried, permanent ones go to the failed queue", () => {
  it("RATE_LIMIT / INTERNAL retry; BAD_REQUEST fails for good", async () => {
    const kit = await makeKit({ mode: "LIVE" });
    try {
      await signIn(kit, stateGET, "alice");
      const q1 = (await quote("alice", "1000")).json.data;
      const q2 = (await quote("alice", "2000")).json.data;
      kit.intents.setState(q1.quote_id, "SUCCESS");
      kit.intents.setState(q2.quote_id, "SUCCESS");
      const orig = kit.contract.operatorCall.bind(kit.contract);
      let mode: "transient" | "permanent" | "ok" = "transient";
      kit.contract.operatorCall = (async (...a: Parameters<typeof orig>) => {
        if (mode === "transient") throw new ContractPanic("RATE_LIMIT: slow down");
        if (mode === "permanent") throw new ContractPanic("BAD_REQUEST: deposit cap reached");
        return orig(...a);
      }) as typeof orig;
      let r = (await cron(cronDepositsGET, "/api/cron/deposits")).json.data;
      expect(r).toEqual({ credited: 0, expired: 0, failed: 0 });
      expect((await kit.db.query<{ status: string }>("select status from deposits order by id")).map((x) => x.status)).toEqual(["CREDITING", "CREDITING"]);
      mode = "ok";
      r = (await cron(cronDepositsGET, "/api/cron/deposits")).json.data;
      expect(r.credited).toBe(2);
      mode = "permanent";
      const q3 = (await quote("alice", "500")).json.data;
      kit.intents.setState(q3.quote_id, "SUCCESS");
      r = (await cron(cronDepositsGET, "/api/cron/deposits")).json.data;
      expect(r.failed).toBe(1);
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("11: PAUSE_ALL fails closed", () => {
  it("parses case-insensitively; missing or unknown means paused in LIVE only", () => {
    for (const v of ["true", "TRUE", " True ", "1", "yes", "on"]) expect(parsePauseFlag(v, "PLAY")).toBe(true);
    for (const v of ["false", "FALSE", "0", "no", "off"]) expect(parsePauseFlag(v, "LIVE")).toBe(false);
    expect(parsePauseFlag(null, "LIVE")).toBe(true);
    expect(parsePauseFlag("maybe", "LIVE")).toBe(true);
    expect(parsePauseFlag(null, "PLAY")).toBe(false);
  });

  it("routes honour it: 'TRUE ' pauses, a deleted row pauses LIVE but not PLAY", async () => {
    // one kit at a time: the service container is process-global
    const play = await makeKit({ mode: "PLAY" });
    try {
      await signIn(play, stateGET, "alice");
      await play.db.query("delete from flags where key = 'PAUSE_ALL'");
      expect((await post(faucetPOST, "/api/faucet", {}, { user: "alice" })).json.ok).toBe(true);
      await play.svc.repo.setFlag("PAUSE_ALL", "TRUE ");
      expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "alice" }), "PAUSED");
    } finally { await play.close(); }
    const live = await makeKit({ mode: "LIVE" });
    try {
      await signIn(live, stateGET, "bob");
      await live.db.query("delete from flags where key = 'PAUSE_ALL'");
      expectErr(await withdraw("bob", "1"), "PAUSED");
      await live.svc.repo.setFlag("PAUSE_ALL", "garbage");
      expectErr(await withdraw("bob", "1"), "PAUSED");
    } finally { await live.close(); }
  }, TIMEOUT);
});

describe("12 and 13: strict secret and consistent mode", () => {
  const base = (): Record<string, string> => ({
    GAME_MODE: "PLAY", NEAR_NETWORK: "testnet", CARAVAN_CONTRACT_ID: "c.fake", RELAYER_ACCOUNT_ID: "r.fake",
    RELAYER_PRIVATE_KEY: "x", OPERATOR_ACCOUNT_ID: "o.fake", OPERATOR_PRIVATE_KEY: "y",
    KEY_ENC_SECRET: randomBytes(32).toString("hex"), DATABASE_URL: "postgres://fake", AUTH_SECRET: "a", CRON_SECRET: "c",
  });

  it("rejects passphrases and non-canonical base64 as KEY_ENC_SECRET", () => {
    for (const bad of ["correct horse battery staple correct horse", "a".repeat(43) + "=", "!".repeat(44), randomBytes(32).toString("base64").replace(/=$/, ""), randomBytes(32).toString("hex") + "ab", ""]) {
      expect(() => decodeEncSecret(bad)).toThrow();
    }
    const raw = randomBytes(32);
    expect(decodeEncSecret(raw.toString("base64"))).toEqual(new Uint8Array(raw));
    expect(decodeEncSecret(raw.toString("hex"))).toEqual(new Uint8Array(raw));
  });

  it("GAME_MODE must match NEAR_NETWORK; mainnet needs NEAR_RPC_URL", () => {
    expect(() => loadEnv(base())).not.toThrow();
    expect(() => loadEnv({ ...base(), GAME_MODE: "LIVE" })).toThrow(/GAME_MODE/);
    expect(() => loadEnv({ ...base(), NEAR_NETWORK: "mainnet" })).toThrow(/GAME_MODE/);
    expect(() => loadEnv({ ...base(), GAME_MODE: "LIVE", NEAR_NETWORK: "mainnet" })).toThrow(/NEAR_RPC_URL/);
    expect(() => loadEnv({ ...base(), GAME_MODE: "LIVE", NEAR_NETWORK: "mainnet", NEAR_RPC_URL: "https://rpc.example.org", ONECLICK_JWT: "j", ONECLICK_USDC_ASSET_ID: "nep141:usdc.fake" })).not.toThrow();
  });

  it("mode-specific routes are refused when the contract runs in another mode", async () => {
    const kit = await makeKit({ mode: "LIVE", contract: { mode: "PLAY" } });
    try {
      const acc = await signIn(kit, stateGET, "alice");
      kit.contract.testGrantFils(acc, 5000n);
      expectErr(await withdraw("alice", "100"), "MODE_NOT_ALLOWED");
      expectErr(await quote("alice", "100"), "MODE_NOT_ALLOWED");
      expect((await cron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data).toEqual({ sent: 0, refunded: 0 });
      expect(kit.contract.calls.filter((c) => c.method === "request_withdraw")).toHaveLength(0);
    } finally { await kit.close(); }
    const play = await makeKit({ mode: "PLAY", contract: { mode: "LIVE" } });
    try {
      await signIn(play, stateGET, "alice");
      expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "alice" }), "MODE_NOT_ALLOWED");
    } finally { await play.close(); }
  }, TIMEOUT);
});

describe("14: unauthenticated rate limits use a trusted client address", () => {
  it("ignores a spoofed left-most X-Forwarded-For; prefers the platform header", () => {
    const r = (h: Record<string, string>) => new Request("http://x/api/leaderboard", { headers: h });
    expect(trustedClientIp(r({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(trustedClientIp(r({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(trustedClientIp(r({ "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "6.6.6.6" }))).toBe("198.51.100.4");
    expect(trustedClientIp(r({}))).toBe("unknown");
  });

  it("rotating the spoofed hop does not reset the limit; one global bucket bounds anonymous reads", async () => {
    const kit = await makeKit();
    try {
      let limited = 0;
      for (let i = 0; i < 185; i++) {
        const res = await get(leaderboardGET, "/api/leaderboard", { headers: { "x-forwarded-for": `10.0.${i % 250}.${i % 200}, 203.0.113.50` } });
        if (!res.json.ok && res.json.error!.code === "RATE_LIMIT") limited++;
      }
      expect(limited).toBe(5); // 180 allowed per minute for one real address
      const day = 60;
      await kit.db.query("insert into rate_limits (key, window_start, count) values ('anon:reads', $1, 6000) on conflict (key, window_start) do update set count = 6000", [Math.floor(kit.clock.now / day) * day]);
      expectErr(await get(leaderboardGET, "/api/leaderboard", { headers: { "x-forwarded-for": "198.51.100.77" } }), "RATE_LIMIT");
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("15: public events carry only whitelisted fields", () => {
  it("drops account ids, sellers, buyers, references and destinations", async () => {
    const kit = await makeKit({ mode: "PLAY" });
    try {
      const a = await signIn(kit, stateGET, "alice");
      await post(faucetPOST, "/api/faucet", {}, { user: "alice" });
      await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty: 3, limit_total: "99999" }, { user: "alice" });
      kit.clock.advance(2);
      const s = await get(stateGET, "/api/state");
      const events = s.json.data.events as Array<{ type: keyof typeof PUBLIC_EVENT_FIELDS; data: Record<string, unknown> }>;
      expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["faucet", "trade"]));
      for (const e of events) {
        for (const k of Object.keys(e.data)) expect([...PUBLIC_EVENT_FIELDS[e.type], "tx_hash"]).toContain(k);
      }
      expect(JSON.stringify(events)).not.toContain(a);
      expect(events.find((e) => e.type === "trade")!.data).toMatchObject({ merchant: "bandar", good: "grain", side: "buy", qty: 3 });
    } finally { await kit.close(); }
    const mapped = toApiEvents([
      { id: 1, event: "withdraw_requested", at_ns: "1000000000", data: { id: 3, account_id: "p1.root", fils: "5", dest_address: "bc1secret", tx_hash: "T" } },
      { id: 2, event: "stall_buy", at_ns: "1000000000", data: { stall_id: 4, buyer: "p2.root", qty: 1, total: "1", fee: "0" } },
    ]);
    expect(mapped[0]!.data).toEqual({ tx_hash: "T" });
    expect(mapped[1]!.data).toEqual({ stall_id: 4, qty: 1, total: "1", fee: "0" });
  }, TIMEOUT);
});

describe("16: raw panic text never reaches a client", () => {
  it("alias matches return the fixed message and keep the raw text for the log only", async () => {
    const m = mapPanic("Smart contract panicked: warehouse full: stock 0xdeadbeef of p1a2b3c4d.relayer.testnet");
    expect(m.code).toBe("BAD_REQUEST");
    expect(m.message).toBe(PUBLIC_MESSAGES.BAD_REQUEST);
    expect(m.raw).toContain("0xdeadbeef");
    const kit = await makeKit();
    try {
      await signIn(kit, stateGET, "alice");
      kit.contract.playerCall = (async () => { throw new ContractPanic("cooldown 0xdeadbeef for p1a2b3c4d.relayer.testnet"); }) as typeof kit.contract.playerCall;
      const r = await post(faucetPOST, "/api/faucet", {}, { user: "alice" });
      expectErr(r, "RATE_LIMIT");
      expect(JSON.stringify(r.json)).not.toMatch(/deadbeef|p1a2b3c4d/);
      expect(r.json.error!.message).toBe(PUBLIC_MESSAGES.RATE_LIMIT);
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("17: errors go through the redacting logger", () => {
  it("log.error redacts keys, tokens, e-mails and account ids in errors", () => {
    const lines: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    try {
      log.error("failed", new Error(`boom me@example.org Bearer abc.def ed25519:${"B".repeat(44)} p1a2b3c4d.relayer.testnet`));
    } finally { console.error = orig; }
    expect(lines.join("\n")).not.toMatch(/example\.org|abc\.def|BBBBBBBB|p1a2b3c4d/);
  });

  it("an unhandled route error is logged through svc.log and the client sees a generic message", async () => {
    const kit = await makeKit();
    try {
      const captured: unknown[][] = [];
      const lg: Logger = { warn: () => undefined, error: (...p) => { captured.push(p); } };
      kit.svc.log = lg;
      kit.svc.session = async () => { throw new Error("db password hunter2 at me@example.org"); };
      const r = await get(stateGET, "/api/state", { user: "x" });
      expectErr(r, "INTERNAL");
      expect(JSON.stringify(r.json)).not.toMatch(/hunter2|example\.org/);
      expect(captured.length).toBeGreaterThan(0); // routed through the logger (which redacts), not console
    } finally { await kit.close(); }
  }, TIMEOUT);
});
