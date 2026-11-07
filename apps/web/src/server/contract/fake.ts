// In-memory ContractClient that follows spec/ECONOMY.md with the shared quote()/tradeCost(), so the
// whole server is testable offline. It is NOT the contract: where the spec leaves a gap
// (spec/OPEN_QUESTIONS.md) it takes the provisional behaviour used by packages/shared/src/mock.ts
// (OPEN_QUESTIONS #6 floor ambush loss, #7 limit_total semantics, #8 stall fee on top).

import { createHash } from "node:crypto";
import {
  BP, CITIES, CITY_IDS, GOODS, GOOD_IDS, PARAMS, TICK_RULES, findRoute, quote, quoteBig, tradeCost,
  type CityId, type GoodId, type Mode,
} from "@caravan/shared";
import { ContractPanic } from "../errors";
import {
  nsToSec, secToNs,
  type ContractClient, type ContractConfig, type ContractEvent, type ContractJourney, type ContractMerchant,
  type ContractPlayer, type ContractStall, type ContractWithdraw, type ContractWorld, type OperatorArgs,
  type OperatorMethod, type PlayerArgs, type PlayerKey, type PlayerMethod, type TxOutcome,
} from "./types";

export interface FakeContractOptions {
  mode?: Mode;
  /** Clock in unix seconds. */
  now?: () => number;
  /** Returns the ambush roll in 0..9999 for a claim; ambush happens when roll < risk_bp. */
  ambushRoll?: (journey: ContractJourney) => number;
  faucetCooldownSeconds?: number;
  /**
   * Follow contracts/caravan/DECISIONS.md instead of the provisional rules of packages/shared/src/mock.ts:
   * faucet needs net worth < 5,000 fils with a 1 h cooldown (D4), the stall SELLER pays a ceil 2% fee and must be
   * in the city (D5, D6), max 5 open stalls, withdrawals of at least 1,000 fils with one open per player (D14),
   * tick order production -> rebalancing -> recycling without automatic shipping, merchants ship themselves (D2, D25),
   * policy steps of at most 300 bp (D24), tick schedule that advances by whole ticks (D13), a hash-based ambush roll (D12).
   * Off by default so the older tests keep their rules.
   */
  strict?: boolean;
  /** World tick length in seconds (default 60). The minimum call spacing scales with it (55/60). */
  tickSeconds?: number;
  /** Called after every state change (the dev backend persists a snapshot). */
  onChange?: () => void;
}

interface FPlayer {
  account_id: string;
  fils: bigint;
  location: CityId;
  inventory: Record<GoodId, number>;
  journey: ContractJourney | null;
  total_deposited: bigint;
  last_faucet: number;
}

interface FMerchant {
  id: CityId;
  account_id: string;
  treasury: bigint;
  stock: Record<GoodId, number>;
  spread_bp: number;
  bias_bp: number;
}

interface FWithdraw { id: number; account_id: string; fils: bigint; dest_asset: string; dest_address: string; status: "PENDING" | "SENT" | "DONE" | "REFUNDED"; day: number }

const zeroGoods = (): Record<GoodId, number> => ({ grain: 0, salt: 0, iron: 0, spice: 0, silk: 0 });
const DAY = 86400;
const MAX_EVENTS = 200;

const panic = (code: string, msg: string): never => {
  throw new ContractPanic(`${code}: ${msg}`);
};

export class FakeContract implements ContractClient {
  readonly mode: Mode;
  private readonly clock: () => number;
  private readonly roll: (j: ContractJourney) => number;
  private readonly faucetCooldown: number;
  private readonly strict: boolean;
  private readonly tickSeconds: number;
  private readonly onChange: (() => void) | undefined;
  /** Merchant policy / shipping bookkeeping (strict rules D24, D25). */
  private lastPolicyAt = new Map<CityId, number>();
  private lastPolicyTick = new Map<CityId, number>();
  private shipBudget = new Map<CityId, bigint>();
  private shippedThisTick = new Set<string>();

  tick = 0;
  lastTickAt: number;
  paused = false;
  house = 0n;
  /** Money created by the faucet and by credited deposits, minus withdrawals marked as sent (for audit()). */
  private minted = 0n;
  private burned = 0n;

  private merchants = new Map<CityId, FMerchant>();
  private players = new Map<string, FPlayer>();
  private stalls: ContractStall[] = [];
  private withdraws = new Map<number, FWithdraw>();
  private depositRefs = new Set<string>();
  private accountKeys = new Map<string, string>();
  private balances = new Map<string, bigint>();
  private events: ContractEvent[] = [];
  private nextEventId = 1;
  private nextJourneyId = 1;
  private nextStallId = 1;
  private nextWithdrawId = 1;
  private nextTx = 1;

  /** Mimics a relayed delegate call whose top-level outcome carries no return value (NearContract before the fix). */
  testNullReturns = false;

  /** Every playerCall/operatorCall made, for assertions (never contains keys). */
  readonly calls: Array<{ kind: "player" | "operator" | "tick"; account?: string; method: string; args: unknown }> = [];

