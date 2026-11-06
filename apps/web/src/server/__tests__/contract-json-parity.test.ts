// Parity with the REAL contract's JSON, offline. contracts/caravan/fixtures/contract-json.json is produced by the
// contract's own Rust tests (src/tests/fixture_tests.rs: a scripted game through the public methods), so these tests
// catch the class of bug where FakeContract and the real contract disagree on a shape (the journey `status` string,
// event field names, ...). If the contract changes, its Rust test fails until the fixture is regenerated.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import {
  CITY_IDS, EventSchema, GOOD_IDS, JourneySchema, PlayerSchema, StallSchema, WorldStateSchema, quote,
} from "@caravan/shared";
import { NearContract, normalizeReturn, parseOutcome, type RawOutcome } from "../contract/near";
import { FakeContract } from "../contract/fake";
import { PUBLIC_EVENT_FIELDS, toApiEvents, toApiJourney, toApiPlayer, toApiStall, toApiWorld } from "../game/views";
import type { ContractJourney, ContractStall } from "../contract/types";
import { generateKey, playerKeyFromSeed } from "../near/custody";

type Json = Record<string, unknown>;
interface Script { returns: Json; views: Json; logs: Array<{ step: string; lines: string[] }> }
const FIXTURE = JSON.parse(readFileSync(new URL("../../../../../contracts/caravan/fixtures/contract-json.json", import.meta.url), "utf8")) as { play: Script; live: Script };
const { play, live } = FIXTURE;
const P1 = "p1.players.test";

/** NearContract over a provider that answers views from the fixture. */
function contractOverFixture(): NearContract {
  const provider = {
    async callFunction({ method, args }: { method: string; args: Json }) {
      switch (method) {
        case "get_world": return play.views.get_world;
        case "get_stalls": return play.views.get_stalls;
        case "get_players": return play.views.get_players;
        case "get_merchant": return play.views.get_merchant_bandar;
        case "get_config": return play.views.get_config;
        case "get_player": return args.account_id === P1 ? play.views.get_player_after_claim : play.views.get_player_missing;
        case "get_journey": return play.views.get_journey_claimed;
        case "get_withdraw": return args.id === 0 ? live.views.get_withdraw_sent : live.views.get_withdraw_missing;
        case "get_withdrawals": return live.views.get_withdrawals;
        default: throw new Error(`fixture has no view ${method}`);
      }
    },
  } as unknown as JsonRpcProvider;
  const key = () => KeyPair.fromRandom("ed25519").toString(); // generated per test, never used to sign
  return new NearContract({
    network: "testnet", contractId: "caravan.test", relayerAccountId: "r.test", relayerPrivateKey: key(),
    operatorAccountId: "operator.test", operatorPrivateKey: key(), provider,
  });
}

/** A transaction response carrying `value` as the contract receipt's return and `lines` as its logs. */
function outcomeOf(value: unknown, lines: string[], relayed = true): RawOutcome {
  const b64 = value === undefined ? "" : Buffer.from(JSON.stringify(value)).toString("base64");
  return {
    status: { SuccessValue: relayed ? "" : b64 },
    transaction: { hash: "TX" },
    receipts_outcome: [
      { outcome: { executor_id: P1, logs: [], status: { SuccessValue: "" } } }, // the delegate receipt at the player
      { outcome: { executor_id: "caravan.test", logs: lines, status: { SuccessValue: b64 } } },
    ],
  };
}
const linesOf = (s: Script, step: string) => s.logs.find((l) => l.step === step)?.lines ?? [];
const allLines = (s: Script) => s.logs.flatMap((l) => l.lines);

