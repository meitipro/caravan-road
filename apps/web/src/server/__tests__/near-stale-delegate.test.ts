// F7: a stale delegate-action nonce or an expired delegate shows up as a FAILURE INSIDE A RECEIPT whose values are numbers /
// objects (or a bare kind string), never a panic string. The old panicText() looked at string values only, so it answered
// 'INTERNAL: transaction failed' and the /nonce/i retry in playerCall was dead code. Outcomes below are hand-built in the
// shape of nearcore's JSON (receipts_outcome[].outcome.status.Failure.ActionError.kind).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import { NearContract, parseOutcome, StaleDelegateError, type RawOutcome } from "../contract/near";
import { isContractPanic } from "../errors";
import type { PlayerKey } from "../contract/types";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as withdrawPOST } from "../../app/api/withdraw/route";
import { makeKit, post, signIn, type Kit } from "./testkit";

const CONTRACT = "c.test";
const receiptFailure = (failure: unknown): RawOutcome => ({
  status: { SuccessValue: "" },
  transaction_outcome: { id: "tx1" },
  receipts_outcome: [
    { outcome: { executor_id: "player.test", status: { SuccessValue: "" } } },
    { outcome: { executor_id: "player.test", status: { Failure: failure } } },
  ],
});
const invalidNonce = receiptFailure({ ActionError: { index: 0, kind: { DelegateActionInvalidNonce: { ak_nonce: 12, delegate_nonce: 11 } } } });
const expiredAsObject = receiptFailure({ ActionError: { index: 0, kind: { DelegateActionExpired: {} } } });
const expiredAsString = receiptFailure({ ActionError: { index: 0, kind: "DelegateActionExpired" } });
const successFor = (value: unknown): RawOutcome => ({
  status: { SuccessValue: "" },
  transaction_outcome: { id: "tx-ok" },
  receipts_outcome: [{ outcome: { executor_id: CONTRACT, status: { SuccessValue: Buffer.from(JSON.stringify(value)).toString("base64") } } }],
});

const parse = (r: RawOutcome) => { try { return parseOutcome(r, CONTRACT, () => 1); } catch (e) { return e; } };

