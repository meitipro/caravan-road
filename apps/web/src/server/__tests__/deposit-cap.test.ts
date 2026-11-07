// F8: the contract's per-player deposit cap (RATE_LIMIT "player deposit cap reached") is permanent; the operator's daily cap is transient.
// Ground truth: contracts/caravan/src/admin.rs try_credit_deposit.

import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as depositQuotePOST } from "../../app/api/deposit/quote/route";
import { GET as cronDepositsGET } from "../../app/api/cron/deposits/route";
import { ContractPanic } from "../errors";
import { CRON_SECRET_FOR_TESTS, call, makeKit, post, signIn, type Kit } from "./testkit";

const TIMEOUT = 120_000;
const auth = { headers: { authorization: `Bearer ${CRON_SECRET_FOR_TESTS}` } };
const cron = (h: (r: Request) => Promise<Response>, path: string) => call(h, "GET", path, undefined, auth);

let open: Kit | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (open) await open.close();
  open = null;
});
const live = async (): Promise<Kit> => (open = await makeKit({ mode: "LIVE" }));

const quote = (user: string, amount_in: string, origin_asset = "nep141:usdc.fake") =>
  post(depositQuotePOST, "/api/deposit/quote", { origin_asset, amount_in, refund_address: "refund.fake" }, { user });
const depositStatuses = async (kit: Kit) => (await kit.db.query<{ status: string }>("select status from deposits order by id")).map((r) => r.status);

describe("F8: the contract's per-player deposit cap is permanent, the operator's daily cap is transient", () => {
  it("RATE_LIMIT 'player deposit cap reached' -> FAILED with an ALERT, never retried", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "alice");
    // The contract already holds 190,000 fils of deposits that the database does not know about (credited elsewhere).
    await kit.contract.operatorCall("credit_deposit", { account_id: acc, fils: "190000", reference: "elsewhere" });
    const alerts: string[] = [];
    vi.spyOn(kit.svc.log, "error").mockImplementation((...a: unknown[]) => { alerts.push(a.map(String).join(" ")); });

    const q = (await quote("alice", "20000")).json.data;
    kit.intents.setState(q.quote_id, "SUCCESS");
    const r1 = (await cron(cronDepositsGET, "/api/cron/deposits")).json.data;
    expect(r1.failed).toBe(1);
    expect(await depositStatuses(kit)).toEqual(["FAILED"]);
    expect(alerts.some((a) => /ALERT.*deposit.*failed.*manual refund/i.test(a))).toBe(true);
    // A second run does not touch it again.
    const before = kit.contract.calls.filter((c) => c.method === "credit_deposit").length;
    await cron(cronDepositsGET, "/api/cron/deposits");
    expect(kit.contract.calls.filter((c) => c.method === "credit_deposit").length).toBe(before);
  }, TIMEOUT);

  it("the fake contract panics exactly like the real one (RATE_LIMIT, same text)", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "bob");
    await kit.contract.operatorCall("credit_deposit", { account_id: acc, fils: "200000", reference: "r1" });
    const e = await kit.contract.operatorCall("credit_deposit", { account_id: acc, fils: "1", reference: "r2" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ContractPanic);
    expect((e as Error).message).toBe("RATE_LIMIT: player deposit cap reached");
  }, TIMEOUT);

  it("RATE_LIMIT for the operator daily cap (or any other text) keeps the row in CREDITING for the next run", async () => {
    const kit = await live();
    await signIn(kit, stateGET, "carol");
    const q = (await quote("carol", "1000")).json.data;
    kit.intents.setState(q.quote_id, "SUCCESS");
    const orig = kit.contract.operatorCall.bind(kit.contract);
    let refuse = true;
    kit.contract.operatorCall = (async (...a: Parameters<typeof orig>) => {
      if (refuse) throw new ContractPanic("RATE_LIMIT: operator daily cap reached");
      return orig(...a);
    }) as typeof orig;
    expect((await cron(cronDepositsGET, "/api/cron/deposits")).json.data).toEqual({ credited: 0, expired: 0, failed: 0 });
    expect(await depositStatuses(kit)).toEqual(["CREDITING"]);
    refuse = false;
    expect((await cron(cronDepositsGET, "/api/cron/deposits")).json.data.credited).toBe(1);
    expect(await depositStatuses(kit)).toEqual(["CREDITED"]);
  }, TIMEOUT);
});

