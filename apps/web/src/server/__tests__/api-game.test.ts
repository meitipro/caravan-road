import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PARAMS, StateResponseSchema, PlayerSchema, JourneySchema, tradeCost, type ErrorCode } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as tradePOST } from "../../app/api/trade/route";
import { POST as journeyStartPOST } from "../../app/api/journey/start/route";
import { POST as journeyClaimPOST } from "../../app/api/journey/claim/route";
import { POST as stallCreatePOST } from "../../app/api/stall/create/route";
import { POST as stallBuyPOST } from "../../app/api/stall/buy/route";
import { POST as stallCancelPOST } from "../../app/api/stall/cancel/route";
import { POST as faucetPOST } from "../../app/api/faucet/route";
import { GET as leaderboardGET } from "../../app/api/leaderboard/route";
import { GET as decisionsGET } from "../../app/api/npc/decisions/route";
import { GET as proofRoute } from "../../app/api/proof/[merchant]/route";
import { ContractPanic } from "../errors";
import { get, makeKit, newKey, post, signIn, type Kit } from "./testkit";

const TIMEOUT = 120_000;

/** The proof route takes the merchant from the path; adapt it to the (req) => Response shape of the harness. */
const proofGET = (req: Request) =>
  proofRoute(req, { params: Promise.resolve({ merchant: new URL(req.url).pathname.split("/").pop()! }) });

function expectErr(r: { status: number; json: { ok: boolean; error?: { code: string } } }, code: ErrorCode, status?: number) {
  expect(r.json.ok).toBe(false);
  expect(r.json.error?.code).toBe(code);
  if (status) expect(r.status).toBe(status);
}

/** Signs in `user`, claims the faucet, returns their account id. */
async function funded(kit: Kit, user: string): Promise<string> {
  const account = await signIn(kit, stateGET, user);
  const r = await post(faucetPOST, "/api/faucet", {}, { user });
  expect(r.json.ok).toBe(true);
  kit.clock.advance(61); // faucet cooldown
  return account;
}

