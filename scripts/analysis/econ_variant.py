"""Parametrised, instrumented variant of the reference economy simulation.

This is a line-by-line port of scripts/ref/economy_sim.py (which is only IMPORTED for its world data and
never modified) with extra knobs and counters. With the default Cfg() it reproduces the reference
output exactly (checked by validate.py against `python scripts/ref/economy_sim.py` and against the
TypeScript runSim()). Every rule switch below is OFF/Appendix-B by default.

Knobs (Cfg):
  treasury, bot_cash      merchant treasury and starting cash of each bot (fils)
  rebal_pct, house_pct    REBALANCE_PCT, HOUSE_RECYCLE_PCT
  ship_units, gap_bp      NPC_SHIP_UNITS_PER_TICK, NPC_MIN_RATIO_GAP_BP
  mult_k/min/max          MULT_K_BP, MULT_MIN_BP, MULT_MAX_BP
  loss_mode               'ceil' (Appendix B: q*7000//10000 survives) | 'floor' (contract: lose floor(30%))
  order                   'ref' (production, ship, rebalance, recycle) | 'contract' (production, rebalance, recycle, ship)
  gap_mode                'float' (reference) | 'int' ((hi-lo)*10000 >= gap*target)
  ship_mode               'auto' (reference house caravans) | 'merchant' (contract D25: destination below target,
                          pay at most 25% of its treasury per tick, qty fitted to the budget)
  warehouse_cap           reject/trim a sale that would push the merchant above 2 x target (contract rule)
  keep_unsold             a truncated sale keeps the unsold goods (reference destroys them)
  faucet*                 PLAY faucet for bots: net worth < 5000 fils, 60-tick cooldown, +50000 fils
Nothing here is a spec change; it is analysis tooling.
"""
import os
import random
import statistics
import sys
from dataclasses import dataclass, replace
from math import ceil

sys.dont_write_bytecode = True  # never write __pycache__ next to scripts/ref
HERE = os.path.dirname(os.path.abspath(__file__))
REF_DIR = os.path.normpath(os.path.join(HERE, "..", "ref"))
sys.path.insert(0, REF_DIR)
import world as W  # noqa: E402  (read only: world data, routes)

GOODS = W.GOODS
GOOD = W.GOOD
CITY = W.CITY
CITY_IDS = list(CITY)
GOOD_IDS = [g["id"] for g in GOODS]
BASE = {g["id"]: g["base"] for g in GOODS}
TARGET = {g["id"]: g["target"] for g in GOODS}
P = W.PARAMS


@dataclass(frozen=True)
class Cfg:
    bots: int = 5
    ticks: int = 240
    seed: int = 7
    npc: bool = True
    treasury: int = 50000
    bot_cash: int = 50000
    rebal_pct: int = 30
    rebal_from_bp: int = 15000
    house_pct: int = 10
    ship_units: int = 4
    gap_bp: int = 5000
    mult_k: int = 4000
    mult_min: int = 7500
    mult_max: int = 13500
    spread: int = 800
    fee_bp: int = 100
    loss_mode: str = "ceil"
    order: str = "ref"
    gap_mode: str = "float"
    ship_mode: str = "auto"
    ship_budget_pct: int = 25
    warehouse_cap: bool = False
    keep_unsold: bool = False
    faucet: bool = False
    faucet_thr: int = 5000
    faucet_amt: int = 50000
    faucet_cd: int = 60
    snap_at: tuple = ()  # ticks at which to snapshot stock/treasury (after the tick)
    newcomer_tick: int = -1  # >= 0: the LAST bot is a newcomer that stays idle until this tick (Q4)
    target_pct: tuple = ()  # e.g. (("spice", 200), ("silk", 200)): target stock (and cap) as % of spec value


def appendix_b(**kw):
    return Cfg(**kw)


def contract_d123(**kw):
    """Appendix B with the three spec-v1.1 decisions D1-D3 (floor loss, 2.8 tick order, integer gap)."""
    return Cfg(loss_mode="floor", order="contract", gap_mode="int", **kw)