  constructor(opts: FakeContractOptions = {}) {
    this.mode = opts.mode ?? "PLAY";
    this.clock = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.strict = opts.strict ?? false;
    this.tickSeconds = opts.tickSeconds ?? PARAMS.TICK_SECONDS;
    this.onChange = opts.onChange;
    this.roll = opts.ambushRoll ?? (this.strict ? hashRoll : () => 9999);
    this.faucetCooldown = opts.faucetCooldownSeconds ?? (this.strict ? 3600 : 60);
    this.lastTickAt = this.clock();
    for (const id of CITY_IDS) {
      const stock = zeroGoods();
      for (const g of GOOD_IDS) stock[g] = GOODS[g].target;
      this.merchants.set(id, {
        id, account_id: `${id}.merchant.fake`, treasury: BigInt(PARAMS.MERCHANT_TREASURY_FILS), stock,
        spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0,
      });
    }
  }

  // ---------------------------------------------------------------- test helpers

  testSetStock(city: CityId, good: GoodId, qty: number): void { this.merchants.get(city)!.stock[good] = qty; }
  testSetTreasury(city: CityId, fils: bigint): void { this.merchants.get(city)!.treasury = fils; }
  testSetPolicy(city: CityId, spread_bp: number, bias_bp: number): void {
    const m = this.merchants.get(city)!;
    m.spread_bp = spread_bp;
    m.bias_bp = bias_bp;
  }
  testSetBalance(accountId: string, yocto: bigint): void { this.balances.set(accountId, yocto); }
  testGrantFils(accountId: string, fils: bigint): void {
    this.mustPlayer(accountId).fils += fils;
    this.minted += fils;
  }
  testGrantGoods(accountId: string, good: GoodId, qty: number): void { this.mustPlayer(accountId).inventory[good] += qty; }
  testSetLocation(accountId: string, city: CityId): void { this.mustPlayer(accountId).location = city; }
  hasAccount(accountId: string): boolean { return this.accountKeys.has(accountId); }
  accountKey(accountId: string): string | undefined { return this.accountKeys.get(accountId); }

  /** Money conservation check: everything that exists must equal what was minted minus what left. */
  audit(): { total: bigint; expected: bigint } {
    let total = this.house;
    for (const m of this.merchants.values()) total += m.treasury;
    for (const p of this.players.values()) total += p.fils;
    for (const w of this.withdraws.values()) if (w.status === "PENDING" || w.status === "SENT") total += w.fils; // escrow
    const initial = BigInt(PARAMS.MERCHANT_TREASURY_FILS) * BigInt(CITY_IDS.length);
    return { total, expected: initial + this.minted - this.burned };
  }

  // ---------------------------------------------------------------- views

  private mustPlayer(accountId: string): FPlayer {
    const p = this.players.get(accountId);
    if (!p) return panic("BAD_REQUEST", "player not registered");
    return p;
  }

  private viewMerchant(m: FMerchant): ContractMerchant {
    return { id: m.id, account_id: m.account_id, treasury: m.treasury.toString(), stock: { ...m.stock }, spread_bp: m.spread_bp, bias_bp: m.bias_bp };
  }

  private viewPlayer(p: FPlayer): ContractPlayer {
    return {
      account_id: p.account_id, fils: p.fils.toString(), location: p.location, inventory: { ...p.inventory },
      journey: p.journey ? structuredClone(p.journey) : null, total_deposited: p.total_deposited.toString(),
    };
  }

  async getWorld(): Promise<ContractWorld> {
    return {
      tick: this.tick, now_ns: secToNs(this.clock()), mode: this.mode, paused: this.paused, house: this.house.toString(),
      merchants: CITY_IDS.map((c) => this.viewMerchant(this.merchants.get(c)!)),
      stalls: structuredClone(this.stalls), player_count: this.players.size, stall_count: this.stalls.length,
    };
  }
  async getPlayerCount(): Promise<number> { return this.players.size; }
  async getPlayer(accountId: string): Promise<ContractPlayer | null> {
    const p = this.players.get(accountId);
    return p ? this.viewPlayer(p) : null;
  }
  async getPlayers(fromIndex: number, limit: number): Promise<ContractPlayer[]> {
    return [...this.players.values()].slice(fromIndex, fromIndex + limit).map((p) => this.viewPlayer(p));
  }
  async getMerchant(city: CityId): Promise<ContractMerchant> { return this.viewMerchant(this.merchants.get(city)!); }
  async getStalls(city?: CityId): Promise<ContractStall[]> {
    return structuredClone(city ? this.stalls.filter((s) => s.city === city) : this.stalls);
  }
  async getJourney(accountId: string): Promise<ContractJourney | null> {
    const j = this.players.get(accountId)?.journey;
    return j ? structuredClone(j) : null;
  }
  private viewWithdraw(w: FWithdraw): ContractWithdraw {
    return { id: w.id, account_id: w.account_id, fils: w.fils.toString(), dest_asset: w.dest_asset, dest_address: w.dest_address, status: w.status };
  }
  async getWithdraw(id: number): Promise<ContractWithdraw | null> {
    const w = this.withdraws.get(id);
    return w ? this.viewWithdraw(w) : null;
  }
  async getWithdrawals(fromId: number, limit: number): Promise<ContractWithdraw[]> {
    return [...this.withdraws.values()].filter((w) => w.id >= fromId).sort((a, b) => a.id - b.id).slice(0, limit).map((w) => this.viewWithdraw(w));
  }
  async getConfig(): Promise<ContractConfig> { return { mode: this.mode, paused: this.paused, operator: "operator.fake" }; }
  async recentEvents(limit: number): Promise<ContractEvent[]> { return structuredClone(this.events.slice(-limit)); }
  async accountBalance(accountId: string): Promise<string> {
    return (this.balances.get(accountId) ?? 10_000_000_000_000_000_000_000_000n).toString();
  }