describe("parseOutcome: failures with numeric / object-only values", () => {
  it("a stale nonce is recognised from the KEYS (values are numbers) and is not a ContractPanic", () => {
    const e = parse(invalidNonce);
    expect(e).toBeInstanceOf(StaleDelegateError);
    expect((e as StaleDelegateError).kind).toBe("DelegateActionInvalidNonce");
    expect(isContractPanic(e)).toBe(false);
  });

  it("an expired delegate is recognised both as a key and as a bare kind string", () => {
    expect((parse(expiredAsObject) as StaleDelegateError).kind).toBe("DelegateActionExpired");
    expect((parse(expiredAsString) as StaleDelegateError).kind).toBe("DelegateActionExpired");
  });

  it("a contract panic string still wins and is a ContractPanic", () => {
    const e = parse(receiptFailure({ ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: SLIPPAGE: price moved" } } } }));
    expect(isContractPanic(e)).toBe(true);
    expect((e as Error).message).toBe("Smart contract panicked: SLIPPAGE: price moved");
  });

  it("an unrecognised numeric-only failure becomes INTERNAL with the key path for the log, not a bare message", () => {
    const e = parse(receiptFailure({ ActionError: { index: 3, kind: { LackBalanceForState: { amount: 5 } } } }));
    expect(isContractPanic(e)).toBe(true);
    expect((e as Error).message).toMatch(/^INTERNAL: transaction failed/);
    expect((e as Error).message).toContain("LackBalanceForState");
  });

  it("a contract panic whose text merely mentions a delegate error is NOT treated as stale", () => {
    const e = parse(receiptFailure({ ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: BAD_REQUEST: DelegateActionExpired" } } } }));
    expect(e).not.toBeInstanceOf(StaleDelegateError);
    expect(isContractPanic(e)).toBe(true);
  });
});

describe("NearContract.playerCall: one retry with a freshly signed delegate", () => {
  const key: PlayerKey = { publicKey: "ed25519:11111111111111111111111111111111", sign: () => new Uint8Array(64) };
  const make = (outcomes: Array<RawOutcome | Error>) => {
    const c = new NearContract({
      network: "testnet", contractId: CONTRACT, relayerAccountId: "r.test", relayerPrivateKey: KeyPair.fromRandom("ed25519").toString(),
      operatorAccountId: "o.test", operatorPrivateKey: KeyPair.fromRandom("ed25519").toString(), provider: new JsonRpcProvider({ url: "http://127.0.0.1:1" }),
      staleRetryDelayMs: 0,
    });
    let signed = 0;
    let relayed = 0;
    (c as unknown as { signDelegate: unknown }).signDelegate = async () => ({ nonce: ++signed });
    (c as unknown as { relayer: unknown }).relayer = {
      relayMetaTransaction: async (d: { nonce: number }) => {
        const next = outcomes[relayed++];
        if (next === undefined) throw new Error("test ran out of outcomes");
        if (next instanceof Error) throw next;
        (next as { _signedWith?: number })._signedWith = d.nonce;
        return next;
      },
    };
    return { c, counts: () => ({ signed, relayed }) };
  };

  it("a stale nonce is retried once and the retry result is returned (second delegate is a new signature)", async () => {
    const { c, counts } = make([invalidNonce, successFor({ total: "5", fee: "1" })]);
    const out = await c.playerCall("p.test", "faucet", {}, key);
    expect(out.txHash).toBe("tx-ok");
    expect(counts()).toEqual({ signed: 2, relayed: 2 });
  });

  it("an expired delegate is retried once too", async () => {
    const { c, counts } = make([expiredAsString, successFor(1)]);
    expect((await c.playerCall("p.test", "faucet", {}, key)).returnValue).toBe(1);
    expect(counts()).toEqual({ signed: 2, relayed: 2 });
  });

  it("only ONE retry: a second stale outcome is reported, not looped on", async () => {
    const { c, counts } = make([invalidNonce, invalidNonce, successFor(1)]);
    const e = await c.playerCall("p.test", "faucet", {}, key).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StaleDelegateError);
    expect(counts()).toEqual({ signed: 2, relayed: 2 });
  });

  it("a real contract panic is never retried", async () => {
    const panic = receiptFailure({ ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: SLIPPAGE: price moved" } } } });
    const { c, counts } = make([panic, successFor(1)]);
    const e = await c.playerCall("p.test", "trade", { merchant: "dasht", good: "grain", side: "buy", qty: 1, limit_total: "1" }, key).catch((x: unknown) => x);
    expect(isContractPanic(e)).toBe(true);
    expect(counts()).toEqual({ signed: 1, relayed: 1 });
  });

  it("near-api-js throws failed outcomes: the thrown error's transactionResult is classified the same way", async () => {
    const thrown = Object.assign(new Error("Delegate action nonce is invalid"), { transactionResult: invalidNonce });
    const { c, counts } = make([thrown, successFor(1)]);
    expect((await c.playerCall("p.test", "faucet", {}, key)).returnValue).toBe(1);
    expect(counts()).toEqual({ signed: 2, relayed: 2 });

    const panicThrown = Object.assign(new Error("boom"), {
      transactionResult: receiptFailure({ ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: NOT_IN_CITY: x" } } } }),
    });
    const second = make([panicThrown]);
    const e = await second.c.playerCall("p.test", "faucet", {}, key).catch((x: unknown) => x);
    expect(isContractPanic(e)).toBe(true);
    expect(second.counts().relayed).toBe(1);
  });

  it("a plain network error is not retried here", async () => {
    const { c, counts } = make([new Error("fetch failed"), successFor(1)]);
    const e = await c.playerCall("p.test", "faucet", {}, key).catch((x: unknown) => x);
    expect((e as Error).message).toBe("fetch failed");
    expect(counts().relayed).toBe(1);
  });
});

describe("a relayed withdraw that definitely did not run releases its reservation at once", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit({ mode: "LIVE" }); }, 120_000);
  afterAll(async () => { await kit.close(); });
  const withdraw = (user: string, fils: string) =>
    post(withdrawPOST, "/api/withdraw", { fils, dest_asset: "nep141:usdc.fake", dest_address: "dest.fake" }, { user });
  const statuses = async () => (await kit.db.query<{ status: string }>("select status from withdrawals order by id")).map((r) => r.status);

  it("StaleDelegateError after the retry: INTERNAL to the client, row CANCELLED (not RESERVED for 900 s), nothing debited", async () => {
    const acc = await signIn(kit, stateGET, "alice");
    kit.contract.testGrantFils(acc, 5000n);
    const spy = vi.spyOn(kit.contract, "playerCall").mockRejectedValueOnce(new StaleDelegateError("DelegateActionInvalidNonce"));
    const r = await withdraw("alice", "3000");
    expect(r.json.error?.code).toBe("INTERNAL");
    expect(await statuses()).toEqual(["CANCELLED"]);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(5000n);
    spy.mockRestore();
  });

  it("an ambiguous failure (network error after sending) stays RESERVED for reconciliation", async () => {
    await signIn(kit, stateGET, "bob");
    const spy = vi.spyOn(kit.contract, "playerCall").mockRejectedValueOnce(new Error("socket hang up"));
    const r = await withdraw("bob", "1000");
    expect(r.json.error?.code).toBe("INTERNAL");
    expect(await statuses()).toEqual(["CANCELLED", "RESERVED"]);
    spy.mockRestore();
  });
});
