// In-memory world that implements ChainPort, for the dry run, the evaluation and integration tests.
// It uses the shared constants and the shared integer price math (quoteBig, tradeCost) and the
// spec 2.8 world tick (production/consumption, treasury rebalancing, house recycling; house
// caravans are the merchants' own `ship` calls). Greedy bots trade at the merchants' CURRENT
// policies, so a merchant's spread and bias have an economic effect.
//
// It is NOT the Appendix B reproduction: the shared runSim() has no hook for merchant policies and
// uses fixed default quotes, and this file may not edit packages/shared. Numbers from here are only
// comparable with other runs of this same world (same seed, same bots), never with spec 2.9.
//
// setPolicy / ship validate like the contract is specified to, and THROW when a call would be
// rejected, so tests exercise the chain-error paths with realistic behaviour.

import type { CityId, GoodId } from "@caravan/shared";
import { CITIES, CITY_IDS, findRoute, GOODS, GOOD_IDS, PARAMS, quoteBig, tradeCost } from "@caravan/shared";
import { gapOk } from "./candidates.js";
import type { ChainPort, MerchantSnapshot, TxResult, WorldSnapshot } from "./types.js";

/** Small seeded PRNG (mulberry32); deterministic across platforms. */
export class Rng {
  constructor(private s: number) {}
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

interface Bot {
  city: CityId;
  cash: number;
  inv: Partial<Record<GoodId, number>>;
  dest: CityId | null;
  arriveTick: number;
  startWorth: number | null;
}

export interface SimStats {
  trips: number;
  medianProfit: number;
  brokeEvents: number;
  warehouseFullEvents: number;
  ambushes: number;
  priceRange: Record<GoodId, [number, number]>;
  treasuries: Record<CityId, number>;
  house: number;
  meanSpreadBp: number;
  moneyNow: number;
  moneyStart: number;
}

export interface SimWorldOptions {
  bots: number;
  seed: number;
  startUnix?: number;
}

const INIT = PARAMS.MERCHANT_TREASURY_FILS;

export class SimWorld implements ChainPort {
  tick = 0;
  readonly stock = {} as Record<CityId, Record<GoodId, number>>;
  readonly treasury = {} as Record<CityId, number>;
  readonly policy = {} as Record<CityId, { spread_bp: number; bias_bp: number }>;
  house = 0;
  readonly bots: Bot[] = [];
  private readonly rng: Rng;
  private readonly startUnix: number;
  private brokeEvents = 0;
  private warehouseFull = 0;
  private ambushes = 0;
  private readonly profits: number[] = [];
  private readonly lo = {} as Record<GoodId, number>;
  private readonly hi = {} as Record<GoodId, number>;
  private priceSeen = false;
  private spreadSum = 0;
  private spreadN = 0;
  readonly moneyStart: number;
  /** counters of calls rejected like the contract would (for tests) */
  rejected = { setPolicy: 0, ship: 0 };
  /** optional fault injection for tests: throw on these calls */
  failNext: { setPolicy?: string; ship?: string; worldTick?: string } = {};

  constructor(opts: SimWorldOptions) {
    this.rng = new Rng(opts.seed);
    this.startUnix = opts.startUnix ?? 1_800_000_000;
    for (const c of CITY_IDS) {
      this.stock[c] = {} as Record<GoodId, number>;
      for (const g of GOOD_IDS) this.stock[c][g] = GOODS[g].target;
      this.treasury[c] = INIT;
      this.policy[c] = { spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0 };
    }
    for (let i = 0; i < opts.bots; i++) {
      this.bots.push({ city: CITY_IDS[this.rng.int(CITY_IDS.length)]!, cash: PARAMS.FAUCET_FILS, inv: {}, dest: null, arriveTick: 0, startWorth: null });
    }
    this.moneyStart = INIT * 4 + PARAMS.FAUCET_FILS * opts.bots;
    this.recordPrices();
  }

  // ------------------------------------------------------------------ ChainPort

  async readSnapshot(): Promise<WorldSnapshot> {
    return this.snapshot();
  }