describe("state, accounts and the POST pipeline", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit(); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  it("GET /api/state signed out: world only, matches the shared schema", async () => {
    const r = await get(stateGET, "/api/state");
    expect(r.json.ok).toBe(true);
    const data = StateResponseSchema.parse(r.json.data);
    expect(data.me).toBeNull();
    expect(data.world.merchants.map((m) => m.id)).toEqual(["dasht", "madan", "bandar", "shahr"]);
    expect(data.world.mode).toBe("PLAY");
    expect(data.world.merchants[0]!.quotes.grain.ask).toBe("1040");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("first sign-in creates exactly one custodial account, registered, in bandar", async () => {
    const [a, b] = await Promise.all([get(stateGET, "/api/state", { user: "alice" }), get(stateGET, "/api/state", { user: "alice" })]);
    const acc = a.json.data.me.account_id as string;
    expect(b.json.data.me.account_id).toBe(acc);
    expect(acc).toMatch(/^p[0-9a-f]{8}\.relayer\.fake$/);
    const again = await get(stateGET, "/api/state", { user: "alice" });
    expect(again.json.data.me.account_id).toBe(acc);
    const me = PlayerSchema.parse(again.json.data.me);
    expect(me.location).toBe("bandar");
    expect(me.fils).toBe("0");
    expect(me.display_name).toBe("Alice");
    expect(kit.contract.calls.filter((c) => c.method === "register" && c.account === acc)).toHaveLength(1);
    const users = await kit.db.query("select * from users where near_account_id = $1", [acc]);
    expect(users).toHaveLength(1);
    const custody = await kit.db.query<{ public_key: string }>("select public_key from custody_keys");
    expect(kit.contract.accountKey(acc)).toBe(custody.find((c) => c.public_key === kit.contract.accountKey(acc))?.public_key);
  });

  it("an account creation that fails half way resumes without creating a second account", async () => {
    const orig = kit.contract.playerCall.bind(kit.contract);
    let failed = false;
    kit.contract.playerCall = (async (...args: Parameters<typeof orig>) => {
      if (args[1] === "register" && !failed) {
        failed = true;
        throw new Error("rpc down");
      }
      return orig(...args);
    }) as typeof orig;
    const first = await get(stateGET, "/api/state", { user: "carol" });
    expectErr(first, "INTERNAL", 500);
    const second = await get(stateGET, "/api/state", { user: "carol" });
    expect(second.json.ok).toBe(true);
    const rows = await kit.db.query("select near_account_id from users where display_name = 'Carol'");
    expect(rows).toHaveLength(1);
    expect(kit.contract.hasAccount(second.json.data.me.account_id)).toBe(true);
    kit.contract.playerCall = orig;
  });

  it("UNAUTHENTICATED without a session", async () => {
    expectErr(await post(faucetPOST, "/api/faucet", {}), "UNAUTHENTICATED", 401);
    expectErr(await post(tradePOST, "/api/trade", {}, { user: null }), "UNAUTHENTICATED");
  });

  it("BAD_REQUEST without an Idempotency-Key or with a malformed one", async () => {
    expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "alice", key: null }), "BAD_REQUEST", 400);
    expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "alice", key: "short" }), "BAD_REQUEST");
  });

  it("BAD_REQUEST for invalid bodies (zod), unknown fields and non-JSON", async () => {
    const o = { user: "alice" };
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty: 0, limit_total: "10" }, o), "BAD_REQUEST");
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty: 41, limit_total: "10" }, o), "BAD_REQUEST");
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty: 1, limit_total: 10 }, o), "BAD_REQUEST");
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "gold", side: "buy", qty: 1, limit_total: "10" }, o), "BAD_REQUEST");
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty: 1, limit_total: "10", extra: 1 }, o), "BAD_REQUEST");
    expectErr(await post(tradePOST, "/api/trade", "{not json", o), "BAD_REQUEST");
    expectErr(await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: {}, guards: 4 }, o), "BAD_REQUEST");
    expectErr(await post(stallBuyPOST, "/api/stall/buy", { stall_id: -1, qty: 1, limit_total: "1" }, o), "BAD_REQUEST");
  });

  it("refuses cross-origin POSTs", async () => {
    const r = await post(faucetPOST, "/api/faucet", {}, { user: "alice", headers: { origin: "https://evil.example" } });
    expectErr(r, "BAD_REQUEST", 400);
    expect(r.json.error?.message).toMatch(/cross-origin/i);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("idempotency: same key and body replays the stored response, no second effect", async () => {
    await signIn(kit, stateGET, "dave");
    const key = newKey();
    const first = await post(faucetPOST, "/api/faucet", {}, { user: "dave", key });
    expect(first.json.ok).toBe(true);
    const before = kit.contract.calls.length;
    const replay = await post(faucetPOST, "/api/faucet", {}, { user: "dave", key });
    expect(replay.json).toEqual(first.json);
    expect(replay.headers.get("idempotent-replay")).toBe("true");
    expect(kit.contract.calls.length).toBe(before);
    expect(first.json.data.player.fils).toBe(String(PARAMS.FAUCET_FILS));
  });

  it("idempotency: a stored failure is replayed too, and a key reused for another body is refused", async () => {
    await funded(kit, "erin");
    const key = newKey();
    const body = { merchant: "dasht", good: "grain", side: "buy", qty: 1, limit_total: "99999" };
    const first = await post(tradePOST, "/api/trade", body, { user: "erin", key });
    expectErr(first, "NOT_IN_CITY", 409);
    const replay = await post(tradePOST, "/api/trade", body, { user: "erin", key });
    expect(replay.json).toEqual(first.json);
    const other = await post(tradePOST, "/api/trade", { ...body, qty: 2 }, { user: "erin", key });
    expectErr(other, "BAD_REQUEST");
    expect(other.json.error?.message).toMatch(/Idempotency-Key/);
    const rows = await kit.db.query<{ status: string; error_code: string | null }>("select status, error_code from actions where idempotency_key like '%' || $1", [key]);
    expect(rows).toEqual([{ status: "FAILED", error_code: "NOT_IN_CITY" }]);
  });

  it("idempotency keys are scoped per user", async () => {
    await signIn(kit, stateGET, "frank");
    await signIn(kit, stateGET, "gina");
    const key = newKey();
    expect((await post(faucetPOST, "/api/faucet", {}, { user: "frank", key })).json.ok).toBe(true);
    expect((await post(faucetPOST, "/api/faucet", {}, { user: "gina", key })).json.ok).toBe(true);
  });

  it("a request that is still pending is not executed twice", async () => {
    const acc = await signIn(kit, stateGET, "hank");
    const user = (await kit.svc.repo.getUserByAccount(acc))!;
    const key = newKey();
    const canonicalEmpty = "{}";
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(`faucet\n${canonicalEmpty}`).digest("hex");
    await kit.svc.repo.beginAction({ userId: user.id, kind: "faucet", key, requestJson: canonicalEmpty, requestHash: hash, now: kit.clock.now });
    const r = await post(faucetPOST, "/api/faucet", {}, { user: "hank", key });
    expectErr(r, "RATE_LIMIT");
    expect(kit.contract.calls.filter((c) => c.account === acc && c.method === "faucet")).toHaveLength(0);
  });

  it("RATE_LIMIT after 30 actions per minute per user, and resets next minute", async () => {
    await signIn(kit, stateGET, "ivy");
    const results: string[] = [];
    for (let i = 0; i < 31; i++) {
      const r = await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "ivy" });
      results.push(r.json.ok ? "ok" : r.json.error!.code);
    }
    expect(results.slice(0, 30).every((c) => c === "BAD_REQUEST")).toBe(true); // "no journey" from the contract
    expect(results[30]).toBe("RATE_LIMIT");
    const limited = await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "ivy" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    kit.clock.advance(61);
    expectErr(await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "ivy" }), "BAD_REQUEST");
  });

  it("RATE_LIMIT when the relayer's daily budget is spent", async () => {
    await signIn(kit, stateGET, "jack");
    const day = 86400;
    const start = Math.floor(kit.clock.now / day) * day;
    await kit.db.query("insert into rate_limits (key, window_start, count) values ('relayer:day', $1, 1000) on conflict (key, window_start) do update set count = 1000", [start]);
    expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "jack" }), "RATE_LIMIT");
    await kit.db.query("delete from rate_limits where key = 'relayer:day'");
  });

  it("PAUSED when PAUSE_ALL is set; reads keep working", async () => {
    await signIn(kit, stateGET, "kim");
    await kit.svc.repo.setFlag("PAUSE_ALL", "true");
    expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "kim" }), "PAUSED", 503);
    expect((await get(stateGET, "/api/state", { user: "kim" })).json.ok).toBe(true);
    await kit.svc.repo.setFlag("PAUSE_ALL", "false");
    expect((await post(faucetPOST, "/api/faucet", {}, { user: "kim" })).json.ok).toBe(true);
  });

  it("PAUSED when the contract itself is paused", async () => {
    await signIn(kit, stateGET, "lou");
    await kit.contract.operatorCall("set_paused", { paused: true });
    expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "lou" }), "PAUSED");
    await kit.contract.operatorCall("set_paused", { paused: false });
  });

  it("INTERNAL for unknown panics and infrastructure errors, without leaking details", async () => {
    await signIn(kit, stateGET, "max");
    const orig = kit.contract.playerCall.bind(kit.contract);
    kit.contract.playerCall = (async () => { throw new ContractPanic("wasm trap secret 0xdeadbeef"); }) as typeof orig;
    const a = await post(faucetPOST, "/api/faucet", {}, { user: "max" });
    expectErr(a, "INTERNAL", 500);
    expect(JSON.stringify(a.json)).not.toContain("deadbeef");
    kit.contract.playerCall = (async () => { throw new Error("ECONNRESET 10.0.0.1"); }) as typeof orig;
    const b = await post(faucetPOST, "/api/faucet", {}, { user: "max" });
    expectErr(b, "INTERNAL");
    expect(JSON.stringify(b.json)).not.toContain("10.0.0.1");
    kit.contract.playerCall = orig;
  });

  it("caches the world for one second and the last 20 events are attached", async () => {
    let worldCalls = 0;
    const orig = kit.contract.getWorld.bind(kit.contract);
    kit.contract.getWorld = async () => { worldCalls++; return orig(); };
    kit.clock.advance(5);
    await get(stateGET, "/api/state");
    await get(stateGET, "/api/state");
    expect(worldCalls).toBe(1);
    kit.clock.advance(2);
    const r = await get(stateGET, "/api/state");
    expect(worldCalls).toBe(2);
    expect(r.json.data.events.length).toBeGreaterThan(0);
    expect(r.json.data.events.length).toBeLessThanOrEqual(20);
    StateResponseSchema.parse(r.json.data);
    kit.contract.getWorld = orig;
  });
});

