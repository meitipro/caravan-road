"""Caravan Road economy simulation (reference model).
Bots are greedy arbitrageurs. Trades are priced at the MIDPOINT stock of the trade.
Run: python3 economy_sim.py [bots] [ticks] [seed]
"""
import random
import statistics
import sys
from math import ceil

from world import CITIES, CITY, GOODS, GOOD, PARAMS as P, ROUTES, quote

N_BOTS = int(sys.argv[1]) if len(sys.argv) > 1 else 5
REBAL_PCT = int(sys.argv[5]) if len(sys.argv) > 5 else 30
HOUSE_PCT = int(sys.argv[6]) if len(sys.argv) > 6 else 10
USE_NPC = (sys.argv[4] != 'nonpc') if len(sys.argv) > 4 else True
TICKS = int(sys.argv[2]) if len(sys.argv) > 2 else 240
random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 7)

stock = {c["id"]: {g["id"]: g["target"] for g in GOODS} for c in CITIES}
treasury = {c["id"]: P["MERCHANT_TREASURY_FILS"] for c in CITIES}
house = 0
route = {}
for a, b, sec, risk in ROUTES:
    route[(a, b)] = route[(b, a)] = (ceil(sec / P["TICK_SECONDS"]), risk)


def sell_price_to_merchant(city, good, qty):
    """Player sells qty to merchant: merchant stock rises; price at midpoint stock."""
    s = stock[city][good]
    bid, _, _ = quote(good, s + qty // 2)
    return bid * qty


def buy_price_from_merchant(city, good, qty):
    s = stock[city][good]
    _, _, ask = quote(good, max(0, s - qty // 2))
    return ask * qty


class Bot:
    def __init__(self, i):
        self.id = i
        self.city = random.choice(list(CITY))
        self.cash = 50000
        self.inv = {}
        self.arrive = 0
        self.dest = None
        self.trips = []
        self.trip_start_value = None

    def worth(self):
        return self.cash + sum(GOOD[g]["base"] * q for g, q in self.inv.items())


def plan(bot):
    """Pick best (good, dest) by expected margin at current quotes."""
    best = None
    for dest in CITY:
        if dest == bot.city:
            continue
        ticks, risk = route[(bot.city, dest)]
        for g in GOODS:
            gid = g["id"]
            q = min(P["CARGO_CAP"], stock[bot.city][gid] // 2)
            if q <= 0:
                continue
            cost = buy_price_from_merchant(bot.city, gid, q)
            fee = cost * P["TRADE_FEE_BP"] // 10000
            if cost + fee > bot.cash:
                q = max(0, int(q * bot.cash / (cost + fee)) - 1)
                if q <= 0:
                    continue
                cost = buy_price_from_merchant(bot.city, gid, q)
                fee = cost * P["TRADE_FEE_BP"] // 10000
            rev = sell_price_to_merchant(dest, gid, q)
            rev = min(rev, treasury[dest])
            rev -= rev * P["TRADE_FEE_BP"] // 10000
            exp = (rev * (10000 - risk * P["AMBUSH_LOSS_BP"] // 10000) // 10000) - cost - fee
            score = exp / ticks
            if best is None or score > best[0]:
                best = (score, gid, q, dest)
    return best


bots = [Bot(i) for i in range(N_BOTS)]
log_prices = []
broke_events = 0
trip_profits = []

for t in range(TICKS):
    # world tick
    for c in CITIES:
        for gid, n in c["prod"].items():
            cap = GOOD[gid]["target"] * P["STOCK_CAP_FACTOR"]
            stock[c["id"]][gid] = min(cap, stock[c["id"]][gid] + n)
        for gid, n in c["cons"].items():
            stock[c["id"]][gid] = max(0, stock[c["id"]][gid] - n)
    # NPC house caravans: move stock from the most over-stocked city to the most under-stocked
    if USE_NPC:
        for g in GOODS:
            gid = g["id"]
            ratio = {c: stock[c][gid] / g["target"] for c in CITY}
            hi_c = max(ratio, key=ratio.get)
            lo_c = min(ratio, key=ratio.get)
            if (ratio[hi_c] - ratio[lo_c]) * 10000 >= P["NPC_MIN_RATIO_GAP_BP"]:
                n = min(P["NPC_SHIP_UNITS_PER_TICK"], stock[hi_c][gid])
                if n > 0:
                    mid = (quote(gid, stock[hi_c][gid])[1] + quote(gid, stock[lo_c][gid])[1]) // 2
                    pay = mid * n
                    if treasury[lo_c] >= pay:
                        treasury[lo_c] -= pay
                        treasury[hi_c] += pay
                        stock[hi_c][gid] -= n
                        stock[lo_c][gid] += n
    # treasury rebalancing (money-conserving): rich merchants top up the poorest, 10% of excess per tick
    if USE_NPC:
        init = P["MERCHANT_TREASURY_FILS"]
        poorest = min(treasury, key=treasury.get)
        for c in CITY:
            if c != poorest and treasury[c] > init * 3 // 2:
                x = (treasury[c] - init * 3 // 2) * REBAL_PCT // 100
                treasury[c] -= x
                treasury[poorest] += x
        # fee recycling: house pays 10% of its balance per tick to the poorest merchant
        pay = house * HOUSE_PCT // 100
        house -= pay
        treasury[poorest] += pay
    # bots
    for b in bots:
        if b.dest and t >= b.arrive:
            # claim + sell
            ticks, risk = route[(b.city, b.dest)]
            ambushed = random.random() < risk / 10000
            for gid, q in list(b.inv.items()):
                if ambushed:
                    q = q * (10000 - P["AMBUSH_LOSS_BP"]) // 10000
                b.city = b.dest
                if q <= 0:
                    continue
                rev = sell_price_to_merchant(b.city, gid, q)
                if rev > treasury[b.city]:
                    broke_events += 1
                    q = q * treasury[b.city] // max(1, rev)
                    rev = sell_price_to_merchant(b.city, gid, q) if q > 0 else 0
                fee = rev * P["TRADE_FEE_BP"] // 10000
                treasury[b.city] -= rev
                stock[b.city][gid] += q
                b.cash += rev - fee
                house += fee
            b.city = b.dest
            b.inv = {}
            b.dest = None
            if b.trip_start_value is not None:
                trip_profits.append(b.worth() - b.trip_start_value)
        if b.dest is None:
            p = plan(b)
            if not (p and p[0] > 0):
                best = None
                for d in CITY:
                    if d == b.city:
                        continue
                    save = b.city
                    b.city = d
                    q = plan(b)
                    b.city = save
                    tk = route[(b.city, d)][0]
                    if q and q[0] > 0 and (best is None or q[0] / (tk + 1) > best[0]):
                        best = (q[0] / (tk + 1), d, tk)
                if best:
                    b.dest = best[1]
                    b.arrive = t + best[2]
                    b.inv = {}
                    b.trip_start_value = None
                    p = None
            if p and p[0] > 0:
                _, gid, q, dest = p
                cost = buy_price_from_merchant(b.city, gid, q)
                fee = cost * P["TRADE_FEE_BP"] // 10000
                b.trip_start_value = b.worth()
                b.cash -= cost + fee
                treasury[b.city] += cost
                house += fee
                stock[b.city][gid] -= q
                b.inv = {gid: q}
                b.dest = dest
                b.arrive = t + route[(b.city, dest)][0]
    if t % 20 == 0:
        log_prices.append((t, {c: {g: quote(g, stock[c][g])[1] for g in GOOD} for c in CITY}))

print(f"bots={N_BOTS} ticks={TICKS} (~{TICKS * P['TICK_SECONDS'] // 60} min)")
print("trips:", len(trip_profits),
      "| median profit/trip (fils):", int(statistics.median(trip_profits)) if trip_profits else 0,
      "| p10:", int(sorted(trip_profits)[len(trip_profits) // 10]) if trip_profits else 0,
      "| p90:", int(sorted(trip_profits)[-max(1, len(trip_profits) // 10)]) if trip_profits else 0)
print("merchant treasuries (fils):", treasury, "| merchant-broke events:", broke_events)
print("house balance (fils):", house)
print("bot net worth (fils):", [b.worth() for b in bots])
tot = house + sum(treasury.values()) + sum(b.cash + sum(GOOD[g]['base'] * q for g, q in b.inv.items()) for b in bots)
print("final stock:")
for c in CITY:
    print(" ", c, stock[c])
lo = {g: min(l[1][c][g] for l in log_prices for c in CITY) for g in GOOD}
hi = {g: max(l[1][c][g] for l in log_prices for c in CITY) for g in GOOD}
print("mid price range seen (fils):", {g: (lo[g], hi[g]) for g in GOOD})

goods_val = sum(GOOD[g]["base"] * q for b in bots for g, q in b.inv.items())
print("money check: merchants+house+bot cash =", sum(treasury.values()) + house + sum(b.cash for b in bots),
      "(start", P["MERCHANT_TREASURY_FILS"] * 4 + 50000 * N_BOTS, "; ambush destroys goods only)")
