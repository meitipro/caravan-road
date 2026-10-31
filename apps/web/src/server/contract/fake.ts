// In-memory ContractClient that follows spec/ECONOMY.md with the shared quote()/tradeCost(), so the
// whole server is testable offline. It is NOT the contract: where the spec leaves a gap
// (spec/OPEN_QUESTIONS.md) it takes the provisional behaviour used by packages/shared/src/mock.ts
// (OPEN_QUESTIONS #6 floor ambush loss, #7 limit_total semantics, #8 stall fee on top).

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
    this.roll = opts.ambushRoll ?? (() => 9999);
    this.faucetCooldown = opts.faucetCooldownSeconds ?? 60;
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
    for (const w of this.withdraws.values()) if (w.status === "PENDING") total += w.fils;
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
      stalls: structuredClone(this.stalls),
    };
  }
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
    return { txHash: this.newTx() };
  }

  async playerCall<M extends PlayerMethod>(accountId: string, method: M, args: PlayerArgs[M], key: PlayerKey): Promise<TxOutcome> {
    this.calls.push({ kind: "player", account: accountId, method, args });
    if (this.accountKeys.get(accountId) !== key.publicKey) throw new ContractPanic("INTERNAL: delegate signature rejected");
    this.requireNotPaused();
    const before = this.events.length;
    const returnValue = this.dispatchPlayer(accountId, method, args as never);
    return this.outcome(returnValue, before);
  }

  async operatorCall<M extends OperatorMethod>(method: M, args: OperatorArgs[M]): Promise<TxOutcome> {
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
        if (!w || w.status !== "PENDING") panic("BAD_REQUEST", "withdrawal is not pending");
        w!.status = "DONE";
        this.burned += w!.fils;
        this.emit("withdraw_marked", { id: a.id, reference: a.reference });
        break;
      }
      case "refund_withdraw": {
        const a = args as OperatorArgs["refund_withdraw"];
        const w = this.withdraws.get(a.id);
        if (!w || w.status !== "PENDING") panic("BAD_REQUEST", "withdrawal is not pending");
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
    let ticks = 0;
    if (elapsed >= TICK_RULES.MIN_INTERVAL_SECONDS) {
      ticks = Math.min(TICK_RULES.MAX_MISSED_TICKS, Math.max(1, Math.floor(elapsed / PARAMS.TICK_SECONDS)));
      for (let i = 0; i < ticks; i++) this.runTick();
      this.lastTickAt = now;
    }
    return this.outcome({ ticks }, before);
  }

  // ---------------------------------------------------------------- internals

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
    const fee = (price * BigInt(PARAMS.STALL_FEE_BP)) / BP; // OPEN_QUESTIONS #8
    if (price + fee > BigInt(a.limit_total)) panic("SLIPPAGE", "the price moved");
    if (price + fee > p.fils) panic("INSUFFICIENT_FUNDS", "not enough dinar");
    p.fils -= price + fee;
    p.inventory[s.good] += a.qty;
    s.qty -= a.qty;
    this.players.get(s.seller)!.fils += price;
    this.house += fee;
    const sid = s.id;
    if (s.qty === 0) this.stalls.splice(this.stalls.indexOf(s), 1);
    this.emit("stall_buy", { stall_id: sid, buyer: p.account_id, qty: a.qty, total: price.toString(), fee: fee.toString() });
    return null;
  }

  private stallCancel(p: FPlayer, a: PlayerArgs["stall_cancel"]): null {
    const s = this.stalls.find((x) => x.id === a.stall_id);
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
    if (p.total_deposited + fils > BigInt(PARAMS.MAX_DEPOSIT_FILS)) panic("BAD_REQUEST", "deposit cap reached");
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
    // 2. house caravans (integer gap test, OPEN_QUESTIONS #12; Appendix B order, #11)
    for (const g of GOOD_IDS) {
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
