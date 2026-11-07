// In-memory mock of the server API (NEXT_PUBLIC_MOCK=1). Serves the fixtures and advances a
// simulated world: every `tickSeconds` (default 5) it nudges stock and rebuilds quotes.
// Rules here are the ones written in spec/ECONOMY.md; gaps are marked "OPEN_QUESTIONS #n" and are
// listed in spec/OPEN_QUESTIONS.md. This is not the contract: it only has to feel alive.

import type {
  ApiClient, ClaimData, DecisionsData, DepositQuoteData, DepositStatusData, JourneyData, LeaderboardData,
  PlayerData, StallData, StateData, TokenInfo, TokensData, TradeData, WithdrawData,
} from "./api-client.js";
import {
  decisionsFixture, eventsFixture, leaderboardFixture, playersFixture, worldFixture,
} from "./fixtures.js";
import { netWorthFils, quote, tradeCost } from "./quote.js";
import type { Event } from "./provisional.js";
import type { ZodType } from "zod";
import {
  JourneyStartRequestSchema, StallBuyRequestSchema, StallCancelRequestSchema, StallCreateRequestSchema,
  TradeRequestSchema,
} from "./schemas.js";
import type { ApiResult, CityId, ErrorCode, GoodId, Journey, Merchant, Player, Stall, WorldState } from "./types.js";
import { BP, CITIES, CITY_IDS, GOODS, GOOD_IDS, PARAMS, findRoute } from "./world.js";

export interface MockOptions {
  /** Clock in unix seconds (injectable for tests). */
  now?: () => number;
  /** Seconds between mock ticks. Default 5. */
  tickSeconds?: number;
  /** Seed for ambush rolls. */
  seed?: number;
}

const MOCK_FAUCET_COOLDOWN_SECONDS = 60; // OPEN_QUESTIONS #4: the spec gives no interval.
const MAX_EVENTS = 100;

/** Sample asset list for the mock and the Cash preview. The ids are made up; the real ones come from GET /api/tokens. */
export const MOCK_TOKENS: readonly TokenInfo[] = [
  { id: "usdc-near", symbol: "USDC", chain: "near", decimals: 6 },
  { id: "usdc-base", symbol: "USDC", chain: "base", decimals: 6 },
  { id: "usdc-eth", symbol: "USDC", chain: "eth", decimals: 6 },
  { id: "usdc-sol", symbol: "USDC", chain: "sol", decimals: 6 },
  { id: "near", symbol: "NEAR", chain: "near", decimals: 24 },
  { id: "eth", symbol: "ETH", chain: "eth", decimals: 18 },
  { id: "btc", symbol: "BTC", chain: "btc", decimals: 8 },
];
const ME_ACCOUNT = "mock.player";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clone = <T>(v: T): T => structuredClone(v);
const fail = <T = never>(code: ErrorCode, message: string): ApiResult<T> => ({ ok: false, error: { code, message } });
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });

function parse<T>(schema: ZodType<T>, body: unknown): { value: T } | { error: ApiResult<never> } {
  const r = schema.safeParse(body);
  if (r.success) return { value: r.data };
  return { error: fail("BAD_REQUEST", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) };
}