  snapshot(): WorldSnapshot {
    const merchants = {} as Record<CityId, MerchantSnapshot>;
    for (const c of CITY_IDS) {
      merchants[c] = { id: c, treasury: BigInt(this.treasury[c]), stock: { ...this.stock[c] }, policy: { ...this.policy[c] } };
    }
    return { tick: this.tick, now: this.startUnix + this.tick * PARAMS.TICK_SECONDS, merchants };
  }

  async setPolicy(city: CityId, spreadBp: number, biasBp: number): Promise<TxResult> {
    if (this.failNext.setPolicy) {
      const m = this.failNext.setPolicy;
      delete this.failNext.setPolicy;
      throw new Error(m);
    }
    const ok =
      Number.isInteger(spreadBp) && Number.isInteger(biasBp) &&
      spreadBp >= PARAMS.SPREAD_MIN_BP && spreadBp <= PARAMS.SPREAD_MAX_BP &&
      biasBp >= PARAMS.BIAS_MIN_BP && biasBp <= PARAMS.BIAS_MAX_BP;
    if (!ok) {
      this.rejected.setPolicy++;
      throw new Error("BAD_REQUEST: policy out of range");
    }
    this.policy[city] = { spread_bp: spreadBp, bias_bp: biasBp };
    return { txHash: `sim:policy:${this.tick}:${city}` };
  }

  async ship(city: CityId, to: CityId, good: GoodId, qty: number): Promise<TxResult> {
    if (this.failNext.ship) {
      const m = this.failNext.ship;
      delete this.failNext.ship;
      throw new Error(m);
    }
    const reject = (why: string): never => {
      this.rejected.ship++;
      throw new Error(`BAD_REQUEST: ${why}`);
    };
    if (city === to) reject("same city");
    if (!Number.isInteger(qty) || qty < 1 || qty > PARAMS.NPC_SHIP_UNITS_PER_TICK) reject("qty out of range");
    const fromStock = this.stock[city][good];
    const toStock = this.stock[to][good];
    if (fromStock < qty) reject("not enough stock");
    if (!gapOk(fromStock, toStock, good)) reject("gap below minimum");
    if (toStock + qty > GOODS[good].cap) reject("destination warehouse full");
    const mid = (stock: number, bias: number) => quoteBig({ good, stock, spreadBp: PARAMS.SPREAD_DEFAULT_BP, biasBp: bias }).mid;
    const unit = (mid(fromStock, this.policy[city].bias_bp) + mid(toStock, this.policy[to].bias_bp)) / 2n;
    const pay = Number(unit) * qty;
    if (this.treasury[to] < pay) reject("destination cannot pay");
    this.treasury[to] -= pay;
    this.treasury[city] += pay;
    this.stock[city][good] -= qty;
    this.stock[to][good] += qty;
    return { txHash: `sim:ship:${this.tick}:${city}:${to}:${good}` };
  }

  /** Advances the world by one tick (production, rebalancing, recycling) and lets the bots act. */
  async worldTick(): Promise<TxResult & { skipped?: boolean }> {
    if (this.failNext.worldTick) {
      const m = this.failNext.worldTick;
      delete this.failNext.worldTick;
      throw new Error(m);
    }
    this.stepTick();
    return { txHash: `sim:tick:${this.tick}` };
  }

  // ------------------------------------------------------------------ economy

  private quoteAt(city: CityId, good: GoodId, stock: number) {
    const p = this.policy[city];
    return quoteBig({ good, stock, spreadBp: p.spread_bp, biasBp: p.bias_bp });
  }

  private buy(city: CityId, good: GoodId, qty: number) {
    const p = this.policy[city];
    return tradeCost({ good, side: "buy", qty, merchantStock: this.stock[city][good], spreadBp: p.spread_bp, biasBp: p.bias_bp });
  }
  private sell(city: CityId, good: GoodId, qty: number) {
    const p = this.policy[city];
    return tradeCost({ good, side: "sell", qty, merchantStock: this.stock[city][good], spreadBp: p.spread_bp, biasBp: p.bias_bp });
  }