def contract_full(**kw):
    """D1-D3 plus the contract-only rules that the sim lacks: D25 merchant ship limits and the warehouse cap."""
    return Cfg(loss_mode="floor", order="contract", gap_mode="int", ship_mode="merchant", warehouse_cap=True, **kw)


# ---------- price math (same integer rules as spec 2.6; stocks are never negative so // == truncation) ----------
def tdiv(a, b):
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def tgt(c, gid):
    for g, p in c.target_pct:
        if g == gid:
            return TARGET[gid] * p // 100
    return TARGET[gid]


def mult_bp(c, stock, target):
    m = 10000 + tdiv(c.mult_k * (target - stock), target)
    return max(c.mult_min, min(c.mult_max, m))


def quote(c, gid, stock, bias_bp=0, spread=None):
    s = c.spread if spread is None else spread
    mid = BASE[gid] * mult_bp(c, stock, tgt(c, gid)) // 10000
    mid = mid * (10000 + bias_bp) // 10000
    ask = mid * (10000 + s // 2) // 10000
    bid = mid * (10000 - s // 2) // 10000
    return bid, mid, ask


def buy_total(c, gid, stock, q):
    """Player buys q from a merchant holding `stock`: ask at the midpoint stock; fee not included."""
    return quote(c, gid, max(0, stock - q // 2))[2] * q


def sell_total(c, gid, stock, q):
    """Player sells q to a merchant holding `stock`: bid at the midpoint stock; fee not included."""
    return quote(c, gid, stock + q // 2)[0] * q


def route_table():
    r = {}
    for a, b, sec, risk in W.ROUTES:
        r[(a, b)] = r[(b, a)] = (ceil(sec / P["TICK_SECONDS"]), risk, sec)
    return r


ROUTE = route_table()


def gini(xs):
    xs = sorted(xs)
    n = len(xs)
    tot = sum(xs)
    if n == 0 or tot <= 0:
        return 0.0
    return sum((2 * (i + 1) - n - 1) * x for i, x in enumerate(xs)) / (n * tot)


class Bot:
    def __init__(self, i, rng, cash):
        self.id = i
        self.city = rng.choice(CITY_IDS)
        self.cash = cash
        self.inv = {}
        self.arrive = 0
        self.dest = None
        self.trip_start_value = None
        self.outlay = 0
        self.last_claim = 0
        self.claims = 0
        self.first_buy = None
        self.first_trip = None  # (arrival tick, profit)
        self.first_pos = None  # arrival tick of the first trip with profit > 0
        self.relocs = 0
        self.relocs_before_buy = 0

    def worth(self):
        return self.cash + sum(BASE[g] * q for g, q in self.inv.items())


COUNT = {"n": 0, "ok": 0}


def run(c: Cfg):
    rng = random.Random(c.seed)
    stock = {cid: {g: tgt(c, g) for g in GOOD_IDS} for cid in CITY_IDS}
    treasury = {cid: c.treasury for cid in CITY_IDS}
    house = 0
    bots = [Bot(i, rng, c.bot_cash) for i in range(c.bots)]
    cap = {g: tgt(c, g) * P["STOCK_CAP_FACTOR"] for g in GOOD_IDS}

    # counters
    S = dict(sales=0, trunc=0, pot_net=0.0, short_tr=0, short_wh=0, pot_profit=0, act_profit=0,
             units_unsold=0, base_unsold=0, wh_hits=0, overdraft=0, overdraft_fils=0, retry_sales=0,
             retry_trunc=0, ambushes=0, arrivals=0, relocations=0, purchases=0, buy_outlay=0)
    trip_profits = []
    shipped = {g: 0 for g in GOOD_IDS}  # units moved by house caravans / merchant ship
    blocked = {g: 0 for g in GOOD_IDS}  # ticks where the gap test passed but the receiving treasury / budget could not pay for one more unit
    injected = 0
    start_total = c.treasury * 4 + c.bot_cash * c.bots
    conserved = True
    min_treasury = c.treasury
    dry_ticks = 0
    clamp_hi = {g: 0 for g in GOOD_IDS}
    clamp_lo = {g: 0 for g in GOOD_IDS}
    clamp_n = 0
    below_thr_botticks = 0
    botticks = 0
    snaps = {}
    peak_bot_gain = 0
    min_operator = 0

    def mid_of(gid, s):
        return quote(c, gid, s)[1]

    def loss_keep(q):
        if c.loss_mode == "ceil":
            return q * (10000 - P["AMBUSH_LOSS_BP"]) // 10000
        return q - q * P["AMBUSH_LOSS_BP"] // 10000

    def plan(bot):
        best = None
        held = sum(bot.inv.values())
        for dest in CITY_IDS:
            if dest == bot.city:
                continue
            ticks, risk, _ = ROUTE[(bot.city, dest)]
            for gid in GOOD_IDS:
                q = min(P["CARGO_CAP"] - held, stock[bot.city][gid] // 2)
                if q <= 0:
                    continue
                cost = buy_total(c, gid, stock[bot.city][gid], q)
                fee = cost * c.fee_bp // 10000
                if cost + fee > bot.cash:
                    q = max(0, int(q * bot.cash / (cost + fee)) - 1)
                    if q <= 0:
                        continue
                    cost = buy_total(c, gid, stock[bot.city][gid], q)
                    fee = cost * c.fee_bp // 10000
                rev = sell_total(c, gid, stock[dest][gid], q)
                rev = min(rev, treasury[dest])
                rev -= rev * c.fee_bp // 10000
                exp = (rev * (10000 - risk * P["AMBUSH_LOSS_BP"] // 10000) // 10000) - cost - fee
                score = exp / ticks
                if best is None or score > best[0]:
                    best = (score, gid, q, dest)
        return best

    def sale(bot, gid, q, first):
        """Sell q of gid to the merchant of bot.city. Returns units left unsold. Updates counters."""
        nonlocal house
        city = bot.city
        rev_full = sell_total(c, gid, stock[city][gid], q)
        pot_net = rev_full - rev_full * c.fee_bp // 10000
        q0 = q
        # warehouse cap (contract): merchant stock may not exceed 2 x target
        if stock[city][gid] + q > cap[gid]:
            if c.warehouse_cap:
                S["wh_hits"] += 1
                q = max(0, cap[gid] - stock[city][gid])
            else:
                S["wh_hits"] += 1  # reference sim lets it through; count how often the contract would have refused
        rev_wh = sell_total(c, gid, stock[city][gid], q) if q > 0 else 0
        net_wh = rev_wh - rev_wh * c.fee_bp // 10000
        rev = rev_wh
        truncated = False
        if rev > treasury[city]:
            truncated = True
            q = q * treasury[city] // max(1, rev)
            rev = sell_total(c, gid, stock[city][gid], q) if q > 0 else 0
        fee = rev * c.fee_bp // 10000
        if first:
            S["sales"] += 1
            if truncated:
                S["trunc"] += 1
            S["pot_net"] += pot_net
            S["short_wh"] += pot_net - net_wh
            S["short_tr"] += net_wh - (rev - fee)
        else:
            S["retry_sales"] += 1
            if truncated:
                S["retry_trunc"] += 1
        if rev > treasury[city]:
            S["overdraft"] += 1
            S["overdraft_fils"] += rev - treasury[city]
        treasury[city] -= rev
        stock[city][gid] += q
        bot.cash += rev - fee
        house += fee
        unsold = q0 - q
        if first:
            bot._pot_sum += pot_net
            bot._act_sum += rev - fee
        return unsold

    def world_production():
        for cty in W.CITIES:
            for gid, n in cty["prod"].items():
                stock[cty["id"]][gid] = min(cap[gid], stock[cty["id"]][gid] + n)
            for gid, n in cty["cons"].items():
                stock[cty["id"]][gid] = max(0, stock[cty["id"]][gid] - n)

    def ship_auto():
        for gid in GOOD_IDS:
            target = tgt(c, gid)
            if c.gap_mode == "float":
                ratio = {cc: stock[cc][gid] / target for cc in CITY_IDS}
                hi_c = max(ratio, key=ratio.get)
                lo_c = min(ratio, key=ratio.get)
                ok = (ratio[hi_c] - ratio[lo_c]) * 10000 >= c.gap_bp
            else:
                st = {cc: stock[cc][gid] for cc in CITY_IDS}
                hi_c = max(st, key=st.get)
                lo_c = min(st, key=st.get)
                ok = (st[hi_c] - st[lo_c]) * 10000 >= c.gap_bp * target
            if ok:
                n = min(c.ship_units, stock[hi_c][gid])
                if n > 0:
                    mid = (mid_of(gid, stock[hi_c][gid]) + mid_of(gid, stock[lo_c][gid])) // 2
                    pay = mid * n
                    if treasury[lo_c] >= pay:
                        treasury[lo_c] -= pay
                        treasury[hi_c] += pay
                        stock[hi_c][gid] -= n
                        stock[lo_c][gid] += n
                        shipped[gid] += n
                    else:
                        blocked[gid] += 1

    def ship_merchant():
        budget = {cc: treasury[cc] * c.ship_budget_pct // 100 for cc in CITY_IDS}
        for gid in GOOD_IDS:
            target = tgt(c, gid)
            st = {cc: stock[cc][gid] for cc in CITY_IDS}
            hi_c = max(st, key=st.get)
            lo_c = min(st, key=st.get)
            if (st[hi_c] - st[lo_c]) * 10000 >= c.gap_bp * target and st[lo_c] < target:
                n = min(c.ship_units, st[hi_c])
                mid = (mid_of(gid, st[hi_c]) + mid_of(gid, st[lo_c])) // 2
                if mid <= 0:
                    continue
                n = min(n, budget[lo_c] // mid)
                if n == 0:
                    blocked[gid] += 1
                if n > 0:
                    pay = mid * n
                    if treasury[lo_c] >= pay:
                        treasury[lo_c] -= pay
                        treasury[hi_c] += pay
                        budget[lo_c] -= pay
                        stock[hi_c][gid] -= n
                        stock[lo_c][gid] += n
                        shipped[gid] += n

    def rebalance_and_recycle():
        nonlocal house
        init = c.treasury
        poorest = min(treasury, key=treasury.get)
        thr = init * c.rebal_from_bp // 10000
        for cc in CITY_IDS:
            if cc != poorest and treasury[cc] > thr:
                x = (treasury[cc] - thr) * c.rebal_pct // 100
                treasury[cc] -= x
                treasury[poorest] += x
        pay = house * c.house_pct // 100
        house -= pay
        treasury[poorest] += pay

    for b in bots:
        b._pot_sum = 0
        b._act_sum = 0

    for t in range(c.ticks):
        world_production()
        if c.npc:
            if c.order == "ref":
                if c.ship_mode == "auto":
                    ship_auto()
                else:
                    ship_merchant()
                rebalance_and_recycle()
            else:
                rebalance_and_recycle()
                if c.ship_mode == "auto":
                    ship_auto()
                else:
                    ship_merchant()
        for b in bots:
            if c.newcomer_tick >= 0 and b.id == c.bots - 1 and t < c.newcomer_tick:
                continue
            if c.faucet and t - b.last_claim >= c.faucet_cd and b.worth() < c.faucet_thr:
                b.cash += c.faucet_amt
                injected += c.faucet_amt
                b.last_claim = t
                b.claims += 1
            if b.dest and t >= b.arrive:
                ticks, risk, _ = ROUTE[(b.city, b.dest)]
                ambushed = rng.random() < risk / 10000
                S["arrivals"] += 1
                if ambushed:
                    S["ambushes"] += 1
                left = {}
                b._pot_sum = 0
                b._act_sum = 0
                for gid, q in list(b.inv.items()):
                    if ambushed:
                        q = loss_keep(q)
                    b.city = b.dest
                    if q <= 0:
                        continue
                    unsold = sale(b, gid, q, True)
                    if unsold > 0:
                        S["units_unsold"] += unsold
                        S["base_unsold"] += unsold * BASE[gid]
                        if c.keep_unsold:
                            left[gid] = left.get(gid, 0) + unsold
                b.city = b.dest
                b.inv = left if c.keep_unsold else {}
                b.dest = None
                if b.outlay > 0:
                    S["pot_profit"] += b._pot_sum - b.outlay
                    S["act_profit"] += b._act_sum - b.outlay
                b.outlay = 0
                if b.trip_start_value is not None:
                    pf = b.worth() - b.trip_start_value
                    trip_profits.append(pf)
                    if b.first_trip is None:
                        b.first_trip = (t, pf)
                    if pf > 0 and b.first_pos is None:
                        b.first_pos = t
            if b.dest is None:
                if c.keep_unsold and b.inv:
                    for gid, q in list(b.inv.items()):
                        if q > 0 and treasury[b.city] > 0:
                            un = sale(b, gid, q, False)
                            if un > 0:
                                b.inv[gid] = un
                            else:
                                del b.inv[gid]
                p = plan(b)
                if not (p and p[0] > 0):
                    best = None
                    for d in CITY_IDS:
                        if d == b.city:
                            continue
                        save = b.city
                        b.city = d
                        q = plan(b)
                        b.city = save
                        tk = ROUTE[(b.city, d)][0]
                        if q and q[0] > 0 and (best is None or q[0] / (tk + 1) > best[0]):
                            best = (q[0] / (tk + 1), d, tk)
                    if best:
                        S["relocations"] += 1
                        b.relocs += 1
                        b.dest = best[1]
                        b.arrive = t + best[2]
                        if not c.keep_unsold:
                            b.inv = {}
                        b.trip_start_value = None
                        p = None
                if c.keep_unsold and b.dest is None and b.inv and not (p and p[0] > 0):
                    # human-like fallback: carry the unsold goods to the city whose merchant can pay the most for them
                    lbest = None
                    for d in CITY_IDS:
                        if d == b.city:
                            continue
                        tk, risk, _ = ROUTE[(b.city, d)]
                        Trem, est = treasury[d], 0
                        for gid, q in sorted(b.inv.items(), key=lambda kv: -BASE[kv[0]]):
                            qq = q
                            while qq > 0 and (stock[d][gid] + qq > cap[gid] or sell_total(c, gid, stock[d][gid], qq) > Trem):
                                qq -= 1
                            if qq > 0:
                                tot = sell_total(c, gid, stock[d][gid], qq)
                                Trem -= tot
                                est += tot - tot * c.fee_bp // 10000
                        est = est * (10000 - risk * P["AMBUSH_LOSS_BP"] // 10000) // 10000
                        if est > 0 and (lbest is None or est / tk > lbest[0]):
                            lbest = (est / tk, d, tk)
                    if lbest:
                        b.dest = lbest[1]
                        b.arrive = t + lbest[2]
                        b.trip_start_value = b.worth()
                        b.outlay = 0
                if p and p[0] > 0:
                    _, gid, q, dest = p
                    cost = buy_total(c, gid, stock[b.city][gid], q)
                    fee = cost * c.fee_bp // 10000
                    b.trip_start_value = b.worth()
                    if b.first_buy is None:
                        b.first_buy = t
                        b.relocs_before_buy = b.relocs
                    b.cash -= cost + fee
                    b.outlay = cost + fee
                    S["purchases"] += 1
                    S["buy_outlay"] += cost + fee
                    treasury[b.city] += cost
                    house += fee
                    stock[b.city][gid] -= q
                    if c.keep_unsold:
                        b.inv[gid] = b.inv.get(gid, 0) + q
                    else:
                        b.inv = {gid: q}
                    b.dest = dest
                    b.arrive = t + ROUTE[(b.city, dest)][0]

        # ---- end-of-tick instrumentation ----
        total = house + sum(treasury.values()) + sum(b.cash for b in bots)
        if total != start_total + injected:
            conserved = False
        op = sum(treasury.values()) + house - c.treasury * 4
        min_operator = min(min_operator, op)
        mt = min(treasury.values())
        min_treasury = min(min_treasury, mt)
        for cc in CITY_IDS:
            if treasury[cc] < c.treasury * 20 // 100:
                dry_ticks += 1
            for g in GOOD_IDS:
                m = mult_bp(c, stock[cc][g], tgt(c, g))
                if m >= c.mult_max:
                    clamp_hi[g] += 1
                elif m <= c.mult_min:
                    clamp_lo[g] += 1
        clamp_n += 4
        for b in bots:
            botticks += 1
            if b.worth() < 5000:
                below_thr_botticks += 1
        if t in c.snap_at:
            snaps[t] = (
                {cc: dict(stock[cc]) for cc in CITY_IDS},
                dict(treasury),
                house,
            )

    COUNT["n"] += 1
    COUNT["ok"] += 1 if conserved else 0
    worths = [b.worth() for b in bots]
    srt = sorted(trip_profits)
    n = len(srt)
    res = dict(
        cfg=c,
        trips=n,
        median=int(statistics.median(srt)) if n else 0,
        mean=(sum(srt) / n) if n else 0.0,
        p10=srt[n // 10] if n else 0,
        p90=srt[-max(1, n // 10)] if n else 0,
        broke=S["trunc"],
        sales=S["sales"],
        trunc_share=(S["trunc"] / S["sales"]) if S["sales"] else 0.0,
        pot_net=S["pot_net"],
        short_tr=S["short_tr"],
        short_wh=S["short_wh"],
        lost_rev_share=((S["short_tr"] + S["short_wh"]) / S["pot_net"]) if S["pot_net"] else 0.0,
        pot_profit=S["pot_profit"],
        act_profit=S["act_profit"],
        units_unsold=S["units_unsold"],
        base_unsold=S["base_unsold"],
        wh_hits=S["wh_hits"],
        overdraft=S["overdraft"],
        overdraft_fils=S["overdraft_fils"],
        ambushes=S["ambushes"],
        arrivals=S["arrivals"],
        relocations=S["relocations"],
        purchases=S["purchases"],
        buy_outlay=S["buy_outlay"],
        retry_sales=S["retry_sales"],
        treasury=dict(treasury),
        house=house,
        worths=worths,
        gini=gini(worths),
        final_below50=sum(1 for w in worths if w < 5000),
        timeavg_below50=(below_thr_botticks / botticks) if botticks else 0.0,
        claims=sum(b.claims for b in bots),
        injected=injected,
        conserved=conserved,
        min_treasury=min_treasury,
        dry_share=dry_ticks / (c.ticks * 4),
        clamp_hi={g: clamp_hi[g] / clamp_n for g in GOOD_IDS},
        clamp_lo={g: clamp_lo[g] / clamp_n for g in GOOD_IDS},
        stock=stock,
        snaps=snaps,
        min_operator=min_operator,
        operator_final=sum(treasury.values()) + house - c.treasury * 4,
        bot_cash_final=sum(b.cash for b in bots),
        start_total=start_total,
        shipped=shipped,
        blocked=blocked,
        nc=(dict(join=c.newcomer_tick, first_buy=bots[-1].first_buy, first_trip=bots[-1].first_trip, first_pos=bots[-1].first_pos,
                 relocs_before_buy=bots[-1].relocs_before_buy) if (c.newcomer_tick >= 0 and bots) else None),
    )
    return res


def mean_over(results, key):
    vals = [r[key] for r in results]
    return sum(vals) / len(vals)


def with_(c, **kw):
    return replace(c, **kw)