describe("faucet", () => {
  it("PLAY: credits 500 dinars, then RATE_LIMIT during the cooldown", async () => {
    const kit = await makeKit();
    try {
      await signIn(kit, stateGET, "alice");
      const a = await post(faucetPOST, "/api/faucet", {}, { user: "alice" });
      expect(a.json.data.player.fils).toBe("50000");
      expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "alice" }), "RATE_LIMIT", 429);
      kit.clock.advance(61);
      expect((await post(faucetPOST, "/api/faucet", {}, { user: "alice" })).json.data.player.fils).toBe("100000");
    } finally { await kit.close(); }
  }, TIMEOUT);

  it("LIVE: MODE_NOT_ALLOWED", async () => {
    const kit = await makeKit({ mode: "LIVE" });
    try {
      await signIn(kit, stateGET, "alice");
      expectErr(await post(faucetPOST, "/api/faucet", {}, { user: "alice" }), "MODE_NOT_ALLOWED", 403);
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("trade", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit(); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });
  const buy = (user: string, over: Record<string, unknown> = {}) =>
    post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty: 5, limit_total: "1000000", ...over }, { user });

  it("buy: priced with the shared tradeCost at midpoint stock, fee to the house", async () => {
    await funded(kit, "alice");
    const m = await kit.contract.getMerchant("bandar");
    const cost = tradeCost({ good: "grain", side: "buy", qty: 5, merchantStock: m.stock.grain, spreadBp: m.spread_bp, biasBp: m.bias_bp });
    const r = await buy("alice", { limit_total: (cost.total + cost.fee).toString() });
    expect(r.json.ok).toBe(true);
    expect(r.json.data.total).toBe(cost.total.toString());
    expect(r.json.data.fee).toBe(cost.fee.toString());
    const p = PlayerSchema.parse(r.json.data.player);
    expect(p.inventory.grain).toBe(5);
    expect(BigInt(p.fils)).toBe(50000n - cost.total - cost.fee);
    expect((await kit.contract.getMerchant("bandar")).stock.grain).toBe(m.stock.grain - 5);
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("sell: pays total minus fee and conserves money", async () => {
    const m = await kit.contract.getMerchant("bandar");
    const cost = tradeCost({ good: "grain", side: "sell", qty: 5, merchantStock: m.stock.grain, spreadBp: m.spread_bp, biasBp: m.bias_bp });
    const before = BigInt((await get(stateGET, "/api/state", { user: "alice" })).json.data.me.fils);
    const r = await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "sell", qty: 5, limit_total: (cost.total - cost.fee).toString() }, { user: "alice" });
    expect(r.json.ok).toBe(true);
    expect(BigInt(r.json.data.player.fils)).toBe(before + cost.total - cost.fee);
    expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
  });

  it("SLIPPAGE when the limit is below the price (buy and sell)", async () => {
    expectErr(await buy("alice", { limit_total: "1" }), "SLIPPAGE", 409);
    await buy("alice", { qty: 1 });
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "sell", qty: 1, limit_total: "999999" }, { user: "alice" }), "SLIPPAGE");
  });

  it("NOT_IN_CITY for another city's merchant", async () => {
    expectErr(await buy("alice", { merchant: "dasht" }), "NOT_IN_CITY");
  });

  it("INSUFFICIENT_FUNDS for a player without dinars", async () => {
    await signIn(kit, stateGET, "broke");
    expectErr(await buy("broke"), "INSUFFICIENT_FUNDS");
  });

  it("INSUFFICIENT_STOCK when the merchant or the player lacks goods", async () => {
    kit.contract.testSetStock("bandar", "salt", 2);
    expectErr(await buy("alice", { good: "salt", qty: 5 }), "INSUFFICIENT_STOCK");
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "silk", side: "sell", qty: 3, limit_total: "0" }, { user: "alice" }), "INSUFFICIENT_STOCK");
    kit.contract.testSetStock("bandar", "salt", 120);
  });

  it("CARGO_LIMIT above 40 units carried", async () => {
    await funded(kit, "heavy");
    const acc = (await get(stateGET, "/api/state", { user: "heavy" })).json.data.me.account_id;
    kit.contract.testGrantGoods(acc, "iron", 38);
    expectErr(await buy("heavy", { qty: 5 }), "CARGO_LIMIT");
  });

  it("MERCHANT_BROKE when the merchant cannot pay for a sale", async () => {
    const acc = await funded(kit, "seller");
    kit.contract.testGrantGoods(acc, "grain", 5);
    kit.contract.testSetTreasury("bandar", 0n);
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "sell", qty: 5, limit_total: "0" }, { user: "seller" }), "MERCHANT_BROKE");
    kit.contract.testSetTreasury("bandar", 50000n);
  });

  it("BAD_REQUEST 'warehouse full' when a sale would exceed 2x target", async () => {
    const acc = await funded(kit, "dumper");
    kit.contract.testGrantGoods(acc, "silk", 5);
    kit.contract.testSetStock("bandar", "silk", 58);
    expectErr(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "silk", side: "sell", qty: 5, limit_total: "0" }, { user: "dumper" }), "BAD_REQUEST");
    kit.contract.testSetStock("bandar", "silk", 30);
  });

  it("IN_TRANSIT while travelling", async () => {
    await funded(kit, "walker");
    await buy("walker", { qty: 3 });
    const j = await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { grain: 3 }, guards: 0 }, { user: "walker" });
    expect(j.json.ok).toBe(true);
    expectErr(await buy("walker"), "IN_TRANSIT");
  });

  it("merchant quotes follow policy bias in /api/state", async () => {
    kit.contract.testSetPolicy("bandar", 1200, 250);
    kit.clock.advance(2);
    const s = await get(stateGET, "/api/state");
    const b = s.json.data.world.merchants.find((m: { id: string }) => m.id === "bandar");
    expect(b.policy).toEqual({ spread_bp: 1200, bias_bp: 250 });
    StateResponseSchema.parse(s.json.data);
  });
});