  private botWorth(b: Bot): number {
    let w = b.cash;
    for (const [g, q] of Object.entries(b.inv) as Array<[GoodId, number]>) w += Number(GOODS[g].baseFils) * q;
    return w;
  }

  private plan(from: CityId, cash: number): { score: number; good: GoodId; qty: number; dest: CityId } | null {
    let best: { score: number; good: GoodId; qty: number; dest: CityId } | null = null;
    for (const dest of CITY_IDS) {
      if (dest === from) continue;
      const route = findRoute(from, dest)!;
      const ticks = Math.ceil(route.durationSec / PARAMS.TICK_SECONDS);
      for (const good of GOOD_IDS) {
        let q = Math.min(PARAMS.MAX_QTY_PER_TRADE, Math.trunc(this.stock[from][good] / 2), GOODS[good].cap - this.stock[dest][good]);
        if (q <= 0) continue;
        let c = this.buy(from, good, q);
        let cost = Number(c.total + c.fee);
        if (cost > cash) {
          q = Math.max(0, Math.trunc((q * cash) / cost) - 1);
          if (q <= 0) continue;
          c = this.buy(from, good, q);
          cost = Number(c.total + c.fee);
        }
        const s = this.sell(dest, good, q);
        const rev = Math.min(Number(s.total), this.treasury[dest]);
        const net = rev - Math.trunc((rev * PARAMS.TRADE_FEE_BP) / 10000);
        const expected = Math.trunc((net * (10000 - Math.trunc((route.riskBp * PARAMS.AMBUSH_LOSS_BP) / 10000))) / 10000) - cost;
        const score = expected / ticks;
        if (best === null || score > best.score) best = { score, good, qty: q, dest };
      }
    }
    return best;
  }

  private botArrive(b: Bot): void {
    const dest = b.dest!;
    const route = findRoute(b.city, dest)!;
    const ambushed = this.rng.next() < route.riskBp / 10000;
    if (ambushed) this.ambushes++;
    b.city = dest;
    for (const [good, q0] of Object.entries(b.inv) as Array<[GoodId, number]>) {
      let q = ambushed ? q0 - Math.trunc((q0 * PARAMS.AMBUSH_LOSS_BP) / 10000) : q0;
      const room = GOODS[good].cap - this.stock[dest][good];
      if (q > room) {
        this.warehouseFull++;
        q = Math.max(0, room);
      }
      if (q <= 0) continue;
      let s = this.sell(dest, good, q);
      if (s.total > BigInt(this.treasury[dest])) {
        this.brokeEvents++;
        q = Math.trunc((q * this.treasury[dest]) / Math.max(1, Number(s.total)));
        while (q > 0 && this.sell(dest, good, q).total > BigInt(this.treasury[dest])) q--;
        if (q <= 0) continue;
        s = this.sell(dest, good, q);
      }
      this.treasury[dest] -= Number(s.total);
      this.stock[dest][good] += q;
      b.cash += Number(s.total - s.fee);
      this.house += Number(s.fee);
    }
    b.inv = {};
    b.dest = null;
    if (b.startWorth !== null) this.profits.push(this.botWorth(b) - b.startWorth);
  }

  private botAct(b: Bot): void {
    if (b.dest !== null && this.tick >= b.arriveTick) this.botArrive(b);
    if (b.dest !== null) return;
    const p = this.plan(b.city, b.cash);
    if (p && p.score > 0) {
      const c = this.buy(b.city, p.good, p.qty);
      const cost = Number(c.total);
      b.startWorth = this.botWorth(b);
      b.cash -= cost + Number(c.fee);
      this.treasury[b.city] += cost;
      this.house += Number(c.fee);
      this.stock[b.city][p.good] -= p.qty;
      b.inv = { [p.good]: p.qty };
      b.dest = p.dest;
      b.arriveTick = this.tick + Math.ceil(findRoute(b.city, p.dest)!.durationSec / PARAMS.TICK_SECONDS);
      return;
    }
    // nothing profitable here: walk (empty) to the neighbour with the best plan
    let best: { score: number; dest: CityId } | null = null;
    for (const d of CITY_IDS) {
      if (d === b.city) continue;
      const q = this.plan(d, b.cash);
      const ticks = Math.ceil(findRoute(b.city, d)!.durationSec / PARAMS.TICK_SECONDS);
      if (q && q.score > 0 && (best === null || q.score / (ticks + 1) > best.score)) best = { score: q.score / (ticks + 1), dest: d };
    }
    if (best) {
      b.startWorth = null;
      b.dest = best.dest;
      b.inv = {};
      b.arriveTick = this.tick + Math.ceil(findRoute(b.city, best.dest)!.durationSec / PARAMS.TICK_SECONDS);
    }
  }

