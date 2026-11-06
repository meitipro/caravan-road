// Offline tests for the pieces of NearContract that the sandbox suite (src/server/__sandbox__) exercises end to
// end on Linux: the real contract's JourneyView shape and how directly signed calls report panics.

import { describe, expect, it } from "vitest";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import { NearContract, normJourney } from "../contract/near";
import { toApiJourney } from "../game/views";
import { isContractPanic } from "../errors";

// Shape returned by contracts/caravan/src/types.rs JourneyView (money and times as strings, status as text).
const claimedView = {
  id: 0, from: "bandar", to: "shahr", cargo: { grain: 9 }, guards: 0,
  started_at_ns: "1800000000000000000", arrives_at_ns: "1800000180000000000", risk_bp: 800,
  status: "CLAIMED", ambushed: true, lost: { grain: 2 },
};

describe("contract JourneyView -> API journey", () => {
  it("a claimed journey keeps CLAIMED, ambushed and lost (not ARRIVED)", () => {
    const j = toApiJourney(normJourney(claimedView), 1_800_000_999);
    expect(j.status).toBe("CLAIMED");
    expect(j.ambushed).toBe(true);
    expect(j.lost).toEqual({ grain: 2 });
  });

  it("an in-transit journey stays IN_TRANSIT until arrival, then ARRIVED", () => {
    const view = { ...claimedView, status: "IN_TRANSIT", ambushed: undefined, lost: undefined };
    expect(toApiJourney(normJourney(view), 1_800_000_100).status).toBe("IN_TRANSIT");
    expect(toApiJourney(normJourney(view), 1_800_000_180).status).toBe("ARRIVED");
  });
});

describe("NearContract directly signed calls", () => {
  const make = () => new NearContract({
    network: "testnet", contractId: "c.test", relayerAccountId: "r.test", relayerPrivateKey: KeyPair.fromRandom("ed25519").toString(),
    operatorAccountId: "o.test", operatorPrivateKey: KeyPair.fromRandom("ed25519").toString(), provider: new JsonRpcProvider({ url: "http://127.0.0.1:1" }),
  });
  const stubOperator = (c: NearContract, error: Error) => {
    (c as unknown as { operator: unknown }).operator = { callFunctionRaw: async () => { throw error; } };
  };

  it("a contract panic becomes a ContractPanic with the contract's message", async () => {
    const c = make();
    stubOperator(c, new Error("Smart contract panicked: UNAUTHENTICATED: only the owner can unpause"));
    const e = await c.operatorCall("set_paused", { paused: false }).catch((x: unknown) => x);
    expect(isContractPanic(e)).toBe(true);
    expect((e as Error).message).toBe("UNAUTHENTICATED: only the owner can unpause");
  });

  it("a network error stays a plain error (retryable, not a permanent failure)", async () => {
    const c = make();
    stubOperator(c, new Error("fetch failed"));
    const e = await c.operatorCall("set_paused", { paused: true }).catch((x: unknown) => x);
    expect(isContractPanic(e)).toBe(false);
  });
});