describe("journeys", () => {
  it("start with guards, claim too early, claim after arrival (no ambush)", async () => {
    const kit = await makeKit();
    try {
      await funded(kit, "alice");
      await post(tradePOST, "/api/trade", { merchant: "bandar", good: "silk", side: "buy", qty: 2, limit_total: "1000000" }, { user: "alice" });
      const start = await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { silk: 2 }, guards: 1 }, { user: "alice" });
      expect(start.json.ok).toBe(true);
      const j = JourneySchema.parse(start.json.data.journey);
      expect(j.risk_bp).toBe(520); // 800 * 6500 / 10000
      expect(j.status).toBe("IN_TRANSIT");
      expect(j.arrives_at - j.started_at).toBe(180);
      expectErr(await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "alice" }), "NOT_ARRIVED", 409);
      kit.clock.advance(181);
      const s = await get(stateGET, "/api/state", { user: "alice" });
      expect(s.json.data.me.journey.status).toBe("ARRIVED");
      const claim = await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "alice" });
      expect(claim.json.ok).toBe(true);
      expect(claim.json.data.journey.status).toBe("CLAIMED");
      expect(claim.json.data.journey.ambushed).toBe(false);
      expect(claim.json.data.player.location).toBe("shahr");
      expect(claim.json.data.player.inventory.silk).toBe(2);
      expect(claim.json.data.player.journey).toBeNull();
      expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);
    } finally { await kit.close(); }
  }, TIMEOUT);

  it("an ambush destroys floor(30%) of each good", async () => {
    const kit = await makeKit({ contract: { ambushRoll: () => 0 } });
    try {
      const acc = await funded(kit, "alice");
      kit.contract.testGrantGoods(acc, "grain", 11);
      await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { grain: 11 }, guards: 0 }, { user: "alice" });
      kit.clock.advance(181);
      const claim = await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "alice" });
      expect(claim.json.data.journey.ambushed).toBe(true);
      expect(claim.json.data.journey.lost).toEqual({ grain: 3 });
      expect(claim.json.data.player.inventory.grain).toBe(8);
    } finally { await kit.close(); }
  }, TIMEOUT);

  it("error paths: empty cargo, same city, cargo not owned, over capacity, guard money, no journey", async () => {
    const kit = await makeKit();
    try {
      const acc = await funded(kit, "alice");
      const go = (body: unknown) => post(journeyStartPOST, "/api/journey/start", body, { user: "alice" });
      expectErr(await go({ to: "shahr", cargo: {}, guards: 0 }), "BAD_REQUEST");
      expectErr(await go({ to: "bandar", cargo: { grain: 1 }, guards: 0 }), "BAD_REQUEST");
      expectErr(await go({ to: "shahr", cargo: { grain: 1 }, guards: 0 }), "INSUFFICIENT_STOCK");
      kit.contract.testGrantGoods(acc, "grain", 41);
      expectErr(await go({ to: "shahr", cargo: { grain: 41 }, guards: 0 }), "CARGO_LIMIT");
      kit.contract.testGrantGoods(acc, "silk", 3);
      await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "sell", qty: 40, limit_total: "0" }, { user: "alice" }).catch(() => undefined);
      const poor = await funded(kit, "poor");
      kit.contract.testGrantGoods(poor, "silk", 30);
      await post(tradePOST, "/api/trade", { merchant: "bandar", good: "silk", side: "sell", qty: 1, limit_total: "0" }, { user: "poor" });
      // spend nearly everything, then ask for guards that cost more than the balance
      kit.contract.testGrantFils(poor, -BigInt(await balance(kit, "poor")) + 1n);
      expectErr(await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { silk: 29 }, guards: 3 }, { user: "poor" }), "INSUFFICIENT_FUNDS");
      expectErr(await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "poor" }), "BAD_REQUEST");
    } finally { await kit.close(); }
  }, TIMEOUT);
});

