// NearTreasury outcome handling with a stubbed RPC provider and a throw-away random key generated in the
// test (it is never funded and never leaves the process).

import { JsonRpcProvider, KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { NearTreasury } from "../intents/treasury";

function make(callFunction: (a: Record<string, unknown>) => Promise<unknown>) {
  const provider = { callFunction } as unknown as JsonRpcProvider;
  const t = new NearTreasury({ accountId: "treasury.fake", privateKey: KeyPair.fromRandom("ed25519").toString(), rpcUrl: "https://rpc.example.invalid", provider });
  const calls: Array<Record<string, unknown>> = [];
  const stub = (res: unknown | Error) => {
    (t as unknown as { account: { callFunctionRaw: (a: Record<string, unknown>) => Promise<unknown> } }).account.callFunctionRaw = async (a) => {
      calls.push(a);
      if (res instanceof Error) throw res;
      return res;
    };
  };
  return { t, stub, calls };
}

describe("NearTreasury", () => {
  it("reads the NEP-141 balance with ft_balance_of({account_id}) and validates the answer", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { t } = make(async (a) => { seen.push(a); return "12345678"; });
    expect(await t.ftBalance("usdc-test-placeholder.near")).toBe(12_345_678n);
    expect(seen[0]).toEqual({ contractId: "usdc-test-placeholder.near", method: "ft_balance_of", args: { account_id: "treasury.fake" } });
    for (const bad of [null, 5, "1.5", "-1", "abc", undefined]) {
      await expect(make(async () => bad).t.ftBalance("x.near")).rejects.toMatchObject({ kind: "schema" });
    }
  });

  it("sends ft_transfer({receiver_id, amount}) with exactly 1 yoctoNEAR and returns the transaction hash", async () => {
    const { t, stub, calls } = make(async () => "0");
    stub({ status: { SuccessValue: "" }, transaction: { hash: "HASH1" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }] });
    expect(await t.ftTransfer({ tokenContract: "usdc-test-placeholder.near", receiver: "abc.near", amount: 1_000_000n })).toEqual({ ok: true, txHash: "HASH1" });
    expect(calls[0]).toMatchObject({ contractId: "usdc-test-placeholder.near", methodName: "ft_transfer", args: { receiver_id: "abc.near", amount: "1000000" }, deposit: 1n });
  });

  it("a failed receipt (for example an unregistered receiver) is a definite ok:false", async () => {
    const { t, stub } = make(async () => "0");
    stub({ status: { SuccessValue: "" }, transaction: { hash: "H" }, receipts_outcome: [{ outcome: { status: { Failure: { ActionError: {} } } } }] });
    expect(await t.ftTransfer({ tokenContract: "t.near", receiver: "r.near", amount: 1n })).toEqual({ ok: false, reason: "token transfer failed" });
    stub({ status: { Failure: {} }, transaction: { hash: "H" }, receipts_outcome: [] });
    expect((await t.ftTransfer({ tokenContract: "t.near", receiver: "r.near", amount: 1n })).ok).toBe(false);
  });

  it("an RPC error or a missing hash is NOT a definite failure: it throws (unknown outcome)", async () => {
    const { t, stub } = make(async () => "0");
    stub(new Error("timeout while waiting for finality"));
    await expect(t.ftTransfer({ tokenContract: "t.near", receiver: "r.near", amount: 1n })).rejects.toThrow("timeout");
    stub({ status: { SuccessValue: "" }, receipts_outcome: [] });
    await expect(t.ftTransfer({ tokenContract: "t.near", receiver: "r.near", amount: 1n })).rejects.toMatchObject({ kind: "schema" });
  });

  it("refuses a non-positive amount without calling the chain", async () => {
    const { t, stub, calls } = make(async () => "0");
    stub({});
    expect((await t.ftTransfer({ tokenContract: "t.near", receiver: "r.near", amount: 0n })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