describe("views from the real contract", () => {
  it("get_world -> API world state passes the shared schema; the shared quote() equals the contract's quotes", async () => {
    const c = contractOverFixture();
    const w = await c.getWorld();
    const api = WorldStateSchema.parse(toApiWorld(w, [], new Map()));
    expect(api.tick).toBe(3);
    expect(api.merchants.map((m) => m.id)).toEqual([...CITY_IDS]);
    expect(api.merchants.find((m) => m.id === "dasht")?.policy).toEqual({ spread_bp: 900, bias_bp: 100 });
    for (const raw of (play.views.get_world as { merchants: Array<Json> }).merchants) {
      const m = raw as { id: string; stock: Record<string, number>; policy: { spread_bp: number; bias_bp: number }; quotes: Record<string, Json> };
      for (const g of GOOD_IDS) {
        const q = quote({ good: g, stock: m.stock[g]!, spreadBp: m.policy.spread_bp, biasBp: m.policy.bias_bp });
        expect({ bid: q.bid, mid: q.mid, ask: q.ask }, `${m.id}/${g}`).toEqual(m.quotes[g]);
      }
    }
  });

  it("get_player (journey in transit and after the claim) -> API player", async () => {
    const c = contractOverFixture();
    const after = await c.getPlayer(P1);
    expect(after).not.toBeNull();
    const p = PlayerSchema.parse(toApiPlayer(after!, "Alice", 1_800_000_200));
    expect(p.location).toBe("shahr");
    expect(await c.getPlayer("nobody.players.test")).toBeNull();

    const inTransit = (await playerVia(play.views.get_player_in_transit as Json))!;
    expect(PlayerSchema.parse(toApiPlayer(inTransit, "Alice", 1_800_000_100)).journey?.status).toBe("IN_TRANSIT");
    expect(PlayerSchema.parse(toApiPlayer(inTransit, "Alice", 1_800_000_181)).journey?.status).toBe("ARRIVED");
  });

  it("get_journey (claimed) -> CLAIMED with ambushed; get_stalls -> API stalls", async () => {
    const c = contractOverFixture();
    const j = JourneySchema.parse(toApiJourney((await c.getJourney(P1))!, 1_800_000_200));
    expect(j.status).toBe("CLAIMED");
    expect(j.ambushed).toBe(false);
    const stalls = await c.getStalls();
    expect(stalls).toHaveLength(1);
    expect(StallSchema.parse(toApiStall(stalls[0]!))).toMatchObject({ id: 0, seller: P1, city: "bandar", good: "grain", qty: 2, unit_price: "1500" });
  });

  it("get_config, get_withdraw and get_withdrawals are read as the server expects", async () => {
    const c = contractOverFixture();
    expect(await c.getConfig()).toEqual({ mode: "PLAY", paused: false, operator: "operator.test" });
    expect(await c.getWithdraw(0)).toMatchObject({ id: 0, account_id: "p3.players.test", fils: "5000", status: "SENT", dest_asset: "nep141:usdc.example" });
    expect(await c.getWithdraw(999)).toBeNull();
    expect((await c.getWithdrawals(0, 50))[0]).toMatchObject({ id: 0, status: "REFUNDED", fils: "5000" });
  });
});

// get_player's normaliser is private to NearContract; reach it through a one-off contract whose provider returns `raw`.
function playerVia(raw: Json) {
  const c = new NearContract({
    network: "testnet", contractId: "caravan.test", relayerAccountId: "r.test", relayerPrivateKey: KeyPair.fromRandom("ed25519").toString(),
    operatorAccountId: "o.test", operatorPrivateKey: KeyPair.fromRandom("ed25519").toString(),
    provider: { callFunction: async () => raw } as unknown as JsonRpcProvider,
  });
  return c.getPlayer(P1);
}

