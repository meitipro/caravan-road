// F4: withdraw rules agree with the contract (contracts/caravan/src/game.rs try_request_withdraw, admin.rs try_refund_withdraw):
// UTC-day cap that refunds do not reduce, minimum 1000 fils, one open withdrawal.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorCode } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as withdrawPOST } from "../../app/api/withdraw/route";
import { GET as cronWithdrawalsGET } from "../../app/api/cron/withdrawals/route";
import { CRON_SECRET_FOR_TESTS, call, makeKit, post, signIn, type Kit } from "./testkit";

const TIMEOUT = 120_000;
const DAY = 86400;
const auth = { headers: { authorization: `Bearer ${CRON_SECRET_FOR_TESTS}` } };
const runCron = () => call(cronWithdrawalsGET, "GET", "/api/cron/withdrawals", undefined, auth);

function expectErr(r: { json: { ok: boolean; error?: { code: string; message: string } } }, code: ErrorCode, message?: RegExp) {
  expect(r.json.ok).toBe(false);
  expect(r.json.error?.code).toBe(code);
  if (message) expect(r.json.error?.message).toMatch(message);
}

let open: Kit | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (open) await open.close();
  open = null;
});
const live = async (): Promise<Kit> => (open = await makeKit({ mode: "LIVE" }));

const withdraw = (user: string, fils: string) =>
  post(withdrawPOST, "/api/withdraw", { fils, dest_asset: "nep141:usdc.fake", dest_address: "dest.fake" }, { user });
const requestCalls = (kit: Kit) => kit.contract.calls.filter((c) => c.method === "request_withdraw").length;
/** Sends the open withdrawal (row id) through the fake provider and follows it to DONE. */
const finish = async (kit: Kit, rowId: number) => {
  kit.intents.setWithdrawalState(`fakew-${rowId}`, "SUCCESS");
  await runCron();
};

describe("F4: withdraw rules agree with the contract", () => {
  it("minimum is 1,000 fils: BAD_REQUEST with a clear message, nothing reserved, the chain is not asked", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "alice");
    kit.contract.testGrantFils(acc, 50000n);
    expectErr(await withdraw("alice", "999"), "BAD_REQUEST", /minimum withdrawal is 10 coins/i);
    expect(await kit.db.query("select 1 from withdrawals")).toHaveLength(0);
    expect(requestCalls(kit)).toBe(0);
    expect((await withdraw("alice", "1000")).json.ok).toBe(true);
  }, TIMEOUT);

  it("one open withdrawal per player: a second is refused before reserving, SENT still counts as open, DONE frees it", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "bob");
    kit.contract.testGrantFils(acc, 50000n);
    expect((await withdraw("bob", "2000")).json.ok).toBe(true);
    expectErr(await withdraw("bob", "2000"), "BAD_REQUEST", /withdrawal in progress/i);
    expect(await kit.db.query("select 1 from withdrawals")).toHaveLength(1);
    expect(requestCalls(kit)).toBe(1);
    await runCron(); // PENDING -> SENT (the provider has not finished)
    expect((await kit.contract.getWithdraw(1))!.status).toBe("SENT");
    expectErr(await withdraw("bob", "2000"), "BAD_REQUEST", /withdrawal in progress/i);
    await finish(kit, 1);
    expect((await kit.contract.getWithdraw(1))!.status).toBe("DONE");
    expect((await withdraw("bob", "2000")).json.ok).toBe(true);
  }, TIMEOUT);

  it("a FAILED row blocks only while the contract still holds its withdrawal open", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "fay");
    kit.contract.testGrantFils(acc, 50000n);
    expect((await withdraw("fay", "2000")).json.ok).toBe(true);
    await kit.db.query("update withdrawals set status = 'FAILED'"); // waiting for a human; the chain says PENDING
    expectErr(await withdraw("fay", "2000"), "BAD_REQUEST", /withdrawal in progress/i);
    await kit.contract.operatorCall("refund_withdraw", { id: 1 }); // the human refunded it on chain
    expect((await withdraw("fay", "2000")).json.ok).toBe(true);
  }, TIMEOUT);

  it("a refunded withdrawal still counts against today's cap (the contract does not decrement it)", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "carol");
    kit.contract.testGrantFils(acc, 400000n);
    expect((await withdraw("carol", "60000")).json.ok).toBe(true);
    kit.intents.withdrawResult = { ok: false, reason: "rejected" };
    expect((await runCron()).json.data.refunded).toBe(1); // REFUNDED on chain and in the database
    kit.intents.withdrawResult = null;
    expect((await kit.db.query<{ status: string }>("select status from withdrawals"))[0]!.status).toBe("REFUNDED");
    // 60,000 of the 100,000 cap is used although the money came back: 50,000 more does not fit...
    expectErr(await withdraw("carol", "50000"), "BAD_REQUEST", /daily withdrawal limit/i);
    expect(requestCalls(kit)).toBe(1); // ...and the chain was not asked (no debit, no generic contract RATE_LIMIT)
    // ...40,000 does, and the contract agrees.
    expect((await withdraw("carol", "40000")).json.ok).toBe(true);
    expect(requestCalls(kit)).toBe(2);
  }, TIMEOUT);

  it("the window is the UTC calendar day, not a rolling 24 hours", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "dee");
    kit.contract.testGrantFils(acc, 400000n);
    const dayStart = Math.floor(kit.clock.now / DAY) * DAY;
    kit.clock.now = dayStart + 23 * 3600; // 23:00 UTC
    expect((await withdraw("dee", "100000")).json.ok).toBe(true);
    await finish(kit, 1);
    expectErr(await withdraw("dee", "1000"), "BAD_REQUEST", /daily withdrawal limit/i); // same UTC day
    kit.clock.now = dayStart + DAY + 3600; // 01:00 the next UTC day: only 2 h later, but a fresh day on chain and here
    expect((await withdraw("dee", "100000")).json.ok).toBe(true);
    expect(requestCalls(kit)).toBe(2);
  }, TIMEOUT);

  it("the cap is per player", async () => {
    const kit = await live();
    kit.contract.testGrantFils(await signIn(kit, stateGET, "eve"), 100000n);
    kit.contract.testGrantFils(await signIn(kit, stateGET, "gus"), 100000n);
    expect((await withdraw("eve", "100000")).json.ok).toBe(true);
    expect((await withdraw("gus", "100000")).json.ok).toBe(true);
  }, TIMEOUT);
});