  // ---------------------------------------------------------------- transactions

  async createPlayerAccount(accountId: string, publicKey: string): Promise<{ txHash: string }> {
    const existing = this.accountKeys.get(accountId);
    if (existing && existing !== publicKey) throw new ContractPanic("INTERNAL: account exists with another key");
    this.accountKeys.set(accountId, publicKey);
    this.changed();
    return { txHash: this.newTx() };
  }

  async playerCall<M extends PlayerMethod>(accountId: string, method: M, args: PlayerArgs[M], key: PlayerKey): Promise<TxOutcome> {
    this.calls.push({ kind: "player", account: accountId, method, args });
    if (this.accountKeys.get(accountId) !== key.publicKey) throw new ContractPanic("INTERNAL: delegate signature rejected");
    this.requireNotPaused();
    const before = this.events.length;
    try {
      const returnValue = this.dispatchPlayer(accountId, method, args as never);
      return this.outcome(returnValue, before);
    } finally {
      this.changed();
    }
  }

  async operatorCall<M extends OperatorMethod>(method: M, args: OperatorArgs[M]): Promise<TxOutcome> {
    try {
      return await this.operatorCallInner(method, args);
    } finally {
      this.changed();
    }
  }

  private async operatorCallInner<M extends OperatorMethod>(method: M, args: OperatorArgs[M]): Promise<TxOutcome> {
    this.calls.push({ kind: "operator", method, args });
    if (method !== "refund_withdraw" && method !== "set_paused") this.requireNotPaused();
    const before = this.events.length;
    let returnValue: unknown = null;
    switch (method) {
      case "set_paused":
        this.paused = (args as OperatorArgs["set_paused"]).paused;
        break;
      case "credit_deposit":
        returnValue = this.creditDeposit(args as OperatorArgs["credit_deposit"]);
        break;
      case "mark_withdraw": {
        const a = args as OperatorArgs["mark_withdraw"];
        const w = this.withdraws.get(a.id);
        const target = a.status ?? "DONE";
        // Contract rules: PENDING -> SENT, PENDING|SENT -> DONE; anything else is rejected.
        const allowed = w && ((w.status === "PENDING" && target === "SENT") || ((w.status === "PENDING" || w.status === "SENT") && target === "DONE"));
        if (!allowed) panic("BAD_REQUEST", "withdrawal cannot move to that status");
        w!.status = target;
        if (target === "DONE") this.burned += w!.fils;
        this.emit("withdraw_marked", { id: a.id, reference: a.reference });
        break;
      }
      case "refund_withdraw": {
        const a = args as OperatorArgs["refund_withdraw"];
        const w = this.withdraws.get(a.id);
        if (!w || (w.status !== "PENDING" && w.status !== "SENT")) panic("BAD_REQUEST", "withdrawal cannot be refunded");
        w!.status = "REFUNDED";
        this.players.get(w!.account_id)!.fils += w!.fils;
        this.emit("withdraw_marked", { id: a.id, refunded: true });
        break;
      }
    }
    return this.outcome(returnValue, before);
  }

  async worldTick(): Promise<TxOutcome> {
    this.calls.push({ kind: "tick", method: "world_tick", args: {} });
    this.requireNotPaused();
    const before = this.events.length;
    const now = this.clock();
    const elapsed = now - this.lastTickAt;
    const minGap = this.tickSeconds === PARAMS.TICK_SECONDS ? TICK_RULES.MIN_INTERVAL_SECONDS : Math.max(1, Math.floor((this.tickSeconds * TICK_RULES.MIN_INTERVAL_SECONDS) / PARAMS.TICK_SECONDS));
    let ticks = 0;
    if (elapsed >= minGap) {
      ticks = Math.min(TICK_RULES.MAX_MISSED_TICKS, Math.max(1, Math.floor(elapsed / this.tickSeconds)));
      for (let i = 0; i < ticks; i++) this.runTick();
      if (this.strict) {
        // D13: the schedule advances by whole ticks; excess missed ticks are dropped but the phase is kept.
        this.lastTickAt += ticks * this.tickSeconds;
        if (now - this.lastTickAt >= this.tickSeconds) this.lastTickAt = now - ((now - this.lastTickAt) % this.tickSeconds);
      } else {
        this.lastTickAt = now;
      }
    }
    this.changed();
    return this.outcome({ ticks, tick: this.tick }, before);
  }

  // ---------------------------------------------------------------- merchants (set_policy / ship, caller = merchant account)