async function balance(kit: Kit, user: string): Promise<string> {
  return (await get(stateGET, "/api/state", { user })).json.data.me.fils;
}

describe("stalls", () => {
  it("create, buy (buyer pays the 2% fee on top), cancel, and every error path", async () => {
    const kit = await makeKit();
    try {
      const alice = await funded(kit, "alice");
      const bob = await funded(kit, "bob");
      kit.contract.testGrantGoods(alice, "salt", 10);

      const created = await post(stallCreatePOST, "/api/stall/create", { good: "salt", qty: 10, unit_price: "2000" }, { user: "alice" });
      expect(created.json.ok).toBe(true);
      const stall = created.json.data.stall;
      expect(stall).toMatchObject({ seller: alice, city: "bandar", good: "salt", qty: 10, unit_price: "2000" });
      kit.clock.advance(2);
      expect((await get(stateGET, "/api/state")).json.data.world.stalls).toHaveLength(1);

      expectErr(await post(stallCreatePOST, "/api/stall/create", { good: "silk", qty: 1, unit_price: "1" }, { user: "alice" }), "INSUFFICIENT_STOCK");

      const buyBody = (over: Record<string, unknown> = {}) => ({ stall_id: stall.id, qty: 4, limit_total: "8160", ...over });
      expectErr(await post(stallBuyPOST, "/api/stall/buy", buyBody(), { user: "alice" }), "BAD_REQUEST"); // own stall
      expectErr(await post(stallBuyPOST, "/api/stall/buy", buyBody({ stall_id: 999 }), { user: "bob" }), "BAD_REQUEST");
      expectErr(await post(stallBuyPOST, "/api/stall/buy", buyBody({ limit_total: "8159" }), { user: "bob" }), "SLIPPAGE");
      expectErr(await post(stallBuyPOST, "/api/stall/buy", buyBody({ qty: 11, limit_total: "99999" }), { user: "bob" }), "INSUFFICIENT_STOCK");
      kit.contract.testSetLocation(bob, "shahr");
      expectErr(await post(stallBuyPOST, "/api/stall/buy", buyBody(), { user: "bob" }), "NOT_IN_CITY");
      kit.contract.testSetLocation(bob, "bandar");

      const aliceBefore = BigInt(await balance(kit, "alice"));
      const bobBefore = BigInt(await balance(kit, "bob"));
      const bought = await post(stallBuyPOST, "/api/stall/buy", buyBody(), { user: "bob" });
      expect(bought.json.ok).toBe(true);
      expect(bought.json.data.player.inventory.salt).toBe(4);
      expect(BigInt(bought.json.data.player.fils)).toBe(bobBefore - 8000n - 160n);
      expect(BigInt(await balance(kit, "alice"))).toBe(aliceBefore + 8000n);
      expect(kit.contract.audit().total).toBe(kit.contract.audit().expected);

      expectErr(await post(stallCancelPOST, "/api/stall/cancel", { stall_id: stall.id }, { user: "bob" }), "BAD_REQUEST");
      const cancelled = await post(stallCancelPOST, "/api/stall/cancel", { stall_id: stall.id }, { user: "alice" });
      expect(cancelled.json.data.player.inventory.salt).toBe(6);
      expectErr(await post(stallCancelPOST, "/api/stall/cancel", { stall_id: stall.id }, { user: "alice" }), "BAD_REQUEST");

      // INSUFFICIENT_FUNDS and CARGO_LIMIT
      kit.contract.testGrantGoods(alice, "salt", 4);
      const s2 = (await post(stallCreatePOST, "/api/stall/create", { good: "salt", qty: 10, unit_price: "9999999" }, { user: "alice" })).json.data.stall;
      expectErr(await post(stallBuyPOST, "/api/stall/buy", { stall_id: s2.id, qty: 1, limit_total: "99999999" }, { user: "bob" }), "INSUFFICIENT_FUNDS");
      kit.contract.testGrantGoods(bob, "iron", 37);
      expectErr(await post(stallBuyPOST, "/api/stall/buy", { stall_id: s2.id, qty: 1, limit_total: "99999999" }, { user: "bob" }), "CARGO_LIMIT");
    } finally { await kit.close(); }
  }, TIMEOUT);

  it("IN_TRANSIT blocks stall actions", async () => {
    const kit = await makeKit();
    try {
      const alice = await funded(kit, "alice");
      kit.contract.testGrantGoods(alice, "grain", 5);
      await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { grain: 3 }, guards: 0 }, { user: "alice" });
      expectErr(await post(stallCreatePOST, "/api/stall/create", { good: "grain", qty: 1, unit_price: "1" }, { user: "alice" }), "IN_TRANSIT");
    } finally { await kit.close(); }
  }, TIMEOUT);
});