export function createMockApiClient(options: MockOptions = {}): ApiClient {
  const clock = options.now ?? (() => Math.floor(Date.now() / 1000));
  const tickSeconds = options.tickSeconds ?? 5;
  const rand = mulberry32(options.seed ?? 1);

  const start = clock();
  const shift = start - worldFixture.now;
  const world: WorldState = { ...clone(worldFixture), now: start, mode: "PLAY" };
  for (const m of world.merchants) if (m.verified) m.verified.at += shift;
  const events: Event[] = clone(eventsFixture).map((e) => ({ ...e, at: e.at + shift }));
  const decisions = clone(decisionsFixture).map((d) => ({ ...d, ts: d.ts + shift }));

  const me: Player = { ...clone(playersFixture.newPlayerInBandar), account_id: ME_ACCOUNT };
  let house = 0n;
  const sellerBalances = new Map<string, bigint>(); // other sellers are not tracked elsewhere; keeps money conserved
  let lastTickAt = start;
  let lastFaucetAt = -Infinity;
  let nextEventId = Math.max(0, ...events.map((e) => e.id)) + 1;
  let nextStallId = Math.max(0, ...world.stalls.map((s) => s.id)) + 1;
  let nextJourneyId = 1000;
  const flowAcc = new Map<string, number>(); // "city:good" -> accumulated flow * tickSeconds

  const merchantAt = (city: CityId): Merchant => world.merchants.find((m) => m.id === city)!;

  function requote(m: Merchant): void {
    for (const g of GOOD_IDS) {
      m.quotes[g] = quote({ good: g, stock: m.stock[g], spreadBp: m.policy.spread_bp, biasBp: m.policy.bias_bp });
    }
  }

  function emit(type: Event["type"], data: Record<string, unknown>): void {
    events.push({ id: nextEventId++, type, at: world.now, data });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  function refreshNetWorth(): void {
    me.net_worth = netWorthFils(BigInt(me.fils), me.inventory).toString();
  }

  function mockTick(): void {
    world.tick += 1;
    // Only rule 1 of spec/ECONOMY.md section 2.8 (production and consumption), as a fraction of a tick.
    for (const city of CITY_IDS) {
      const m = merchantAt(city);
      for (const g of GOOD_IDS) {
        const flow = (CITIES[city].produces[g] ?? 0) - (CITIES[city].consumes[g] ?? 0);
        const key = `${city}:${g}`;
        let acc = (flowAcc.get(key) ?? 0) + flow * tickSeconds;
        const delta = Math.trunc(acc / PARAMS.TICK_SECONDS);
        acc -= delta * PARAMS.TICK_SECONDS;
        flowAcc.set(key, acc);
        m.stock[g] = Math.min(GOODS[g].cap, Math.max(0, m.stock[g] + delta));
      }
      requote(m);
    }
    emit("tick", { tick: world.tick });
  }

  function advance(): void {
    const now = clock();
    world.now = now;
    while (now - lastTickAt >= tickSeconds) {
      lastTickAt += tickSeconds;
      mockTick();
    }
    if (me.journey && me.journey.status === "IN_TRANSIT" && now >= me.journey.arrives_at) {
      me.journey.status = "ARRIVED";
    }
  }

  const cargoUnits = (inv: Partial<Record<GoodId, number>>) =>
    Object.values(inv).reduce<number>((s, n) => s + (n ?? 0), 0);

  function blockedByJourney(): ApiResult<never> | null {
    return me.journey ? fail("IN_TRANSIT", "Claim or finish your journey first.") : null;
  }

  async function wrap<T>(f: () => ApiResult<T>): Promise<ApiResult<T>> {
    advance();
    const r = f();
    refreshNetWorth();
    return clone(r);
  }

  return {
    getState: () =>
      wrap<StateData>(() => ok({ world: clone(world), me: clone(me), events: clone(events.slice(-20)) })),

    trade: (body) =>
      wrap<TradeData>(() => {
        const p = parse(TradeRequestSchema, body);
        if ("error" in p) return p.error;
        const req = p.value;
        const blocked = blockedByJourney();
        if (blocked) return blocked;
        if (req.merchant !== me.location) return fail("NOT_IN_CITY", "You are not in that city.");
        const m = merchantAt(req.merchant);
        const cost = tradeCost({
          good: req.good, side: req.side, qty: req.qty, merchantStock: m.stock[req.good],
          spreadBp: m.policy.spread_bp, biasBp: m.policy.bias_bp,
        });
        const limit = BigInt(req.limit_total);
        const fils = BigInt(me.fils);
        if (req.side === "buy") {
          if (m.stock[req.good] < req.qty) return fail("INSUFFICIENT_STOCK", "The merchant does not have that much.");
          if (cargoUnits(me.inventory) + req.qty > PARAMS.CARGO_CAP) return fail("CARGO_LIMIT", "Caravan is full.");
          const pay = cost.total + cost.fee;
          if (pay > limit) return fail("SLIPPAGE", "The price moved.");
          if (pay > fils) return fail("INSUFFICIENT_FUNDS", "Not enough coins.");
          me.fils = (fils - pay).toString();
          me.inventory[req.good] += req.qty;
          m.stock[req.good] -= req.qty;
          m.treasury = (BigInt(m.treasury) + cost.total).toString();
          house += cost.fee;
        } else {
          if (me.inventory[req.good] < req.qty) return fail("INSUFFICIENT_STOCK", "You do not have that much.");
          if (m.stock[req.good] + req.qty > GOODS[req.good].cap) return fail("BAD_REQUEST", "warehouse full");
          if (BigInt(m.treasury) < cost.total) return fail("MERCHANT_BROKE", "The merchant cannot afford it.");
          const gain = cost.total - cost.fee;
          if (gain < limit) return fail("SLIPPAGE", "The price moved.");
          me.fils = (fils + gain).toString();
          me.inventory[req.good] -= req.qty;
          m.stock[req.good] += req.qty;
          m.treasury = (BigInt(m.treasury) - cost.total).toString();
          house += cost.fee;
        }
        requote(m);
        emit("trade", {
          merchant: req.merchant, good: req.good, side: req.side, qty: req.qty,
          total: cost.total.toString(), fee: cost.fee.toString(),
        });
        return ok({ player: clone(me), total: cost.total.toString(), fee: cost.fee.toString() });
      }),

    journeyStart: (body) =>
      wrap<JourneyData>(() => {
        const p = parse(JourneyStartRequestSchema, body);
        if ("error" in p) return p.error;
        const req = p.value;
        const blocked = blockedByJourney();
        if (blocked) return blocked;
        if (req.to === me.location) return fail("BAD_REQUEST", "You are already there.");
        const route = findRoute(me.location, req.to)!;
        const cargo: Partial<Record<GoodId, number>> = {};
        let baseValue = 0n;
        for (const g of GOOD_IDS) {
          const n = req.cargo[g] ?? 0;
          if (n <= 0) continue;
          if (me.inventory[g] < n) return fail("INSUFFICIENT_STOCK", `You do not have ${n} ${g}.`);
          cargo[g] = n;
          baseValue += GOODS[g].baseFils * BigInt(n);
        }
        const units = cargoUnits(cargo);
        if (units === 0) return fail("BAD_REQUEST", "Cargo is empty.");
        if (units > PARAMS.CARGO_CAP) return fail("CARGO_LIMIT", "Caravan is full.");
        // Spec 2.4: risk = base_risk_bp x 6500^g / 10000^g (truncated step by step); cost = guards x 2% of cargo base value.
        let risk = BigInt(route.riskBp);
        for (let i = 0; i < req.guards; i++) risk = (risk * BigInt(PARAMS.GUARD_RISK_FACTOR_BP)) / BP;
        const guardCost = (baseValue * BigInt(PARAMS.GUARD_COST_BP) * BigInt(req.guards)) / BP;
        if (guardCost > BigInt(me.fils)) return fail("INSUFFICIENT_FUNDS", "Not enough coins for guards.");
        me.fils = (BigInt(me.fils) - guardCost).toString();
        house += guardCost;
        for (const [g, n] of Object.entries(cargo) as Array<[GoodId, number]>) me.inventory[g] -= n;
        const journey: Journey = {
          id: nextJourneyId++, from: me.location, to: req.to, cargo, guards: req.guards,
          started_at: world.now, arrives_at: world.now + route.durationSec, risk_bp: Number(risk), status: "IN_TRANSIT",
        };
        me.journey = journey;
        emit("journey_started", { account_id: me.account_id, from: journey.from, to: journey.to, guards: journey.guards });
        return ok({ journey: clone(journey) });
      }),

    journeyClaim: () =>
      wrap<ClaimData>(() => {
        const j = me.journey;
        if (!j) return fail("BAD_REQUEST", "You have no journey.");
        if (world.now < j.arrives_at) return fail("NOT_ARRIVED", "The caravan has not arrived yet.");
        // OPEN_QUESTIONS #6: ambush roll from the mock PRNG; each good loses trunc(qty x 30%) per spec 2.4 text.
        const ambushed = Math.floor(rand() * 10000) < j.risk_bp;
        const lost: Partial<Record<GoodId, number>> = {};
        for (const [g, n] of Object.entries(j.cargo) as Array<[GoodId, number]>) {
          const l = ambushed ? Number((BigInt(n) * BigInt(PARAMS.AMBUSH_LOSS_BP)) / BP) : 0;
          if (l > 0) lost[g] = l;
          me.inventory[g] += n - l;
        }
        const done: Journey = { ...j, status: "CLAIMED", ambushed, ...(ambushed ? { lost } : {}) };
        me.location = j.to;
        me.journey = null;
        emit("journey_claimed", { account_id: me.account_id, ambushed, lost });
        return ok({ journey: clone(done), player: clone(me) });
      }),

    stallCreate: (body) =>
      wrap<StallData>(() => {
        const p = parse(StallCreateRequestSchema, body);
        if ("error" in p) return p.error;
        const req = p.value;
        const blocked = blockedByJourney();
        if (blocked) return blocked;
        if (me.inventory[req.good] < req.qty) return fail("INSUFFICIENT_STOCK", "You do not have that much.");
        me.inventory[req.good] -= req.qty;
        const stall: Stall = {
          id: nextStallId++, seller: me.account_id, city: me.location, good: req.good, qty: req.qty, unit_price: req.unit_price,
        };
        world.stalls.push(stall);
        emit("stall_create", { seller: stall.seller, city: stall.city, good: stall.good, qty: stall.qty, unit_price: stall.unit_price });
        return ok({ stall: clone(stall) });
      }),

    stallBuy: (body) =>
      wrap<PlayerData>(() => {
        const p = parse(StallBuyRequestSchema, body);
        if ("error" in p) return p.error;
        const req = p.value;
        const blocked = blockedByJourney();
        if (blocked) return blocked;
        const stall = world.stalls.find((s) => s.id === req.stall_id);
        if (!stall) return fail("BAD_REQUEST", "No such stall.");
        if (stall.seller === me.account_id) return fail("BAD_REQUEST", "That is your own stall.");
        if (stall.city !== me.location) return fail("NOT_IN_CITY", "You are not in that city.");
        if (stall.qty < req.qty) return fail("INSUFFICIENT_STOCK", "The stall does not have that much.");
        if (cargoUnits(me.inventory) + req.qty > PARAMS.CARGO_CAP) return fail("CARGO_LIMIT", "Caravan is full.");
        const price = BigInt(req.qty) * BigInt(stall.unit_price);
        // Contract rule (contracts/caravan DECISIONS.md, plan 5.3): the SELLER pays the 2% fee, rounded up, min 1.
        let fee = (price * BigInt(PARAMS.STALL_FEE_BP) + BP - 1n) / BP;
        if (fee < 1n) fee = 1n;
        if (price > BigInt(req.limit_total)) return fail("SLIPPAGE", "The price moved.");
        if (price > BigInt(me.fils)) return fail("INSUFFICIENT_FUNDS", "Not enough coins.");
        me.fils = (BigInt(me.fils) - price).toString();
        me.inventory[stall.good] += req.qty;
        stall.qty -= req.qty;
        if (stall.qty === 0) world.stalls.splice(world.stalls.indexOf(stall), 1);
        sellerBalances.set(stall.seller, (sellerBalances.get(stall.seller) ?? 0n) + price - fee);
        house += fee;
        emit("stall_buy", { stall_id: req.stall_id, buyer: me.account_id, qty: req.qty, total: price.toString(), fee: fee.toString() });
        return ok({ player: clone(me) });
      }),

    stallCancel: (body) =>
      wrap<PlayerData>(() => {
        const p = parse(StallCancelRequestSchema, body);
        if ("error" in p) return p.error;
        const stall = world.stalls.find((s) => s.id === p.value.stall_id);
        if (!stall || stall.seller !== me.account_id) return fail("BAD_REQUEST", "No such stall of yours.");
        me.inventory[stall.good] += stall.qty;
        world.stalls.splice(world.stalls.indexOf(stall), 1);
        emit("stall_cancel", { stall_id: stall.id, seller: me.account_id });
        return ok({ player: clone(me) });
      }),

    faucet: () =>
      wrap<PlayerData>(() => {
        if (world.mode !== "PLAY") return fail("MODE_NOT_ALLOWED", "The faucet only works in PLAY mode.");
        if (world.now - lastFaucetAt < MOCK_FAUCET_COOLDOWN_SECONDS) return fail("RATE_LIMIT", "Try again in a minute.");
        lastFaucetAt = world.now;
        me.fils = (BigInt(me.fils) + BigInt(PARAMS.FAUCET_FILS)).toString();
        emit("faucet", { account_id: me.account_id, fils: String(PARAMS.FAUCET_FILS) });
        return ok({ player: clone(me) });
      }),

    // Deposits and withdrawals need Intents, which exists only in LIVE; the mock runs PLAY.
    // Static sample list (the ids are NOT real 1Click ids) so the Cash screen and its ?live=1 preview have something to show.
    tokens: () => wrap<TokensData>(() => ok({ assets: MOCK_TOKENS.map((t) => ({ ...t })) })),
    depositQuote: () => wrap<DepositQuoteData>(() => fail("MODE_NOT_ALLOWED", "Deposits are only available in LIVE mode.")),
    depositStatus: () => wrap<DepositStatusData>(() => fail("MODE_NOT_ALLOWED", "Deposits are only available in LIVE mode.")),
    withdraw: () => wrap<WithdrawData>(() => fail("MODE_NOT_ALLOWED", "Withdrawals are only available in LIVE mode.")),

    leaderboard: () =>
      wrap<LeaderboardData>(() => {
        const rows = leaderboardFixture.rows.filter((r) => r.name !== me.display_name);
        rows.push({ name: me.display_name, net_worth: me.net_worth });
        rows.sort((a, b) => (BigInt(b.net_worth) > BigInt(a.net_worth) ? 1 : BigInt(b.net_worth) < BigInt(a.net_worth) ? -1 : 0));
        return ok({ rows });
      }),

    npcDecisions: (merchant) =>
      wrap<DecisionsData>(() => ok({ rows: decisions.filter((d) => !merchant || d.merchant === merchant) })),

    // ASSUMPTION(A18): no defined shape; the merchant's latest verification record.
    proof: (merchant) => wrap(() => ok(merchantAt(merchant).verified)),
  };
}