  /** The NPC stand-in calls this the way a merchant's function-call key would (DECISIONS D24, D25). */
  async merchantCall(city: CityId, method: "set_policy", args: { spread_bp: number; bias_bp: number }): Promise<TxOutcome>;
  async merchantCall(city: CityId, method: "ship", args: { to: CityId; good: GoodId; qty: number }): Promise<TxOutcome>;
  async merchantCall(city: CityId, method: "set_policy" | "ship", args: never): Promise<TxOutcome> {
    this.calls.push({ kind: "operator", account: city, method, args });
    this.requireNotPaused();
    const before = this.events.length;
    try {
      const m = this.merchants.get(city)!;
      const now = this.clock();
      if (method === "set_policy") {
        const a = args as { spread_bp: number; bias_bp: number };
        if (!Number.isInteger(a.spread_bp) || a.spread_bp < PARAMS.SPREAD_MIN_BP || a.spread_bp > PARAMS.SPREAD_MAX_BP) panic("BAD_REQUEST", "spread out of range");
        if (!Number.isInteger(a.bias_bp) || a.bias_bp < PARAMS.BIAS_MIN_BP || a.bias_bp > PARAMS.BIAS_MAX_BP) panic("BAD_REQUEST", "bias out of range");
        if (Math.abs(a.spread_bp - m.spread_bp) > 300 || Math.abs(a.bias_bp - m.bias_bp) > 300) panic("BAD_REQUEST", "policy step too large");
        const last = this.lastPolicyAt.get(city);
        if ((last !== undefined && now - last < this.tickSeconds) || this.lastPolicyTick.get(city) === this.tick) panic("RATE_LIMIT", "one policy change per tick");
        m.spread_bp = a.spread_bp;
        m.bias_bp = a.bias_bp;
        this.lastPolicyAt.set(city, now);
        this.lastPolicyTick.set(city, this.tick);
        this.emit("policy", { merchant: city, spread_bp: a.spread_bp, bias_bp: a.bias_bp });
        return this.outcome(null, before);
      }
      const a = args as { to: CityId; good: GoodId; qty: number };
      const to = this.merchants.get(a.to);
      if (!to || a.to === city) panic("BAD_REQUEST", "bad destination");
      if (!Number.isInteger(a.qty) || a.qty < 1 || a.qty > PARAMS.NPC_SHIP_UNITS_PER_TICK) panic("BAD_REQUEST", "bad quantity");
      const key = `${city}:${a.good}`;
      if (this.shippedThisTick.has(key)) panic("RATE_LIMIT", "already shipped this good this tick");
      const target = GOODS[a.good].target;
      if ((m.stock[a.good] - to!.stock[a.good]) * 10000 < PARAMS.NPC_MIN_RATIO_GAP_BP * target) panic("BAD_REQUEST", "stock gap too small");
      if (m.stock[a.good] < a.qty) panic("INSUFFICIENT_STOCK", "not enough stock");
      if (to!.stock[a.good] >= target || to!.stock[a.good] + a.qty > GOODS[a.good].cap) panic("BAD_REQUEST", "destination is not short of this good");
      const midHi = quoteBig({ good: a.good, stock: m.stock[a.good], spreadBp: m.spread_bp, biasBp: 0 }).mid;
      const midLo = quoteBig({ good: a.good, stock: to!.stock[a.good], spreadBp: to!.spread_bp, biasBp: 0 }).mid;
      const total = BigInt(a.qty) * ((midHi + midLo) / 2n);
      const budget = this.shipBudget.get(a.to) ?? 0n;
      if (total > budget) panic("RATE_LIMIT", "destination budget for this tick is used up");
      if (to!.treasury < total) panic("MERCHANT_BROKE", "destination cannot pay");
      this.shipBudget.set(a.to, budget - total);
      this.shippedThisTick.add(key);
      m.stock[a.good] -= a.qty;
      to!.stock[a.good] += a.qty;
      to!.treasury -= total;
      m.treasury += total;
      this.emit("ship", { from: city, to: a.to, good: a.good, qty: a.qty, total: total.toString() });
      return this.outcome(null, before);
    } finally {
      this.changed();
    }
  }

  // ---------------------------------------------------------------- dev-only world keeper

  /**
   * NOT a contract rule: the dev backend calls it after each tick so a long-lived local world cannot collapse into an
   * unplayable market (a city out of its staple goods, or a merchant too poor to buy). A good below 15% of its target is
   * raised to 30%; a treasury below 20% of the initial one is topped up (minted, so audit() still balances).
   * The real tick, pricing and shipping rules are untouched and nothing calls this in tests of those rules.
   */
  devKeepAlive(): { goods: number; fils: bigint } {
    const out = { goods: 0, fils: 0n };
    const floorTreasury = (BigInt(PARAMS.MERCHANT_TREASURY_FILS) * 20n) / 100n;
    for (const m of this.merchants.values()) {
      for (const g of GOOD_IDS) {
        const t = GOODS[g].target;
        if (m.stock[g] * 100 < t * 15) {
          const lift = Math.floor((t * 30) / 100);
          out.goods += lift - m.stock[g];
          m.stock[g] = lift;
        }
      }
      if (m.treasury < floorTreasury) {
        out.fils += floorTreasury - m.treasury;
        this.minted += floorTreasury - m.treasury;
        m.treasury = floorTreasury;
      }
    }
    if (out.goods > 0 || out.fils > 0n) this.changed();
    return out;
  }

  // ---------------------------------------------------------------- persistence (dev backend)

