// Follow-up of SENT withdrawals (provider outcome -> DONE or refund on chain), quote signatures, and the
// LIVE environment rule for the 1Click variables.

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as withdrawPOST } from "../../app/api/withdraw/route";
import { POST as depositQuotePOST } from "../../app/api/deposit/quote/route";
import { GET as cronWithdrawalsGET } from "../../app/api/cron/withdrawals/route";
import { loadEnv } from "../env";
import { ContractPanic } from "../errors";
import { CRON_SECRET_FOR_TESTS, call, makeKit, post, signIn, type Kit } from "./testkit";

const TIMEOUT = 180_000;
const auth = { headers: { authorization: `Bearer ${CRON_SECRET_FOR_TESTS}` } };
const cron = () => call(cronWithdrawalsGET, "GET", "/api/cron/withdrawals", undefined, auth);
const withdraw = (user: string, fils: string) =>
  post(withdrawPOST, "/api/withdraw", { fils, dest_asset: "nep141:usdc.fake", dest_address: "dest.fake" }, { user });

describe("SENT withdrawals are followed to their end", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit({ mode: "LIVE" }); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  /** Creates a funded user, withdraws, and runs the cron once so the row is SENT. Returns ids. */
  async function sentWithdrawal(user: string, fils: string) {
    const acc = await signIn(kit, stateGET, user);
    kit.contract.testGrantFils(acc, BigInt(fils));
    expect((await withdraw(user, fils)).json.ok).toBe(true);
    await cron();
    const row = (await kit.db.query<{ id: number; contract_withdraw_id: number; quote_id: string; status: string; quote_signature: string | null }>(
      "select w.id, w.contract_withdraw_id, w.quote_id, w.status, w.quote_signature from withdrawals w join users u on u.id = w.user_id where u.near_account_id = $1", [acc],
    ))[0]!;
    expect(row.status).toBe("SENT");
    return { acc, row: { ...row, id: Number(row.id), contract_withdraw_id: Number(row.contract_withdraw_id) } };
  }
  const dbStatus = async (id: number) => (await kit.db.query<{ status: string }>("select status from withdrawals where id = $1", [id]))[0]!.status;

  it("marks the contract SENT first and stores the provider's quote signature", async () => {
    const { acc, row } = await sentWithdrawal("alice", "4000");
    expect((await kit.contract.getWithdraw(row.contract_withdraw_id))!.status).toBe("SENT");
    expect(row.quote_signature).toBe(`fakewsig-${row.id}`);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(0n);
  });

  it("provider PENDING or an unreadable status leaves it SENT", async () => {
    const { row } = await sentWithdrawal("bob", "3000");
    await cron(); // PENDING by default
    expect(await dbStatus(row.id)).toBe("SENT");
    const orig = kit.intents.withdrawalStatus.bind(kit.intents);
    kit.intents.withdrawalStatus = async () => { throw new Error("provider down"); };
    await cron();
    kit.intents.withdrawalStatus = orig;
    expect(await dbStatus(row.id)).toBe("SENT");
    expect((await kit.contract.getWithdraw(row.contract_withdraw_id))!.status).toBe("SENT");
  });

  it("provider SUCCESS -> contract DONE and row DONE, once", async () => {
    const { row } = await sentWithdrawal("carol", "5000");
    kit.intents.setWithdrawalState(row.quote_id, "SUCCESS");
    await cron();
    await cron();
    expect(await dbStatus(row.id)).toBe("DONE");
    expect((await kit.contract.getWithdraw(row.contract_withdraw_id))!.status).toBe("DONE");
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("provider REFUNDED -> the player gets the coins back on chain, exactly once", async () => {
    const { acc, row } = await sentWithdrawal("dave", "6000");
    kit.intents.setWithdrawalState(row.quote_id, "REFUNDED", String(6000 * 100));
    const r = (await cron()).json.data;
    expect(r.refunded).toBe(1);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(6000n);
    expect(await dbStatus(row.id)).toBe("REFUNDED");
    expect((await kit.contract.getWithdraw(row.contract_withdraw_id))!.status).toBe("REFUNDED");
    expect((await cron()).json.data.refunded).toBe(0);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(6000n);
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("provider FAILED is refunded too", async () => {
    const { acc, row } = await sentWithdrawal("erin", "2500");
    kit.intents.setWithdrawalState(row.quote_id, "FAILED");
    expect((await cron()).json.data.refunded).toBe(1);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(2500n);
  });

  it("concurrent cron runs refund once and mark once", async () => {
    const { acc, row } = await sentWithdrawal("frank", "7000");
    const { row: row2 } = await sentWithdrawal("gina", "1500");
    kit.intents.setWithdrawalState(row.quote_id, "REFUNDED", String(7000 * 100));
    kit.intents.setWithdrawalState(row2.quote_id, "SUCCESS");
    const before = kit.contract.calls.length;
    const runs = await Promise.all([cron(), cron(), cron(), cron()]);
    expect(runs.every((r) => r.json.ok)).toBe(true);
    expect(runs.reduce((n, r) => n + r.json.data.refunded, 0)).toBe(1);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(7000n); // credited once, not four times
    expect(await dbStatus(row.id)).toBe("REFUNDED");
    expect(await dbStatus(row2.id)).toBe("DONE");
    const newCalls = kit.contract.calls.slice(before).filter((c) => c.kind === "operator");
    expect(newCalls.filter((c) => c.method === "refund_withdraw")).toHaveLength(1);
    expect(newCalls.filter((c) => c.method === "mark_withdraw")).toHaveLength(1);
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("a refund that lost a race on chain is treated as done, not as an error", async () => {
    const { acc, row } = await sentWithdrawal("hank", "3500");
    kit.intents.setWithdrawalState(row.quote_id, "REFUNDED");
    // someone else refunds between our chain read and our refund call
    const orig = kit.contract.operatorCall.bind(kit.contract);
    kit.contract.operatorCall = (async (...a: Parameters<typeof orig>) => {
      if (a[0] === "refund_withdraw") {
        await orig("refund_withdraw", { id: row.contract_withdraw_id });
        throw new ContractPanic("BAD_REQUEST: withdrawal cannot be refunded");
      }
      return orig(...a);
    }) as typeof orig;
    await cron();
    kit.contract.operatorCall = orig;
    expect(await dbStatus(row.id)).toBe("REFUNDED");
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(3500n);
  });

  it("a partial refund or a chain mismatch is not auto-refunded (manual review)", async () => {
    const a = await sentWithdrawal("ivy", "8000");
    kit.intents.setWithdrawalState(a.row.quote_id, "REFUNDED", "100"); // far less than 800000 micro
    await cron();
    expect(await dbStatus(a.row.id)).toBe("FAILED");
    expect(BigInt((await kit.contract.getPlayer(a.acc))!.fils)).toBe(0n);

    const b = await sentWithdrawal("jack", "9000");
    await kit.db.query("update withdrawals set fils = '9001' where id = $1", [b.row.id]);
    kit.intents.setWithdrawalState(b.row.quote_id, "REFUNDED");
    await cron();
    expect(await dbStatus(b.row.id)).toBe("FAILED");
    expect(BigInt((await kit.contract.getPlayer(b.acc))!.fils)).toBe(0n);
  });

  it("a FINALIZING row whose run died is picked up after the stale period", async () => {
    const { acc, row } = await sentWithdrawal("kim", "4500");
    kit.intents.setWithdrawalState(row.quote_id, "REFUNDED");
    await kit.db.query("update withdrawals set status = 'FINALIZING', updated_at = $2 where id = $1", [row.id, kit.clock.now]);
    await cron();
    expect(await dbStatus(row.id)).toBe("FINALIZING"); // a live run might still own it
    kit.clock.advance(301);
    await cron();
    expect(await dbStatus(row.id)).toBe("REFUNDED");
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(4500n);
  });
});

describe("quote signature is stored", () => {
  it("keeps the deposit quote signature, and null when the provider gives none", async () => {
    const kit = await makeKit({ mode: "LIVE" });
    try {
      await signIn(kit, stateGET, "alice");
      const q = (a: string) => post(depositQuotePOST, "/api/deposit/quote", { origin_asset: "nep141:usdc.fake", amount_in: a, refund_address: "r.fake" }, { user: "alice" });
      const first = (await q("1000")).json.data;
      const orig = kit.intents.quote.bind(kit.intents);
      kit.intents.quote = async (req) => ({ ...(await orig(req)), signature: undefined });
      const second = (await q("2000")).json.data;
      const rows = await kit.db.query<{ quote_id: string; quote_signature: string | null }>("select quote_id, quote_signature from deposits order by id");
      expect(rows[0]).toEqual({ quote_id: first.quote_id, quote_signature: "fakesig-1" });
      expect(rows[1]).toEqual({ quote_id: second.quote_id, quote_signature: null });
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("env: ONECLICK_JWT and ONECLICK_USDC_ASSET_ID", () => {
  const base = (): Record<string, string> => ({
    GAME_MODE: "PLAY", NEAR_NETWORK: "testnet", CARAVAN_CONTRACT_ID: "c.fake", RELAYER_ACCOUNT_ID: "r.fake",
    RELAYER_PRIVATE_KEY: "x", OPERATOR_ACCOUNT_ID: "o.fake", OPERATOR_PRIVATE_KEY: "y",
    KEY_ENC_SECRET: randomBytes(32).toString("hex"), DATABASE_URL: "postgres://fake", AUTH_SECRET: "a", CRON_SECRET: "c",
  });
  const live = (): Record<string, string> => ({ ...base(), GAME_MODE: "LIVE", NEAR_NETWORK: "mainnet", NEAR_RPC_URL: "https://rpc.example.org" });

  it("optional in PLAY", () => {
    const env = loadEnv(base());
    expect(env.ONECLICK_JWT).toBeUndefined();
    expect(env.ONECLICK_USDC_ASSET_ID).toBeUndefined();
    expect(loadEnv({ ...base(), ONECLICK_JWT: "j", ONECLICK_USDC_ASSET_ID: "nep141:usdc.fake" }).ONECLICK_USDC_ASSET_ID).toBe("nep141:usdc.fake");
  });

  it("required together in LIVE, naming only the missing variables", () => {
    expect(() => loadEnv(live())).toThrow(/ONECLICK_JWT, ONECLICK_USDC_ASSET_ID/);
    expect(() => loadEnv({ ...live(), ONECLICK_JWT: "j" })).toThrow(/ONECLICK_USDC_ASSET_ID/);
    expect(() => loadEnv({ ...live(), ONECLICK_USDC_ASSET_ID: "nep141:usdc.fake" })).toThrow(/ONECLICK_JWT/);
    expect(() => loadEnv({ ...live(), ONECLICK_JWT: "j", ONECLICK_USDC_ASSET_ID: "nep141:usdc.fake" })).not.toThrow();
  });

  it("rejects a malformed asset id and never prints values", () => {
    try {
      loadEnv({ ...live(), ONECLICK_JWT: "secret-jwt-value", ONECLICK_USDC_ASSET_ID: "usdc" });
      throw new Error("should throw");
    } catch (e) {
      expect((e as Error).message).toContain("ONECLICK_USDC_ASSET_ID");
      expect((e as Error).message).not.toContain("secret-jwt-value");
    }
  });
});
