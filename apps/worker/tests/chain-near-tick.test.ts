import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { CITY_IDS } from "@caravan/shared";
import { NearChain } from "../src/chain-near.js";
import type { WorkerConfig } from "../src/config.js";

// world_tick on the real contract never panics on an early call: it answers { ticks: 0 }. Any real failure must surface.
function chainWith(call: () => Promise<unknown>) {
  const key = KeyPair.fromRandom("ed25519").toString(); // generated for this test only
  const cfg = {
    network: "testnet", rpcUrl: "http://127.0.0.1:1", contractId: "c.test",
    merchantAccounts: Object.fromEntries(CITY_IDS.map((c) => [c, `${c}.test`])),
    merchantKeys: Object.fromEntries(CITY_IDS.map((c) => [c, key])),
  } as unknown as WorkerConfig;
  const chain = new NearChain(cfg);
  const accounts = (chain as unknown as { accounts: Map<string, unknown> }).accounts;
  accounts.set("shahr", { callFunctionRaw: call });
  return chain;
}
const ok = (value: unknown) => ({
  status: { SuccessValue: Buffer.from(JSON.stringify(value)).toString("base64") },
  transaction_outcome: { id: "TXHASH" },
});

describe("NearChain.worldTick", () => {
  it("ticks: 0 is reported as skipped", async () => {
    const r = await chainWith(async () => ok({ ticks: 0, tick: 7 })).worldTick();
    expect(r).toEqual({ txHash: null, skipped: true });
  });
  it("ticks >= 1 returns the transaction hash", async () => {
    const r = await chainWith(async () => ok({ ticks: 2, tick: 9 })).worldTick();
    expect(r.txHash).toBe("TXHASH");
    expect(r.skipped).toBeUndefined();
  });
  it("a failure that merely contains the word tick (world_tick failed: PAUSED) is NOT swallowed", async () => {
    const chain = chainWith(async () => ({ status: { Failure: { ActionError: "PAUSED: the game is paused" } }, transaction_outcome: { id: "X" } }));
    await expect(chain.worldTick()).rejects.toThrow(/world_tick failed on chain/);
  });
});