describe("return values of player calls (relayed: read from the contract receipt)", () => {
  const ret = (method: string, step: string) => normalizeReturn(method, parseOutcome(outcomeOf(play.returns[step], linesOf(play, step)), "caravan.test", () => 1).returnValue);

  it("trade -> { total, fee, player }", () => {
    const r = ret("trade", "trade_buy") as { total: string; fee: string; player: Json };
    expect(r).toMatchObject({ total: "10470", fee: "104" });
  });
  it("start_journey -> IN_TRANSIT journey; claim_journey -> CLAIMED with ambushed (the bug the sandbox review found)", () => {
    const started = toApiJourney(ret("start_journey", "start_journey") as ContractJourney, 1_800_000_100);
    expect(JourneySchema.parse(started).status).toBe("IN_TRANSIT");
    const claimed = JourneySchema.parse(toApiJourney(ret("claim_journey", "claim_journey") as ContractJourney, 1_800_000_200));
    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.ambushed).toBe(false);
  });
  it("stall_create -> a stall the API accepts", () => {
    expect(StallSchema.parse(toApiStall(ret("stall_create", "stall_create") as ContractStall)).id).toBe(0);
  });
  it("world_tick (direct call: top-level SuccessValue) -> { ticks }; an early tick is ticks: 0", () => {
    const tick = (step: string) => parseOutcome(outcomeOf(play.returns[step], linesOf(play, step), false), "caravan.test", () => 1).returnValue;
    expect(tick("world_tick")).toEqual({ ticks: 3, tick: 3 });
    expect(tick("world_tick_early")).toEqual({ ticks: 0, tick: 3 });
  });
  it("LIVE: credit_deposit -> { credited }, request_withdraw -> the withdrawal id", () => {
    const r = (step: string) => parseOutcome(outcomeOf(live.returns[step], linesOf(live, step), false), "caravan.test", () => 1).returnValue;
    expect(r("credit_deposit")).toEqual({ credited: true });
    expect(r("credit_deposit_repeat")).toEqual({ credited: false });
    expect(r("request_withdraw")).toBe(0); // id 0 is a valid id: never read it as "missing"
  });
});

describe("events from the real contract's logs", () => {
  let n = 0;
  const events = parseOutcome(outcomeOf(null, [...allLines(play), ...allLines(live)]), "caravan.test", () => ++n).events;

  it("every contract event is parsed, with its block time", () => {
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining([
      "faucet", "trade", "stall_create", "stall_buy", "stall_cancel", "journey_started", "journey_claimed", "policy", "ship", "tick",
      "paused", "deposit", "withdraw_requested", "withdraw_marked",
    ]));
    expect(events.find((e) => e.event === "trade")?.at_ns).toBe("1800000001000000000");
  });

  it("the API's public fields are all present for every public event type (names normalised to the server's)", () => {
    const api = toApiEvents(events);
    for (const e of api) {
      EventSchema.parse(e);
      for (const k of PUBLIC_EVENT_FIELDS[e.type]) expect(e.data[k], `${e.type}.${k}`).toBeDefined();
      expect(JSON.stringify(e.data)).not.toMatch(/players\.test|0xabc|quote-1/); // no account ids or money details in public events
    }
    expect(api.find((e) => e.type === "stall_buy")?.data).toMatchObject({ stall_id: 0, qty: 1, total: "1500", fee: "30" });
    expect(api.find((e) => e.type === "ship")?.data).toMatchObject({ from: "madan", to: "bandar", good: "iron", qty: 2 });
    expect(events.find((e) => e.event === "faucet")?.data.account_id).toBe(P1);
  });

  it("FakeContract (strict, the dev backend) emits only event types the contract has, with the same public fields", async () => {
    const contractTypes = new Set(events.map((e) => e.event));
    const fake = new FakeContract({ strict: true, now: () => 1_800_000_000 });
    const k = generateKey();
    const key = playerKeyFromSeed(k.seed, k.publicKey);
    await fake.createPlayerAccount(P1, k.publicKey);
    await fake.playerCall(P1, "register", {}, key);
    await fake.playerCall(P1, "faucet", {}, key);
    await fake.playerCall(P1, "trade", { merchant: "bandar", good: "grain", side: "buy", qty: 5, limit_total: "999999" }, key);
    const fakeEvents = await fake.recentEvents(50);
    for (const e of fakeEvents) expect(contractTypes.has(e.event), e.event).toBe(true);
    const fakeTrade = toApiEvents(fakeEvents).find((e) => e.type === "trade")!;
    const realTrade = toApiEvents(events).find((e) => e.type === "trade")!;
    const keys = (d: Record<string, unknown>) => Object.keys(d).filter((x) => x !== "tx_hash").sort(); // the fake has no transactions
    expect(keys(fakeTrade.data)).toEqual(keys(realTrade.data));
  });
});