  private recordPrices(): void {
    for (const c of CITY_IDS) {
      for (const g of GOOD_IDS) {
        const m = Number(this.quoteAt(c, g, this.stock[c][g]).mid);
        if (!this.priceSeen || m < this.lo[g]) this.lo[g] = m;
        if (!this.priceSeen || m > this.hi[g]) this.hi[g] = m;
      }
      this.priceSeen = true;
    }
  }

  moneyNow(): number {
    return this.house + CITY_IDS.reduce((s, c) => s + this.treasury[c], 0) + this.bots.reduce((s, b) => s + b.cash, 0);
  }

  private stepTick(): void {
    this.tick++;
    // 1. production, consumption (stock clamped to [0, 2 x target])
    for (const id of CITY_IDS) {
      const spec = CITIES[id];
      for (const [g, n] of Object.entries(spec.produces) as Array<[GoodId, number]>) {
        this.stock[id][g] = Math.min(GOODS[g].cap, this.stock[id][g] + n);
      }
      for (const [g, n] of Object.entries(spec.consumes) as Array<[GoodId, number]>) {
        this.stock[id][g] = Math.max(0, this.stock[id][g] - n);
      }
    }
    // 2. treasury rebalancing, 3. house recycling
    let poorest: CityId = CITY_IDS[0]!;
    for (const c of CITY_IDS) if (this.treasury[c] < this.treasury[poorest]) poorest = c;
    const from = Math.trunc((INIT * PARAMS.REBALANCE_EXCESS_FROM_BP) / 10000);
    for (const c of CITY_IDS) {
      if (c !== poorest && this.treasury[c] > from) {
        const x = Math.trunc(((this.treasury[c] - from) * PARAMS.REBALANCE_PCT) / 100);
        this.treasury[c] -= x;
        this.treasury[poorest] += x;
      }
    }
    const pay = Math.trunc((this.house * PARAMS.HOUSE_RECYCLE_PCT) / 100);
    this.house -= pay;
    this.treasury[poorest] += pay;
    // players
    for (const b of this.bots) this.botAct(b);
    if (this.tick % 20 === 0) this.recordPrices();
    for (const c of CITY_IDS) {
      this.spreadSum += this.policy[c].spread_bp;
      this.spreadN++;
    }
    const total = this.moneyNow();
    if (total !== this.moneyStart) throw new Error(`money not conserved at tick ${this.tick}: ${total} != ${this.moneyStart}`);
  }

  stats(): SimStats {
    const sorted = [...this.profits].sort((a, b) => a - b);
    const n = sorted.length;
    const median = n === 0 ? 0 : n % 2 ? sorted[(n - 1) / 2]! : Math.trunc((sorted[n / 2 - 1]! + sorted[n / 2]!) / 2);
    const priceRange = {} as Record<GoodId, [number, number]>;
    for (const g of GOOD_IDS) priceRange[g] = [this.lo[g], this.hi[g]];
    return {
      trips: n,
      medianProfit: median,
      brokeEvents: this.brokeEvents,
      warehouseFullEvents: this.warehouseFull,
      ambushes: this.ambushes,
      priceRange,
      treasuries: { ...this.treasury },
      house: this.house,
      meanSpreadBp: this.spreadN === 0 ? 0 : Math.trunc(this.spreadSum / this.spreadN),
      moneyNow: this.moneyNow(),
      moneyStart: this.moneyStart,
    };
  }
}
