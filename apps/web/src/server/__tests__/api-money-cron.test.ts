import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PARAMS, type ErrorCode } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as faucetPOST } from "../../app/api/faucet/route";
import { POST as depositQuotePOST } from "../../app/api/deposit/quote/route";
import { GET as depositStatusGET } from "../../app/api/deposit/status/route";
import { POST as withdrawPOST } from "../../app/api/withdraw/route";
import { GET as cronTickGET, POST as cronTickPOST } from "../../app/api/cron/tick/route";
import { GET as cronHealthGET } from "../../app/api/cron/health/route";
import { GET as cronDepositsGET } from "../../app/api/cron/deposits/route";
import { GET as cronWithdrawalsGET } from "../../app/api/cron/withdrawals/route";
import { CRON_SECRET_FOR_TESTS, call, get, makeKit, post, signIn, type Kit } from "./testkit";

const TIMEOUT = 120_000;

function expectErr(r: { json: { ok: boolean; error?: { code: string } } }, code: ErrorCode) {
  expect(r.json.ok).toBe(false);
  expect(r.json.error?.code).toBe(code);
}

const auth = { headers: { authorization: `Bearer ${CRON_SECRET_FOR_TESTS}` } };
const runCron = (h: (r: Request) => Promise<Response>, path: string) => call(h, "GET", path, undefined, auth);