  /** Serialises the whole state; bigint and -Infinity are tagged so JSON.parse can restore them. */
  snapshot(): string {
    const state = {
      tick: this.tick, lastTickAt: this.lastTickAt, paused: this.paused, house: this.house, minted: this.minted, burned: this.burned,
      merchants: [...this.merchants.entries()], players: [...this.players.entries()], stalls: this.stalls,
      withdraws: [...this.withdraws.entries()], depositRefs: [...this.depositRefs], accountKeys: [...this.accountKeys.entries()],
      balances: [...this.balances.entries()], events: this.events, ids: {
        event: this.nextEventId, journey: this.nextJourneyId, stall: this.nextStallId, withdraw: this.nextWithdrawId, tx: this.nextTx,
      },
      lastPolicyAt: [...this.lastPolicyAt.entries()], lastPolicyTick: [...this.lastPolicyTick.entries()],
    };
    return JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v === -Infinity ? { $neg: true } : v));
  }

  restore(json: string): void {
    const st = JSON.parse(json, (_k, v) => {
      if (v && typeof v === "object" && "$big" in v) return BigInt((v as { $big: string }).$big);
      if (v && typeof v === "object" && "$neg" in v) return -Infinity;
      return v;
    }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    this.tick = st.tick;
    this.lastTickAt = st.lastTickAt;
    this.paused = st.paused;
    this.house = st.house;
    this.minted = st.minted;
    this.burned = st.burned;
    this.merchants = new Map(st.merchants);
    this.players = new Map(st.players);
    this.stalls = st.stalls;
    this.withdraws = new Map(st.withdraws);
    this.depositRefs = new Set(st.depositRefs);
    this.accountKeys = new Map(st.accountKeys);
    this.balances = new Map(st.balances);
    this.events = st.events;
    this.nextEventId = st.ids.event;
    this.nextJourneyId = st.ids.journey;
    this.nextStallId = st.ids.stall;
    this.nextWithdrawId = st.ids.withdraw;
    this.nextTx = st.ids.tx;
    this.lastPolicyAt = new Map(st.lastPolicyAt);
    this.lastPolicyTick = new Map(st.lastPolicyTick);
  }

  // ---------------------------------------------------------------- internals

  private changed(): void {
    this.onChange?.();
  }

  /** D4: fils + base value of inventory, stall escrow and cargo in transit. */
  private faucetNetWorth(p: FPlayer): bigint {
    let w = p.fils;
    for (const g of GOOD_IDS) {
      let n = p.inventory[g] + (p.journey?.cargo[g] ?? 0);
      for (const s of this.stalls) if (s.seller === p.account_id && s.good === g) n += s.qty;
      w += GOODS[g].baseFils * BigInt(n);
    }
    return w;
  }

  private newTx(): string { return `faketx${(this.nextTx++).toString().padStart(6, "0")}`; }

  private outcome(returnValue: unknown, eventsBefore: number): TxOutcome {
    return { txHash: this.newTx(), returnValue: this.testNullReturns ? null : structuredClone(returnValue), events: structuredClone(this.events.slice(eventsBefore)) };
  }

  private emit(event: string, data: Record<string, unknown>): void {
    this.events.push({ id: this.nextEventId++, event, data, at_ns: secToNs(this.clock()) });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private requireNotPaused(): void {
    if (this.paused) panic("PAUSED", "the game is paused");
  }

  private cargoUnits(inv: Partial<Record<GoodId, number>>): number {
    return Object.values(inv).reduce<number>((s, n) => s + (n ?? 0), 0);
  }

  private dispatchPlayer(account: string, method: PlayerMethod, args: never): unknown {
    if (method === "register") {
      if (!this.players.has(account)) {
        this.players.set(account, {
          account_id: account, fils: 0n, location: "bandar", inventory: zeroGoods(), journey: null,
          total_deposited: 0n, last_faucet: -Infinity,
        });
      }
      return null;
    }
    const p = this.mustPlayer(account);
    switch (method) {
      case "faucet": return this.faucet(p);
      case "trade": return this.trade(p, args as PlayerArgs["trade"]);
      case "start_journey": return this.startJourney(p, args as PlayerArgs["start_journey"]);
      case "claim_journey": return this.claimJourney(p);
      case "stall_create": return this.stallCreate(p, args as PlayerArgs["stall_create"]);
      case "stall_buy": return this.stallBuy(p, args as PlayerArgs["stall_buy"]);
      case "stall_cancel": return this.stallCancel(p, args as PlayerArgs["stall_cancel"]);
      case "request_withdraw": return this.requestWithdraw(p, args as PlayerArgs["request_withdraw"]);
    }
  }

  private requireIdle(p: FPlayer): void {
    if (p.journey) panic("IN_TRANSIT", "claim or finish your journey first");
  }

  private faucet(p: FPlayer): null {
    if (this.mode !== "PLAY") panic("MODE_NOT_ALLOWED", "the faucet only works in PLAY mode");
    const now = this.clock();
    if (now - p.last_faucet < this.faucetCooldown) panic("RATE_LIMIT", "faucet cooldown");
    if (this.strict && this.faucetNetWorth(p) >= 5000n) panic("BAD_REQUEST", "you are too rich for the faucet");
    p.last_faucet = now;
    p.fils += BigInt(PARAMS.FAUCET_FILS);
    this.minted += BigInt(PARAMS.FAUCET_FILS);
    this.emit("faucet", { account_id: p.account_id, fils: String(PARAMS.FAUCET_FILS) });
    return null;
  }

  private trade(p: FPlayer, a: PlayerArgs["trade"]): { total: string; fee: string } {
    this.requireIdle(p);
    if (a.qty <= 0 || a.qty > PARAMS.MAX_QTY_PER_TRADE) panic("BAD_REQUEST", "bad quantity");
    if (a.merchant !== p.location) panic("NOT_IN_CITY", "you are not in that city");
    const m = this.merchants.get(a.merchant)!;
    const cost = tradeCost({
      good: a.good, side: a.side, qty: a.qty, merchantStock: m.stock[a.good], spreadBp: m.spread_bp, biasBp: m.bias_bp,
    });
    const limit = BigInt(a.limit_total);
    if (a.side === "buy") {
      if (m.stock[a.good] < a.qty) panic("INSUFFICIENT_STOCK", "the merchant does not have that much");
      if (this.cargoUnits(p.inventory) + a.qty > PARAMS.CARGO_CAP) panic("CARGO_LIMIT", "caravan is full");
      const pay = cost.total + cost.fee;
      if (pay > limit) panic("SLIPPAGE", "the price moved");
      if (pay > p.fils) panic("INSUFFICIENT_FUNDS", "not enough dinar");
      p.fils -= pay;
      p.inventory[a.good] += a.qty;
      m.stock[a.good] -= a.qty;
      m.treasury += cost.total;
    } else {
      if (p.inventory[a.good] < a.qty) panic("INSUFFICIENT_STOCK", "you do not have that much");
      if (m.stock[a.good] + a.qty > GOODS[a.good].cap) panic("BAD_REQUEST", "warehouse full");
      if (m.treasury < cost.total) panic("MERCHANT_BROKE", "the merchant cannot afford it");
      const gain = cost.total - cost.fee;
      if (gain < limit) panic("SLIPPAGE", "the price moved");
      p.fils += gain;
      p.inventory[a.good] -= a.qty;
      m.stock[a.good] += a.qty;
      m.treasury -= cost.total;
    }
    this.house += cost.fee;
    this.emit("trade", { account_id: p.account_id, merchant: a.merchant, good: a.good, side: a.side, qty: a.qty, total: cost.total.toString(), fee: cost.fee.toString() });
    return { total: cost.total.toString(), fee: cost.fee.toString() };
  }

  private startJourney(p: FPlayer, a: PlayerArgs["start_journey"]): ContractJourney {
    this.requireIdle(p);
    if (a.to === p.location) panic("BAD_REQUEST", "you are already there");
    const route = findRoute(p.location, a.to);
    if (!route) panic("BAD_REQUEST", "no such route");
    if (!Number.isInteger(a.guards) || a.guards < 0 || a.guards > PARAMS.MAX_GUARDS) panic("BAD_REQUEST", "bad guards");
    const cargo: Partial<Record<GoodId, number>> = {};
    let baseValue = 0n;
    for (const g of GOOD_IDS) {
      const n = a.cargo[g] ?? 0;
      if (n <= 0) continue;
      if (p.inventory[g] < n) panic("INSUFFICIENT_STOCK", `you do not have ${n} ${g}`);
      cargo[g] = n;
      baseValue += GOODS[g].baseFils * BigInt(n);
    }
    const units = this.cargoUnits(cargo);
    if (units === 0) panic("BAD_REQUEST", "cargo is empty");
    if (units > PARAMS.CARGO_CAP) panic("CARGO_LIMIT", "caravan is full");
    let risk = BigInt(route!.riskBp);
    for (let i = 0; i < a.guards; i++) risk = (risk * BigInt(PARAMS.GUARD_RISK_FACTOR_BP)) / BP;
    const guardCost = (baseValue * BigInt(PARAMS.GUARD_COST_BP) * BigInt(a.guards)) / BP;
    if (guardCost > p.fils) panic("INSUFFICIENT_FUNDS", "not enough dinar for guards");
    p.fils -= guardCost;
    this.house += guardCost;
    for (const [g, n] of Object.entries(cargo) as Array<[GoodId, number]>) p.inventory[g] -= n;
    const now = this.clock();
    const j: ContractJourney = {
      id: this.nextJourneyId++, from: p.location, to: a.to, cargo, guards: a.guards,
      started_at_ns: secToNs(now), arrives_at_ns: secToNs(now + route!.durationSec), risk_bp: Number(risk),
      claimed: false, ambushed: false, lost: {},
    };
    p.journey = j;
    this.emit("journey_started", { account_id: p.account_id, from: j.from, to: j.to, guards: j.guards });
    return structuredClone(j);
  }

  private claimJourney(p: FPlayer): ContractJourney {
    const j = p.journey;
    if (!j) return panic("BAD_REQUEST", "you have no journey");
    if (this.clock() < nsToSec(j.arrives_at_ns)) panic("NOT_ARRIVED", "the caravan has not arrived yet");
    const ambushed = this.roll(j) < j.risk_bp;
    const lost: Partial<Record<GoodId, number>> = {};
    for (const [g, n] of Object.entries(j.cargo) as Array<[GoodId, number]>) {
      const l = ambushed ? Number((BigInt(n) * BigInt(PARAMS.AMBUSH_LOSS_BP)) / BP) : 0; // OPEN_QUESTIONS #6
      if (l > 0) lost[g] = l;
      p.inventory[g] += n - l;
    }
    const done: ContractJourney = { ...j, claimed: true, ambushed, lost };
    p.location = j.to;
    p.journey = null;
    this.emit("journey_claimed", { account_id: p.account_id, ambushed, lost });
    return structuredClone(done);
  }

  private stallCreate(p: FPlayer, a: PlayerArgs["stall_create"]): ContractStall {
    this.requireIdle(p);
    if (a.qty <= 0) panic("BAD_REQUEST", "bad quantity");
    if (p.inventory[a.good] < a.qty) panic("INSUFFICIENT_STOCK", "you do not have that much");
    if (this.strict) {
      if (this.stalls.filter((x) => x.seller === p.account_id).length >= 5) panic("RATE_LIMIT", "too many open stalls");
      const unit = BigInt(a.unit_price);
      if (unit < 1n || unit > 1_000_000_000n) panic("BAD_REQUEST", "unit price out of range");
    }
    p.inventory[a.good] -= a.qty;
    const s: ContractStall = { id: this.nextStallId++, seller: p.account_id, city: p.location, good: a.good, qty: a.qty, unit_price: a.unit_price };
    this.stalls.push(s);
    this.emit("stall_create", { seller: s.seller, city: s.city, good: s.good, qty: s.qty, unit_price: s.unit_price });
    return structuredClone(s);
  }

  private stallBuy(p: FPlayer, a: PlayerArgs["stall_buy"]): null {
    this.requireIdle(p);
    const s = this.stalls.find((x) => x.id === a.stall_id);
    if (!s) return panic("BAD_REQUEST", "no such stall");
    if (s.seller === p.account_id) panic("BAD_REQUEST", "that is your own stall");
    if (s.city !== p.location) panic("NOT_IN_CITY", "you are not in that city");
    if (s.qty < a.qty) panic("INSUFFICIENT_STOCK", "the stall does not have that much");
    if (this.cargoUnits(p.inventory) + a.qty > PARAMS.CARGO_CAP) panic("CARGO_LIMIT", "caravan is full");
    const price = BigInt(a.qty) * BigInt(s.unit_price);
    let fee: bigint;
    if (this.strict) {
      // D5/D6: the seller pays ceil(2%) (at least 1 fils); the seller must be in the city and not travelling.
      const seller = this.players.get(s.seller)!;
      if (seller.location !== s.city || seller.journey) panic("NOT_IN_CITY", "the seller is not in that city");
      fee = (price * BigInt(PARAMS.STALL_FEE_BP) + BP - 1n) / BP;
      if (fee < 1n) fee = 1n;
      if (price > BigInt(a.limit_total)) panic("SLIPPAGE", "the price moved");
      if (price > p.fils) panic("INSUFFICIENT_FUNDS", "not enough dinar");
      p.fils -= price;
      this.players.get(s.seller)!.fils += price - fee;
    } else {
      fee = (price * BigInt(PARAMS.STALL_FEE_BP)) / BP; // OPEN_QUESTIONS #8: buyer pays on top
      if (price + fee > BigInt(a.limit_total)) panic("SLIPPAGE", "the price moved");
      if (price + fee > p.fils) panic("INSUFFICIENT_FUNDS", "not enough dinar");
      p.fils -= price + fee;
      this.players.get(s.seller)!.fils += price;
    }
    p.inventory[s.good] += a.qty;
    s.qty -= a.qty;
    this.house += fee;
    const sid = s.id;
    if (s.qty === 0) this.stalls.splice(this.stalls.indexOf(s), 1);
    this.emit("stall_buy", { stall_id: sid, buyer: p.account_id, qty: a.qty, total: price.toString(), fee: fee.toString() });
    return null;
  }

  private stallCancel(p: FPlayer, a: PlayerArgs["stall_cancel"]): null {
    const s = this.stalls.find((x) => x.id === a.stall_id);
    if (this.strict) {
      // contracts/caravan game.rs try_stall_cancel: unknown stall, not yours, travelling, wrong city (in this order).
      if (!s) return panic("BAD_REQUEST", "no such stall");
      if (s.seller !== p.account_id) panic("UNAUTHENTICATED", "not your stall");
      if (p.journey) panic("IN_TRANSIT", "you are travelling");
      if (p.location !== s.city) panic("NOT_IN_CITY", "you are not in that city");
    }
    if (!s || s.seller !== p.account_id) return panic("BAD_REQUEST", "no such stall of yours");
    p.inventory[s.good] += s.qty;
    this.stalls.splice(this.stalls.indexOf(s), 1);
    this.emit("stall_cancel", { stall_id: s.id, seller: p.account_id });
    return null;
  }

  private requestWithdraw(p: FPlayer, a: PlayerArgs["request_withdraw"]): number {
    if (this.mode !== "LIVE") panic("MODE_NOT_ALLOWED", "withdrawals are only available in LIVE mode");
    const fils = BigInt(a.fils);
    if (fils <= 0n) panic("BAD_REQUEST", "amount must be positive");
    if (this.strict) {
      if (fils < 1000n) panic("BAD_REQUEST", "minimum withdrawal is 1,000 fils");
      for (const w of this.withdraws.values()) {
        if (w.account_id === p.account_id && (w.status === "PENDING" || w.status === "SENT")) panic("RATE_LIMIT", "one open withdrawal at a time");
      }
    }
    if (fils > p.fils) panic("INSUFFICIENT_FUNDS", "not enough dinar");
    const day = Math.floor(this.clock() / DAY);
    let today = 0n;
    for (const w of this.withdraws.values()) {
      if (w.account_id === p.account_id && w.day === day && w.status !== "REFUNDED") today += w.fils;
    }
    if (today + fils > BigInt(PARAMS.DAILY_WITHDRAW_CAP_FILS)) panic("BAD_REQUEST", "daily withdraw cap reached");
    p.fils -= fils;
    const id = this.nextWithdrawId++;
    this.withdraws.set(id, { id, account_id: p.account_id, fils, dest_asset: a.dest_asset, dest_address: a.dest_address, status: "PENDING", day });
    this.emit("withdraw_requested", { id, account_id: p.account_id, fils: fils.toString() });
    return id;
  }

  private creditDeposit(a: OperatorArgs["credit_deposit"]): { credited: boolean } {
    if (this.mode !== "LIVE") panic("MODE_NOT_ALLOWED", "deposits are only available in LIVE mode");
    if (this.depositRefs.has(a.reference)) return { credited: false }; // duplicate reference ignored
    const p = this.mustPlayer(a.account_id);
    const fils = BigInt(a.fils);
    if (p.total_deposited + fils > BigInt(PARAMS.MAX_DEPOSIT_FILS)) panic("RATE_LIMIT", "player deposit cap reached");
    this.depositRefs.add(a.reference);
    p.total_deposited += fils;
    p.fils += fils;
    this.minted += fils;
    this.emit("deposit", { account_id: a.account_id, fils: a.fils, reference: a.reference });
    return { credited: true };
  }

  private runTick(): void {
    this.tick += 1;
    const ms = CITY_IDS.map((c) => this.merchants.get(c)!);
    // 1. production and consumption, clamped to [0, cap]
    for (const m of ms) {
      for (const g of GOOD_IDS) {
        const flow = (CITIES[m.id].produces[g] ?? 0) - (CITIES[m.id].consumes[g] ?? 0);
        m.stock[g] = Math.min(GOODS[g].cap, Math.max(0, m.stock[g] + flow));
      }
    }
    this.shippedThisTick.clear();
    this.shipBudget = new Map(ms.map((m) => [m.id, (m.treasury * 25n) / 100n]));
    // 2. house caravans (integer gap test, OPEN_QUESTIONS #12; Appendix B order, #11). Strict mode: merchants ship themselves.
    for (const g of this.strict ? [] : GOOD_IDS) {
      const target = GOODS[g].target;
      let hi = ms[0]!;
      let lo = ms[0]!;
      for (const m of ms) {
        if (m.stock[g] > hi.stock[g]) hi = m;
        if (m.stock[g] < lo.stock[g]) lo = m;
      }
      if ((hi.stock[g] - lo.stock[g]) * 10000 < PARAMS.NPC_MIN_RATIO_GAP_BP * target) continue;
      const qty = Math.min(PARAMS.NPC_SHIP_UNITS_PER_TICK, hi.stock[g], GOODS[g].cap - lo.stock[g]);
      if (qty <= 0) continue;
      const midHi = quoteBig({ good: g, stock: hi.stock[g], spreadBp: hi.spread_bp, biasBp: hi.bias_bp }).mid;
      const midLo = quoteBig({ good: g, stock: lo.stock[g], spreadBp: lo.spread_bp, biasBp: lo.bias_bp }).mid;
      const total = BigInt(qty) * ((midHi + midLo) / 2n);
      if (lo.treasury < total) continue;
      hi.stock[g] -= qty;
      lo.stock[g] += qty;
      lo.treasury -= total;
      hi.treasury += total;
      this.emit("ship", { from: hi.id, to: lo.id, good: g, qty, total: total.toString() });
    }
    // 3. rebalancing: above 150% of the initial treasury gives 30% of the excess to the poorest
    const initial = BigInt(PARAMS.MERCHANT_TREASURY_FILS);
    const threshold = (initial * BigInt(PARAMS.REBALANCE_EXCESS_FROM_BP)) / BP;
    for (const m of ms) {
      if (m.treasury <= threshold) continue;
      const poorest = ms.reduce((a, b) => (b.treasury < a.treasury ? b : a), ms[0]!);
      if (poorest === m) continue;
      const give = ((m.treasury - threshold) * BigInt(PARAMS.REBALANCE_PCT)) / 100n;
      m.treasury -= give;
      poorest.treasury += give;
    }
    // 4. house recycling: 10% of the house balance to the poorest merchant
    const recycle = (this.house * BigInt(PARAMS.HOUSE_RECYCLE_PCT)) / 100n;
    if (recycle > 0n) {
      const poorest = ms.reduce((a, b) => (b.treasury < a.treasury ? b : a), ms[0]!);
      poorest.treasury += recycle;
      this.house -= recycle;
    }
    this.emit("tick", { tick: this.tick });
  }
}

/** Convenience: the price table the UI shows, from a merchant view. */
export function quotesFor(m: Pick<ContractMerchant, "stock" | "spread_bp" | "bias_bp">) {
  return Object.fromEntries(
    GOOD_IDS.map((g) => [g, quote({ good: g, stock: m.stock[g], spreadBp: m.spread_bp, biasBp: m.bias_bp })]),
  ) as Record<GoodId, ReturnType<typeof quote>>;
}

/** D12-style deterministic roll: sha256(seed || journey id || account) as a little-endian u64 mod 10000. */
function hashRoll(j: ContractJourney): number {
  const h = createHash("sha256").update(`caravan-dev-seed:${j.id}:${j.from}:${j.to}:${j.started_at_ns}`).digest();
  return Number(h.readBigUInt64LE(0) % 10000n);
}