describe("leaderboard, NPC decisions and proof", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit(); }, TIMEOUT);
  afterAll(async () => { await kit.close(); });

  it("leaderboard is public, sorted by net worth, with display names only", async () => {
    const a = await funded(kit, "alice");
    await funded(kit, "bob");
    kit.contract.testGrantFils(a, 70000n);
    kit.clock.advance(6);
    const r = await get(leaderboardGET, "/api/leaderboard");
    expect(r.json.ok).toBe(true);
    expect(r.json.data.rows).toEqual([
      { name: "Alice", net_worth: "120000" },
      { name: "Bob", net_worth: "50000" },
    ]);
    expect(JSON.stringify(r.json)).not.toMatch(/\.fake|ed25519/);
  });

  it("npc decisions and proof come from the database; unknown merchants are BAD_REQUEST", async () => {
    expect((await get(proofGET, "/api/proof/dasht")).json).toEqual({ ok: true, data: null });
    const decision = {
      merchant: "dasht", ts: kit.clock.now - 10, spread_bp: 900, bias_bp: -200, mood: "generous", ship: null,
      line: { en: "Fresh grain, friend!", fa: "گندم تازه!" }, reason: "Stock is high.", source: "llm",
      model: "test-model", request_id: "req-1", attested: false, tx_hashes: [],
    };
    await kit.svc.repo.insertDecision({
      merchant: "dasht", ts: decision.ts, input_hash: "h", output_json: JSON.stringify(decision), model: "test-model",
      request_id: "req-1", attested: false, source: "llm", tx_hashes: ["tx1"],
    });
    const d = await get(decisionsGET, "/api/npc/decisions", { query: "?merchant=dasht" });
    expect(d.json.data.rows).toHaveLength(1);
    expect(d.json.data.rows[0]).toMatchObject({ merchant: "dasht", mood: "generous", tx_hashes: ["tx1"] });
    expect((await get(decisionsGET, "/api/npc/decisions", { query: "?merchant=madan" })).json.data.rows).toEqual([]);
    expect((await get(decisionsGET, "/api/npc/decisions")).json.data.rows).toHaveLength(1);
    expectErr(await get(decisionsGET, "/api/npc/decisions", { query: "?merchant=atlantis" }), "BAD_REQUEST");

    const p = await get(proofGET, "/api/proof/dasht");
    expect(p.json.data).toEqual({ model: "test-model", request_id: "req-1", attested: false, at: decision.ts });
    expectErr(await get(proofGET, "/api/proof/atlantis"), "BAD_REQUEST");

    kit.clock.advance(2);
    const s = await get(stateGET, "/api/state");
    const dasht = s.json.data.world.merchants.find((m: { id: string }) => m.id === "dasht");
    expect(dasht.mood).toBe("generous");
    expect(dasht.last_line.en).toBe("Fresh grain, friend!");
    expect(dasht.verified).toMatchObject({ model: "test-model", attested: false });
    StateResponseSchema.parse(s.json.data);
  });
});
