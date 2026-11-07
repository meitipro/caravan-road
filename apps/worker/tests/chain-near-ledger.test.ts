// The contract does not expose ship_in_paid / last_ship_tick in get_world. NearChain therefore keeps its own
// ledger of the ships it sent in the current tick (the contract returns the exact payment from `ship`) and adds
// them to the snapshot, so candidates.ts can respect the destination's 25% per-tick budget and the
// one-shipment-per-good-per-tick rule across the four merchants' runs of one cycle.

import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { CITY_IDS, GOOD_IDS } from "@caravan/shared";
import { NearChain } from "../src/chain-near.js";
import type { WorkerConfig } from "../src/config.js";

const stock = { grain: 200, salt: 120, iron: 100, spice: 40, silk: 30 };
const worldAt = (tick: number) => ({
  tick,
  now_ns: String(1_800_000_000n * 1_000_000_000n),
  merchants: CITY_IDS.map((id) => ({ id, treasury: "50000", stock, policy: { spread_bp: 800, bias_bp: 0 } })),
});
const ok = (value: unknown) => ({
  status: { SuccessValue: Buffer.from(JSON.stringify(value)).toString("base64") },
  transaction_outcome: { id: "TX" },
});

function chain(initialTick: number, shipReturns: () => unknown) {
  const key = KeyPair.fromRandom("ed25519").toString(); // generated for this test only
  const cfg = {
    network: "testnet", rpcUrl: "http://127.0.0.1:1", contractId: "c.test",
    merchantAccounts: Object.fromEntries(CITY_IDS.map((c) => [c, `${c}.test`])),
    merchantKeys: Object.fromEntries(CITY_IDS.map((c) => [c, key])),
  } as unknown as WorkerConfig;
  const c = new NearChain(cfg);
  const state = { tick: initialTick };
  (c as unknown as { provider: unknown }).provider = { callFunction: async () => worldAt(state.tick) };
  const accounts = (c as unknown as { accounts: Map<string, unknown> }).accounts;
  for (const city of CITY_IDS) accounts.set(city, { callFunctionRaw: async () => shipReturns() });
  return { chain: c, state };
}

describe("NearChain ship ledger", () => {
  it("a fresh tick reports no payments and no shipped goods", async () => {
    const { chain: c } = chain(5, () => ok("19900"));
    const s = await c.readSnapshot();
    for (const id of CITY_IDS) {
      expect(s.merchants[id].ship_in_paid).toBeUndefined();
      expect(s.merchants[id].shipped_this_tick).toBeUndefined();
    }
  });

  it("after a successful ship the next snapshot of the SAME tick carries the exact payment and the shipped good", async () => {
    const { chain: c } = chain(5, () => ok("19900"));
    await c.readSnapshot();
    await c.ship("bandar", "shahr", "silk", 1);
    await c.ship("dasht", "shahr", "grain", 2); // a second payer into the same destination adds up
    const s = await c.readSnapshot();
    expect(s.merchants.shahr.ship_in_paid).toBe(39_800n);
    expect(s.merchants.bandar.shipped_this_tick).toEqual(["silk"]);
    expect(s.merchants.dasht.shipped_this_tick).toEqual(["grain"]);
    expect(s.merchants.madan.ship_in_paid).toBeUndefined();
  });

  it("a new tick starts over", async () => {
    const { chain: c, state } = chain(5, () => ok("19900"));
    await c.readSnapshot();
    await c.ship("bandar", "shahr", "silk", 1);
    state.tick = 6;
    const s = await c.readSnapshot();
    expect(s.merchants.shahr.ship_in_paid).toBeUndefined();
    expect(s.merchants.bandar.shipped_this_tick).toBeUndefined();
  });

  it("a failed ship leaves the ledger untouched", async () => {
    const { chain: c } = chain(5, () => ({ status: { Failure: { ActionError: "RATE_LIMIT: budget" } }, transaction_outcome: { id: "X" } }));
    await c.readSnapshot();
    await expect(c.ship("bandar", "shahr", "silk", 1)).rejects.toThrow(/ship failed on chain/);
    const s = await c.readSnapshot();
    expect(s.merchants.shahr.ship_in_paid).toBeUndefined();
    expect(s.merchants.bandar.shipped_this_tick).toBeUndefined();
  });

  it("an unreadable return value still records the shipped good (payment unknown, counted as 0)", async () => {
    const { chain: c } = chain(5, () => ({ status: { SuccessValue: "" }, transaction_outcome: { id: "TX" } }));
    await c.readSnapshot();
    await c.ship("bandar", "shahr", "silk", 1);
    const s = await c.readSnapshot();
    expect(s.merchants.bandar.shipped_this_tick).toEqual(["silk"]);
    expect(s.merchants.shahr.ship_in_paid).toBeUndefined();
    expect(GOOD_IDS).toContain("silk");
  });
});
