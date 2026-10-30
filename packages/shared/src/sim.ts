// Port of the reference economy simulation (scripts/ref/economy_sim.py, master plan Appendix B).
// Same rules, same parameters, same random stream (see pyrandom.ts), so for the same seed it
// produces the same numbers as the Python version. Do not change a rule here: write disagreements
// to spec/OPEN_QUESTIONS.md.
//
// Money is plain JS numbers here: every value stays far below 2^53. Prices come from quoteBig().

import { PyRandom } from "./pyrandom.js";
import { quoteBig } from "./quote.js";
import type { CityId, GoodId } from "./types.js";
import { CITIES, CITY_IDS, GOODS, GOOD_IDS, PARAMS, ROUTES } from "./world.js";

export interface SimOptions {
  bots: number;
  ticks: number;
  seed: number;
  /** House caravans, treasury rebalancing and fee recycling. Python: argv[4] != "nonpc". */
  npc: boolean;
  rebalPct: number;
  housePct: number;
  /** Called after every tick with the total money (merchants + house + bot cash). */
  onTick?: (tick: number, totalMoney: number) => void;
}

export interface SimResult {
  options: SimOptions;
  trips: number;
  medianProfit: number;
  p10: number;
  p90: number;
  treasury: Record<CityId, number>;
  brokeEvents: number;
  house: number;
  botWorth: number[];
  stock: Record<CityId, Record<GoodId, number>>;
  priceRange: Record<GoodId, [number, number]>;
  moneyNow: number;
  moneyStart: number;
}

type Inventory = Partial<Record<GoodId, number>>;