describe("PLAY mode closes every money route", () => {
  it("deposit quote, deposit status and withdraw are MODE_NOT_ALLOWED", async () => {
    const kit = await makeKit({ mode: "PLAY" });
    try {
      await signIn(kit, stateGET, "alice");
      const o = { user: "alice" };
      expectErr(await post(depositQuotePOST, "/api/deposit/quote", { origin_asset: "usdc", amount_in: "100", refund_address: "x" }, o), "MODE_NOT_ALLOWED");
      expectErr(await get(depositStatusGET, "/api/deposit/status", { ...o, query: "?quote_id=q" }), "MODE_NOT_ALLOWED");
      expectErr(await post(withdrawPOST, "/api/withdraw", { fils: "100", dest_asset: "usdc", dest_address: "x" }, o), "MODE_NOT_ALLOWED");
      expect(kit.intents.quotes.size).toBe(0);
      expect(kit.contract.calls.filter((c) => c.method === "request_withdraw")).toHaveLength(0);
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("LIVE deposits", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit({ mode: "LIVE" }); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });
  const quote = (user: string, amount_in: string) =>
    post(depositQuotePOST, "/api/deposit/quote", { origin_asset: "nep141:usdc.fake", amount_in, refund_address: "refund.fake" }, { user });

  it("quote -> status PENDING -> cron credits once -> CREDITED with fils_credited", async () => {
    const acc = await signIn(kit, stateGET, "alice");
    const q = await quote("alice", "50000");
    expect(q.json.ok).toBe(true);
    expect(q.json.data).toMatchObject({ amount_in: "50000", expected_fils: "50000" });
    const id = q.json.data.quote_id as string;
    expect((await get(depositStatusGET, "/api/deposit/status", { user: "alice", query: `?quote_id=${id}` })).json.data).toEqual({ status: "PENDING" });

    expect(await runCron(cronDepositsGET, "/api/cron/deposits").then((r) => r.json.data)).toEqual({ credited: 0, expired: 0, failed: 0 });
    kit.intents.setState(id, "SUCCESS");
    expect((await runCron(cronDepositsGET, "/api/cron/deposits")).json.data.credited).toBe(1);
    expect((await runCron(cronDepositsGET, "/api/cron/deposits")).json.data.credited).toBe(0);
    expect((await get(depositStatusGET, "/api/deposit/status", { user: "alice", query: `?quote_id=${id}` })).json.data).toEqual({ status: "CREDITED", fils_credited: "50000" });
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(50000n);
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("a duplicate credit reference is ignored by the contract (no double credit on a retried CREDITING row)", async () => {
    const acc = await signIn(kit, stateGET, "bob");
    const q = (await quote("bob", "1000")).json.data;
    kit.intents.setState(q.quote_id, "SUCCESS");
    // Simulate a crash after the contract credited but before the DB was updated.
    const user = (await kit.svc.repo.getUserByAccount(acc))!;
    await kit.contract.operatorCall("credit_deposit", { account_id: acc, fils: "1000", reference: q.quote_id });
    const dep = (await kit.svc.repo.getDepositByQuote(user.id, q.quote_id))!;
    await kit.svc.repo.transitionDeposit(dep.id, "PENDING", "CREDITING", kit.clock.now);
    await runCron(cronDepositsGET, "/api/cron/deposits");
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(1000n);
    expect((await kit.svc.repo.getDepositByQuote(user.id, q.quote_id))!.status).toBe("CREDITED");
  });

  it("enforces the 20 USDC total cap across credited and open quotes (BAD_REQUEST)", async () => {
    await signIn(kit, stateGET, "carol");
    expect((await quote("carol", "150000")).json.ok).toBe(true);
    expectErr(await quote("carol", "60000"), "BAD_REQUEST");
    expect((await quote("carol", "50000")).json.ok).toBe(true); // exactly at the cap
    expectErr(await quote("carol", "1"), "BAD_REQUEST");
    expectErr(await quote("carol", "999999999999"), "BAD_REQUEST");
  });

  it("expires unpaid quotes after the deadline plus grace; provider FAILED/REFUNDED closes them", async () => {
    await signIn(kit, stateGET, "dan");
    const a = (await quote("dan", "100")).json.data;
    const b = (await quote("dan", "100")).json.data;
    kit.intents.setState(b.quote_id, "REFUNDED");
    kit.clock.advance(600 + 3600 + 5);
    const r = (await runCron(cronDepositsGET, "/api/cron/deposits")).json.data;
    expect(r.expired).toBeGreaterThanOrEqual(1); // other users' open quotes from earlier tests expire too
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect((await get(depositStatusGET, "/api/deposit/status", { user: "dan", query: `?quote_id=${a.quote_id}` })).json.data.status).toBe("EXPIRED");
    expect((await get(depositStatusGET, "/api/deposit/status", { user: "dan", query: `?quote_id=${b.quote_id}` })).json.data.status).toBe("FAILED");
  });

  it("does not trust a provider that reports less than quoted, or a malformed quote", async () => {
    await signIn(kit, stateGET, "eve");
    const q = (await quote("eve", "5000")).json.data;
    kit.intents.setState(q.quote_id, "SUCCESS", "10");
    const r = (await runCron(cronDepositsGET, "/api/cron/deposits")).json.data;
    expect(r.failed).toBe(1);
    expect(r.credited).toBe(0);

    const orig = kit.intents.quote.bind(kit.intents);
    kit.intents.quote = async (req) => ({ ...(await orig(req)), deadline: kit.clock.now - 1 });
    expectErr(await quote("eve", "100"), "INTERNAL");
    kit.intents.quote = async (req) => ({ ...(await orig(req)), amountIn: "1" });
    expectErr(await quote("eve", "100"), "INTERNAL");
    kit.intents.quote = orig;
  });

  it("deposit status is private to the owner and needs a known quote", async () => {
    await signIn(kit, stateGET, "fay");
    await signIn(kit, stateGET, "gus");
    const q = (await quote("fay", "100")).json.data;
    expectErr(await get(depositStatusGET, "/api/deposit/status", { user: "gus", query: `?quote_id=${q.quote_id}` }), "BAD_REQUEST");
    expectErr(await get(depositStatusGET, "/api/deposit/status", { user: "fay" }), "BAD_REQUEST");
    expectErr(await get(depositStatusGET, "/api/deposit/status", { query: `?quote_id=${q.quote_id}` }), "UNAUTHENTICATED");
  });

  it("PAUSE_ALL closes deposit quotes and the deposit cron", async () => {
    await signIn(kit, stateGET, "hal");
    await kit.svc.repo.setFlag("PAUSE_ALL", "true");
    expectErr(await quote("hal", "100"), "PAUSED");
    expect((await runCron(cronDepositsGET, "/api/cron/deposits")).json.data).toEqual({ credited: 0, expired: 0, failed: 0 });
    await kit.svc.repo.setFlag("PAUSE_ALL", "false");
  });
});

describe("LIVE withdrawals", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit({ mode: "LIVE" }); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });
  const withdraw = (user: string, fils: string) =>
    post(withdrawPOST, "/api/withdraw", { fils, dest_asset: "nep141:usdc.fake", dest_address: "dest.fake" }, { user });

  it("debits at once, sends through Intents once, then marks the withdrawal", async () => {
    const acc = await signIn(kit, stateGET, "alice");
    kit.contract.testGrantFils(acc, 90000n);
    const r = await withdraw("alice", "40000");
    expect(r.json.ok).toBe(true);
    expect(r.json.data.status).toBe("REQUESTED");
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(50000n);

    const c1 = (await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
    const c2 = (await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
    expect(c1).toEqual({ sent: 1, refunded: 0 });
    expect(c2).toEqual({ sent: 0, refunded: 0 });
    expect(kit.intents.withdrawals).toHaveLength(1);
    expect((await kit.contract.getWithdraw(1))!.status).toBe("DONE");
    const rows = await kit.db.query<{ status: string }>("select status from withdrawals");
    expect(rows).toEqual([{ status: "SENT" }]);
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("daily cap of 10 USDC: server pre-check and contract both refuse (BAD_REQUEST)", async () => {
    // alice already withdrew 40000 today; 60000 more fits exactly, 1 more does not
    kit.contract.testGrantFils(await signIn(kit, stateGET, "alice"), 100000n);
    expect((await withdraw("alice", "60000")).json.ok).toBe(true);
    kit.contract.testGrantFils((await signIn(kit, stateGET, "alice")), 10n);
    expectErr(await withdraw("alice", "1"), "BAD_REQUEST");
    expect(PARAMS.DAILY_WITHDRAW_CAP_FILS).toBe(100000);
    // the contract's own cap also holds when the server check is bypassed
    const acc = await signIn(kit, stateGET, "bea");
    kit.contract.testGrantFils(acc, 200000n);
    await withdraw("bea", "100000");
    await kit.db.query("delete from withdrawals");
    expectErr(await withdraw("bea", "1"), "BAD_REQUEST");
    await runCron(cronWithdrawalsGET, "/api/cron/withdrawals"); // flush alice's second withdrawal
  });

  it("INSUFFICIENT_FUNDS for more than the balance", async () => {
    await signIn(kit, stateGET, "cat");
    expectErr(await withdraw("cat", "500"), "INSUFFICIENT_FUNDS");
  });

  it("refunds exactly once when Intents definitely fails", async () => {
    const acc = await signIn(kit, stateGET, "dee");
    kit.contract.testGrantFils(acc, 5000n);
    await withdraw("dee", "3000");
    kit.intents.withdrawResult = { ok: false, reason: "rejected" };
    const r = (await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data;
    expect(r.refunded).toBe(1);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(5000n);
    await expect(kit.contract.operatorCall("refund_withdraw", { id: 4 })).rejects.toThrow(/BAD_REQUEST/); // second refund impossible
    kit.intents.withdrawResult = null;
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("an unknown send outcome stays in SENDING and is never retried blindly", async () => {
    const acc = await signIn(kit, stateGET, "eli");
    kit.contract.testGrantFils(acc, 5000n);
    await withdraw("eli", "2000");
    const orig = kit.intents.withdraw.bind(kit.intents);
    kit.intents.withdraw = async () => { throw new Error("timeout"); };
    await runCron(cronWithdrawalsGET, "/api/cron/withdrawals");
    kit.intents.withdraw = orig;
    const before = kit.intents.withdrawals.length;
    await runCron(cronWithdrawalsGET, "/api/cron/withdrawals");
    expect(kit.intents.withdrawals.length).toBe(before);
    expect((await kit.db.query<{ status: string }>("select status from withdrawals order by id desc limit 1"))[0]!.status).toBe("SENDING");
    kit.clock.advance(700);
    const health = (await runCron(cronHealthGET, "/api/cron/health")).json.data;
    expect(health.stuck_withdrawals).toBe(1);
    expect(health.ok).toBe(false);
  });

  it("PAUSED when PAUSE_ALL is set", async () => {
    await signIn(kit, stateGET, "fox");
    await kit.svc.repo.setFlag("PAUSE_ALL", "true");
    expectErr(await withdraw("fox", "1"), "PAUSED");
    await kit.svc.repo.setFlag("PAUSE_ALL", "false");
  });
});

describe("cron routes", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit({ mode: "PLAY" }); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  const routes: Array<[string, (r: Request) => Promise<Response>]> = [
    ["/api/cron/tick", cronTickGET], ["/api/cron/health", cronHealthGET],
    ["/api/cron/deposits", cronDepositsGET], ["/api/cron/withdrawals", cronWithdrawalsGET],
  ];

  it("reject a missing or wrong bearer with 401 and do no work", async () => {
    for (const [path, h] of routes) {
      const none = await call(h, "GET", path);
      expect(none.status).toBe(401);
      expectErr(none, "UNAUTHENTICATED");
      const wrong = await call(h, "GET", path, undefined, { headers: { authorization: "Bearer wrong-secret" } });
      expect(wrong.status).toBe(401);
      const query = await call(h, "GET", path, undefined, { query: `?secret=${CRON_SECRET_FOR_TESTS}` });
      expect(query.status).toBe(401);
    }
    const postNone = await call(cronTickPOST, "POST", "/api/cron/tick", {}, { key: null });
    expect(postNone.status).toBe(401);
    expect(kit.contract.calls.filter((c) => c.kind === "tick")).toHaveLength(0);
  });

  it("tick: calls world_tick when the worker heartbeat is missing or stale, not when it is fresh", async () => {
    kit.clock.advance(61);
    const a = (await runCron(cronTickGET, "/api/cron/tick")).json.data;
    expect(a).toMatchObject({ called: true, reason: "no heartbeat", ticks: 1 });
    expect(kit.contract.tick).toBe(1);

    await kit.svc.repo.setHeartbeat("worker-1", kit.clock.now);
    kit.clock.advance(61);
    const b = (await runCron(cronTickGET, "/api/cron/tick")).json.data;
    expect(b).toEqual({ called: false, reason: "worker alive" });
    expect(kit.contract.tick).toBe(1);

    kit.clock.advance(200);
    const c = (await call(cronTickPOST, "POST", "/api/cron/tick", undefined, { ...auth, key: null })).json.data;
    expect(c).toMatchObject({ called: true, reason: "heartbeat stale" });
    expect(kit.contract.tick).toBeGreaterThan(1);
  });

  it("tick: a call inside 55 s of the last tick is a no-op, missed ticks are capped at 10", async () => {
    const t0 = kit.contract.tick;
    kit.clock.advance(10);
    await runCron(cronTickGET, "/api/cron/tick");
    expect(kit.contract.tick).toBe(t0);
    kit.clock.advance(60 * 25);
    await runCron(cronTickGET, "/api/cron/tick");
    expect(kit.contract.tick).toBe(t0 + 10);
  });

  it("tick: does nothing while PAUSE_ALL is set", async () => {
    await kit.svc.repo.setFlag("PAUSE_ALL", "true");
    kit.clock.advance(300);
    const r = (await runCron(cronTickGET, "/api/cron/tick")).json.data;
    expect(r).toEqual({ called: false, reason: "paused" });
    await kit.svc.repo.setFlag("PAUSE_ALL", "false");
  });

  it("health: reports booleans, flags a low relayer balance, never prints balances or keys", async () => {
    await kit.svc.repo.setHeartbeat("worker-1", kit.clock.now);
    let h = (await runCron(cronHealthGET, "/api/cron/health")).json.data;
    expect(h).toMatchObject({ ok: true, relayer_low: false, worker_stale: false, mode: "PLAY", mode_mismatch: false });
    kit.contract.testSetBalance("relayer.fake", 1000n);
    h = (await runCron(cronHealthGET, "/api/cron/health")).json.data;
    expect(h.relayer_low).toBe(true);
    expect(h.ok).toBe(false);
    expect(JSON.stringify(h)).not.toMatch(/1000|ed25519|fake/);
    kit.contract.testSetBalance("relayer.fake", 10n ** 25n);
  });

  it("deposit and withdrawal crons are no-ops in PLAY", async () => {
    expect((await runCron(cronDepositsGET, "/api/cron/deposits")).json.data).toEqual({ credited: 0, expired: 0, failed: 0 });
    expect((await runCron(cronWithdrawalsGET, "/api/cron/withdrawals")).json.data).toEqual({ sent: 0, refunded: 0 });
  });
});

describe("security: no key material in responses, database responses or logs", () => {
  it("scans every response and stored action for key-like strings", async () => {
    const kit = await makeKit();
    const bodies: string[] = [];
    try {
      const acc = await signIn(kit, stateGET, "alice");
      for (const r of [
        await get(stateGET, "/api/state", { user: "alice" }),
        await post(faucetPOST, "/api/faucet", {}, { user: "alice" }),
        await post(faucetPOST, "/api/faucet", {}, { user: "alice" }),
        await get(stateGET, "/api/state"),
      ]) bodies.push(JSON.stringify(r.json));
      const stored = await kit.db.query<{ response_json: string; request_json: string }>("select response_json, request_json from actions");
      for (const s of stored) bodies.push(s.response_json ?? "", s.request_json);
      const custody = (await kit.db.query<{ enc_private_key: string; nonce: string; public_key: string }>("select * from custody_keys"))[0]!;
      const all = bodies.join("\n");
      expect(all).not.toMatch(/ed25519:/);
      expect(all).not.toContain(custody.enc_private_key);
      expect(all).not.toContain(custody.nonce);
      expect(all).not.toContain(Buffer.from(kit.encSecret).toString("hex"));
      expect(all).not.toContain(Buffer.from(kit.encSecret).toString("base64"));
      expect(custody.enc_private_key).not.toMatch(/ed25519/);
      expect(acc).toBeTruthy();
    } finally { await kit.close(); }
  }, TIMEOUT);
});