class Bot {
  city: CityId;
  cash = 50000;
  inv: Inventory = {};
  arrive = 0;
  dest: CityId | null = null;
  tripStartValue: number | null = null;
  constructor(readonly id: number, rng: PyRandom) {
    this.city = rng.choice(CITY_IDS);
  }
  worth(): number {
    let w = this.cash;
    for (const [g, q] of Object.entries(this.inv) as Array<[GoodId, number]>) w += Number(GOODS[g].baseFils) * q;
    return w;
  }
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export function defaultSimOptions(): SimOptions {
  return { bots: 5, ticks: 240, seed: 7, npc: true, rebalPct: 30, housePct: 10 };
}

function mid(good: GoodId, stock: number): number {
  return Number(quoteBig({ good, stock, spreadBp: PARAMS.SPREAD_DEFAULT_BP, biasBp: 0 }).mid);
}
function bid(good: GoodId, stock: number): number {
  return Number(quoteBig({ good, stock, spreadBp: PARAMS.SPREAD_DEFAULT_BP, biasBp: 0 }).bid);
}
function ask(good: GoodId, stock: number): number {
  return Number(quoteBig({ good, stock, spreadBp: PARAMS.SPREAD_DEFAULT_BP, biasBp: 0 }).ask);
}

export function runSim(opts: SimOptions): SimResult {
  const rng = new PyRandom(opts.seed);
  const stock = {} as Record<CityId, Record<GoodId, number>>;
  const treasury = {} as Record<CityId, number>;
  for (const c of CITY_IDS) {
    stock[c] = {} as Record<GoodId, number>;
    for (const g of GOOD_IDS) stock[c][g] = GOODS[g].target;
    treasury[c] = PARAMS.MERCHANT_TREASURY_FILS;
  }
  let house = 0;

  const route = new Map<string, { ticks: number; risk: number }>();
  for (const r of ROUTES) {
    const v = { ticks: Math.ceil(r.durationSec / PARAMS.TICK_SECONDS), risk: r.riskBp };
    route.set(`${r.a}|${r.b}`, v);
    route.set(`${r.b}|${r.a}`, v);
  }
  const getRoute = (a: CityId, b: CityId) => route.get(`${a}|${b}`)!;

  const sellPriceToMerchant = (city: CityId, good: GoodId, qty: number) =>
    bid(good, stock[city][good] + Math.floor(qty / 2)) * qty;
  const buyPriceFromMerchant = (city: CityId, good: GoodId, qty: number) =>
    ask(good, Math.max(0, stock[city][good] - Math.floor(qty / 2))) * qty;

  const bots: Bot[] = [];
  for (let i = 0; i < opts.bots; i++) bots.push(new Bot(i, rng));

  let brokeEvents = 0;
  const tripProfits: number[] = [];
  const lo = {} as Record<GoodId, number>;
  const hi = {} as Record<GoodId, number>;
  let priceSeen = false;

  type Plan = { score: number; good: GoodId; qty: number; dest: CityId };
  function plan(bot: Bot): Plan | null {
    let best: Plan | null = null;
    for (const dest of CITY_IDS) {
      if (dest === bot.city) continue;
      const { ticks, risk } = getRoute(bot.city, dest);
      for (const gid of GOOD_IDS) {
        let q = Math.min(PARAMS.CARGO_CAP, floorDiv(stock[bot.city][gid], 2));
        if (q <= 0) continue;
        let cost = buyPriceFromMerchant(bot.city, gid, q);
        let fee = floorDiv(cost * PARAMS.TRADE_FEE_BP, 10000);
        if (cost + fee > bot.cash) {
          q = Math.max(0, Math.trunc((q * bot.cash) / (cost + fee)) - 1);
          if (q <= 0) continue;
          cost = buyPriceFromMerchant(bot.city, gid, q);
          fee = floorDiv(cost * PARAMS.TRADE_FEE_BP, 10000);
        }
        let rev = sellPriceToMerchant(dest, gid, q);
        rev = Math.min(rev, treasury[dest]);
        rev -= floorDiv(rev * PARAMS.TRADE_FEE_BP, 10000);
        const exp =
          floorDiv(rev * (10000 - floorDiv(risk * PARAMS.AMBUSH_LOSS_BP, 10000)), 10000) - cost - fee;
        const score = exp / ticks;
        if (best === null || score > best.score) best = { score, good: gid, qty: q, dest };
      }
    }
    return best;
  }

  const moneyStart = PARAMS.MERCHANT_TREASURY_FILS * 4 + 50000 * opts.bots;
  const totalMoney = () =>
    house + CITY_IDS.reduce((s, c) => s + treasury[c], 0) + bots.reduce((s, b) => s + b.cash, 0);

  for (let t = 0; t < opts.ticks; t++) {
    // world tick: production, then consumption
    for (const c of CITIES_LIST) {
      for (const [gid, n] of Object.entries(c.produces) as Array<[GoodId, number]>) {
        const cap = GOODS[gid].target * PARAMS.STOCK_CAP_FACTOR;
        stock[c.id][gid] = Math.min(cap, stock[c.id][gid] + n);
      }
      for (const [gid, n] of Object.entries(c.consumes) as Array<[GoodId, number]>) {
        stock[c.id][gid] = Math.max(0, stock[c.id][gid] - n);
      }
    }
    if (opts.npc) {
      // house caravans
      for (const gid of GOOD_IDS) {
        const target = GOODS[gid].target;
        const ratio = {} as Record<CityId, number>;
        for (const c of CITY_IDS) ratio[c] = stock[c][gid] / target;
        let hiC: CityId = CITY_IDS[0];
        let loC: CityId = CITY_IDS[0];
        for (const c of CITY_IDS) {
          if (ratio[c] > ratio[hiC]) hiC = c;
          if (ratio[c] < ratio[loC]) loC = c;
        }
        if ((ratio[hiC] - ratio[loC]) * 10000 >= PARAMS.NPC_MIN_RATIO_GAP_BP) {
          const n = Math.min(PARAMS.NPC_SHIP_UNITS_PER_TICK, stock[hiC][gid]);
          if (n > 0) {
            const m = floorDiv(mid(gid, stock[hiC][gid]) + mid(gid, stock[loC][gid]), 2);
            const pay = m * n;
            if (treasury[loC] >= pay) {
              treasury[loC] -= pay;
              treasury[hiC] += pay;
              stock[hiC][gid] -= n;
              stock[loC][gid] += n;
            }
          }
        }
      }
      // treasury rebalancing and fee recycling
      const init = PARAMS.MERCHANT_TREASURY_FILS;
      let poorest: CityId = CITY_IDS[0];
      for (const c of CITY_IDS) if (treasury[c] < treasury[poorest]) poorest = c;
      for (const c of CITY_IDS) {
        if (c !== poorest && treasury[c] > floorDiv(init * 3, 2)) {
          const x = floorDiv((treasury[c] - floorDiv(init * 3, 2)) * opts.rebalPct, 100);
          treasury[c] -= x;
          treasury[poorest] += x;
        }
      }
      const pay = floorDiv(house * opts.housePct, 100);
      house -= pay;
      treasury[poorest] += pay;
    }

    for (const b of bots) {
      if (b.dest !== null && t >= b.arrive) {
        const { risk } = getRoute(b.city, b.dest);
        const ambushed = rng.random() < risk / 10000;
        for (const [gid, q0] of Object.entries(b.inv) as Array<[GoodId, number]>) {
          let q = q0;
          if (ambushed) q = floorDiv(q * (10000 - PARAMS.AMBUSH_LOSS_BP), 10000);
          b.city = b.dest;
          if (q <= 0) continue;
          let rev = sellPriceToMerchant(b.city, gid, q);
          if (rev > treasury[b.city]) {
            brokeEvents++;
            q = floorDiv(q * treasury[b.city], Math.max(1, rev));
            rev = q > 0 ? sellPriceToMerchant(b.city, gid, q) : 0;
          }
          const fee = floorDiv(rev * PARAMS.TRADE_FEE_BP, 10000);
          treasury[b.city] -= rev;
          stock[b.city][gid] += q;
          b.cash += rev - fee;
          house += fee;
        }
        b.city = b.dest;
        b.inv = {};
        b.dest = null;
        if (b.tripStartValue !== null) tripProfits.push(b.worth() - b.tripStartValue);
      }
      if (b.dest === null) {
        let p = plan(b);
        if (!(p && p.score > 0)) {
          let best: { score: number; dest: CityId; ticks: number } | null = null;
          for (const d of CITY_IDS) {
            if (d === b.city) continue;
            const save = b.city;
            b.city = d;
            const q = plan(b);
            b.city = save;
            const tk = getRoute(b.city, d).ticks;
            if (q && q.score > 0 && (best === null || q.score / (tk + 1) > best.score)) {
              best = { score: q.score / (tk + 1), dest: d, ticks: tk };
            }
          }
          if (best) {
            b.dest = best.dest;
            b.arrive = t + best.ticks;
            b.inv = {};
            b.tripStartValue = null;
            p = null;
          }
        }
        if (p && p.score > 0) {
          const cost = buyPriceFromMerchant(b.city, p.good, p.qty);
          const fee = floorDiv(cost * PARAMS.TRADE_FEE_BP, 10000);
          b.tripStartValue = b.worth();
          b.cash -= cost + fee;
          treasury[b.city] += cost;
          house += fee;
          stock[b.city][p.good] -= p.qty;
          b.inv = { [p.good]: p.qty };
          b.dest = p.dest;
          b.arrive = t + getRoute(b.city, p.dest).ticks;
        }
      }
    }

    if (t % 20 === 0) {
      for (const c of CITY_IDS) {
        for (const g of GOOD_IDS) {
          const m = mid(g, stock[c][g]);
          if (!priceSeen || m < lo[g]) lo[g] = m;
          if (!priceSeen || m > hi[g]) hi[g] = m;
        }
        priceSeen = true;
      }
    }
    opts.onTick?.(t, totalMoney());
  }

  const sorted = [...tripProfits].sort((a, b) => a - b);
  const median = (): number => {
    if (sorted.length === 0) return 0;
    const n = sorted.length;
    const m = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
    return Math.trunc(m);
  };
  const priceRange = {} as Record<GoodId, [number, number]>;
  for (const g of GOOD_IDS) priceRange[g] = [lo[g], hi[g]];

  return {
    options: opts,
    trips: tripProfits.length,
    medianProfit: median(),
    p10: sorted.length ? sorted[Math.floor(sorted.length / 10)]! : 0,
    p90: sorted.length ? sorted[sorted.length - Math.max(1, Math.floor(sorted.length / 10))]! : 0,
    treasury,
    brokeEvents,
    house,
    botWorth: bots.map((b) => b.worth()),
    stock,
    priceRange,
    moneyNow: totalMoney(),
    moneyStart,
  };
}

const CITIES_LIST = CITY_IDS.map((id) => CITIES[id]);

/** Summary in the shape of the Python version's output. */
export function formatSummary(r: SimResult): string {
  const o = r.options;
  const obj = (x: object): string =>
    "{" + Object.entries(x).map(([k, v]) => `'${k}': ${typeof v === "object" ? obj(v as object) : v}`).join(", ") + "}";
  const lines = [
    `bots=${o.bots} ticks=${o.ticks} (~${Math.floor((o.ticks * PARAMS.TICK_SECONDS) / 60)} min)`,
    `trips: ${r.trips} | median profit/trip (fils): ${r.medianProfit} | p10: ${r.p10} | p90: ${r.p90}`,
    `merchant treasuries (fils): ${obj(r.treasury)} | merchant-broke events: ${r.brokeEvents}`,
    `house balance (fils): ${r.house}`,
    `bot net worth (fils): [${r.botWorth.join(", ")}]`,
    "final stock:",
    ...CITY_IDS.map((c) => `  ${c} ${obj(r.stock[c])}`),
    `mid price range seen (fils): ${obj(Object.fromEntries(GOOD_IDS.map((g) => [g, `(${r.priceRange[g][0]}, ${r.priceRange[g][1]})`])))}`,
    `money check: merchants+house+bot cash = ${r.moneyNow} (start ${r.moneyStart}; ambush destroys goods only)`,
  ];
  return lines.join("\n");
}
