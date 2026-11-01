"""Question 4: is the first profitable trade achievable in under one minute? (writes results/q4.md)

Method: take world states (stock + merchant treasuries) from the instrumented sim and ask what a SENSIBLE new player with the
PLAY faucet (50,000 fils) would earn in expectation from one journey, using the exact integer price/fee/ambush rules:
  buy q at the origin merchant (ask at stock - q//2, +1% fee), travel, maybe get ambushed (risk_bp = base x 6500^g // 10000^g, loss floor(30%) per good),
  sell what the destination merchant can pay for (largest q' with total <= treasury and stock+q' <= 2 x target; unsold goods are valued at 0 = conservative),
  1% fee on the sale, guards cost g x 2% of the cargo base value (truncated).
Expected profit (EP) = (1-r) x net(q) + r x net(q - floor(0.3 q)) - cost - buy fee - guard cost.
Run from the repo root: python scripts/analysis/run_q4.py
"""
import itertools
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import econ_variant as E  # noqa: E402

OUT = os.path.join(HERE, "results")
os.makedirs(OUT, exist_ok=True)
CASH = 50000
SHORT = {("bandar", "shahr"), ("shahr", "bandar")}
FEE = 100


def risk_bp(base, g):
    return base * 6500 ** g // 10000 ** g


def ambush_keep(q):
    return q - q * 3000 // 10000


def pct(x, d=1):
    return f"{100 * x:.{d}f}%"


def f0(x):
    return f"{x:,.0f}"


def table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out)


class World:
    def __init__(self, c, stock, treasury):
        self.c, self.stock, self.treasury = c, stock, treasury
        self.cap = {g: E.tgt(c, g) * 2 for g in E.GOOD_IDS}

    def net_table(self, dest, gid):
        """net[q'] = revenue after fee when selling q' units at dest; sold[qa] = largest feasible q' <= qa."""
        c = self.c
        st, T = self.stock[dest][gid], self.treasury[dest]
        net = [0] * 41
        feas = [True] + [False] * 40
        for q in range(1, 41):
            if st + q > self.cap[gid]:
                continue
            tot = E.sell_total(c, gid, st, q)
            if tot <= T:
                feas[q] = True
                net[q] = tot - tot * FEE // 10000
        sold = [0] * 41
        for qa in range(1, 41):
            sold[qa] = qa if feas[qa] else sold[qa - 1]
        return net, sold

    def best_single(self, routes=None, max_guards=3, only_guard=None):
        """Best single-good trip over all (origin, dest) directed routes (or the given set)."""
        c = self.c
        best = None
        for o in E.CITY_IDS:
            for d in E.CITY_IDS:
                if o == d or (routes is not None and (o, d) not in routes):
                    continue
                ticks, base_risk, sec = E.ROUTE[(o, d)]
                for gid in E.GOOD_IDS:
                    net, sold = self.net_table(d, gid)
                    so = self.stock[o][gid]
                    for q in range(1, min(40, so) + 1):
                        cost = E.buy_total(c, gid, so, q)
                        fee = cost * FEE // 10000
                        if cost + fee > CASH:
                            break
                        for g in range(0, max_guards + 1) if only_guard is None else (only_guard,):
                            r = risk_bp(base_risk, g)
                            gc = q * E.BASE[gid] * 200 * g // 10000
                            if cost + fee + gc > CASH:
                                continue
                            ok = net[sold[q]]
                            bad = net[sold[ambush_keep(q)]]
                            ep = ((10000 - r) * ok + r * bad) / 10000 - cost - fee - gc
                            if best is None or ep > best["ep"]:
                                best = dict(ep=ep, o=o, d=d, gid=gid, q=q, g=g, outlay=cost + fee + gc, r=r, sec=sec, ok=ok, bad=bad)
        return best

    def best_immune_bundle(self, routes=None):
        """Best cargo with at most 3 units of every good: floor(30% x 3) = 0, so an ambush destroys nothing. No guards needed."""
        c = self.c
        order = sorted(E.GOOD_IDS, key=lambda g: -E.BASE[g])
        best = None
        for o in E.CITY_IDS:
            for d in E.CITY_IDS:
                if o == d or (routes is not None and (o, d) not in routes):
                    continue
                sec = E.ROUTE[(o, d)][2]
                costs = {}
                for gid in E.GOOD_IDS:
                    so = self.stock[o][gid]
                    costs[gid] = [(0, 0)] + [(E.buy_total(c, gid, so, q) + E.buy_total(c, gid, so, q) * FEE // 10000, q) for q in range(1, 4)]
                for combo in itertools.product(range(4), repeat=5):
                    q_of = dict(zip(E.GOOD_IDS, combo))
                    if any(q_of[g] > self.stock[o][g] for g in E.GOOD_IDS):
                        continue
                    outlay = sum(costs[g][q_of[g]][0] for g in E.GOOD_IDS)
                    if outlay > CASH or sum(combo) == 0:
                        continue
                    rev = 0
                    T = {}
                    for gid in order:
                        q = q_of[gid]
                        if q == 0:
                            continue
                        st = self.stock[d][gid]
                        Trem = T.setdefault("t", self.treasury[d])
                        qq = q
                        while qq > 0 and (st + qq > self.cap[gid] or E.sell_total(c, gid, st, qq) > T["t"]):
                            qq -= 1
                        if qq > 0:
                            tot = E.sell_total(c, gid, st, qq)
                            T["t"] -= tot
                            rev += tot - tot * FEE // 10000
                    ep = rev - outlay
                    if best is None or ep > best["ep"]:
                        best = dict(ep=ep, o=o, d=d, combo=combo, outlay=outlay, sec=sec)
        return best


def fresh_world(c):
    return World(c, {cc: {g: E.tgt(c, g) for g in E.GOOD_IDS} for cc in E.CITY_IDS}, {cc: c.treasury for cc in E.CITY_IDS})


def main():
    md = []
    # ---------- 4A: fresh world, no bots
    rows = []
    for rule, mk in (("A", E.appendix_b), ("C", E.contract_full), ("A, no NPC", lambda **kw: E.appendix_b(npc=False, **kw))):
        c = mk(bots=0, ticks=181, snap_at=tuple(range(181)))
        r = E.run(c)
        first_short = first_any = None
        eps = {}
        for n in range(0, 182):
            w = fresh_world(c) if n == 0 else World(c, r["snaps"][n - 1][0], r["snaps"][n - 1][1])
            bs = w.best_single(routes=SHORT, only_guard=0)
            ba = w.best_single(only_guard=0)
            if first_short is None and bs and bs["ep"] > 0:
                first_short = (n, bs)
            if first_any is None and ba and ba["ep"] > 0:
                first_any = (n, ba)
            if n in (0, 10, 20, 30, 60, 120, 180):
                eps[n] = (bs["ep"] if bs else 0, ba["ep"] if ba else 0)
        def fmt(x):
            return "never within 181 ticks" if x is None else f"tick {x[0]} ({x[0]} min): {f0(x[1]['ep'])} fils on {x[1]['o']}>{x[1]['d']} {x[1]['q']} {x[1]['gid']}"
        rows.append([rule, fmt(first_short), fmt(first_any)] + [f"{f0(eps[n][0])} / {f0(eps[n][1])}" for n in (0, 10, 30, 60, 120)])
    md.append("#### 4A. Fresh world (no players, nothing traded yet): first tick at which a positive expected-profit trade exists for a 500-dinar player (0 guards)\n")
    md.append(table(["rules", "first positive trade, shortest route bandar-shahr", "first positive trade, any route", "best EP at 0 min: short / any (fils)", "10 min", "30 min", "60 min", "120 min"], rows))
    md.append("")

    # ---------- 4B: established worlds
    rows = []
    detail = []
    for rule, mk in (("A", E.appendix_b), ("C", E.contract_full)):
        for bots in (0, 2, 5, 10):
            eps_s, eps_a, route_a, gu, imm_s, imm_a, pos_s, pos_a, n_snap = [], [], {}, 0, [], [], 0, 0, 0
            for seed in (7, 11, 13):
                c = mk(bots=bots, seed=seed, ticks=241, snap_at=tuple(range(59, 241, 20)))
                r = E.run(c)
                for t in range(59, 241, 20):
                    w = World(c, r["snaps"][t][0], r["snaps"][t][1])
                    bs = w.best_single(routes=SHORT)
                    ba = w.best_single()
                    n_snap += 1
                    eps_s.append(bs["ep"] if bs else 0)
                    eps_a.append(ba["ep"] if ba else 0)
                    pos_s += 1 if bs and bs["ep"] > 0 else 0
                    pos_a += 1 if ba and ba["ep"] > 0 else 0
                    if ba:
                        key = f"{ba['o']}>{ba['d']}"
                        route_a[key] = route_a.get(key, 0) + 1
                        gu += 1 if ba["g"] > 0 else 0
            eps_s.sort()
            eps_a.sort()
            med = lambda xs: xs[len(xs) // 2]
            top = max(route_a, key=route_a.get)
            rows.append([rule, bots, n_snap, pct(pos_s / n_snap, 0), f"{f0(med(eps_s))} ({pct(med(eps_s) / CASH)})", f"{f0(sum(eps_s) / len(eps_s))}",
                         pct(pos_a / n_snap, 0), f"{f0(med(eps_a))} ({pct(med(eps_a) / CASH)})", f"{f0(sum(eps_a) / len(eps_a))}", f"{top} ({route_a[top]}/{n_snap})", pct(gu / n_snap, 0)])
    md.append("#### 4B. Established worlds (state after 60, 80, ..., 240 ticks; seeds 7, 11, 13 pooled): best expected profit of one journey for a 500-dinar newcomer (guards chosen optimally)\n")
    md.append(table(["rules", "bots in world", "snapshots", "short route: positive EP", "short route: median EP (fils, % of 50,000)", "short route: mean EP", "any route: positive EP", "any route: median EP (% of capital)", "any route: mean EP", "most common best route", "snapshots where >= 1 guard is optimal"], rows))
    md.append("")

    # ---------- 4C: guard EV by route (analytic, integer rules, 40 units)
    rows = []
    for a, b, sec, risk in E.W.ROUTES:
        cells = []
        for g in (1, 2, 3):
            r0, r1 = risk_bp(risk, g - 1), risk_bp(risk, g)
            save = (r0 - r1) * 30 / 10000  # percent of cargo value saved in expectation: (risk drop in bp / 10000) x 30% x 100
            cells.append(f"{r1} bp; saves {save:.2f}% of cargo vs costs 2.00%")
        rows.append([f"{a}-{b}", sec, risk] + cells)
    md.append("#### 4C. Marginal value of each guard (40-unit cargo, loss 12 of 40 units = 30%): risk after the guard, expected saving vs the 2% price\n")
    md.append(table(["route", "seconds", "base risk (bp)", "guard 1", "guard 2", "guard 3"], rows))
    md.append("")

    # ---------- 4D: immune bundles vs best single good (short route), same snapshots
    rows = []
    for rule, mk in (("A", E.appendix_b), ("C", E.contract_full)):
        for bots in (0, 5):
            s_eps, i_eps, i_eps_short, s_eps_short = [], [], [], []
            combos = []
            for seed in (7, 11, 13):
                c = mk(bots=bots, seed=seed, ticks=241, snap_at=(59, 119, 179, 239))
                r = E.run(c)
                for t in (59, 119, 179, 239):
                    w = World(c, r["snaps"][t][0], r["snaps"][t][1])
                    s_eps.append(w.best_single()["ep"])
                    s_eps_short.append(w.best_single(routes=SHORT)["ep"])
                    bi = w.best_immune_bundle()
                    bs = w.best_immune_bundle(routes=SHORT)
                    i_eps.append(bi["ep"])
                    i_eps_short.append(bs["ep"])
                    combos.append(bs["combo"])
            m = lambda xs: sum(xs) / len(xs)
            rows.append([rule, bots, len(s_eps), f"{f0(m(s_eps_short))} ({pct(m(s_eps_short) / CASH)})", f"{f0(m(i_eps_short))} ({pct(m(i_eps_short) / CASH)})",
                         f"{f0(m(s_eps))} ({pct(m(s_eps) / CASH)})", f"{f0(m(i_eps))} ({pct(m(i_eps) / CASH)})"])
    md.append("#### 4D. Ambush-immune cargo (at most 3 units of each good, floor(30% x 3) = 0) vs the best single-good cargo, mean expected profit, snapshots at 60/120/180/240 ticks, seeds 7, 11, 13\n")
    md.append(table(["rules", "bots", "snapshots", "short route: best single good (guards optimal)", "short route: best immune bundle", "any route: best single good", "any route: best immune bundle"], rows))
    md.append("")

    # ---------- 4E: time to first realised profit
    rows = []
    for a, b, sec, risk in E.W.ROUTES:
        ticks = E.ROUTE[(a, b)][0]
        rows.append([f"{a}-{b}", f"{sec} s", f"{ticks} ticks", f"{risk} bp", pct(risk / 10000, 0), pct(1 - (1 - risk / 10000) ** 3, 1)])
    md.append("#### 4E. Journey times and ambush odds (game data); the shortest possible journey is 180 s, so a REALISED profit cannot appear in 60 s\n")
    md.append(table(["route", "travel time", "sim ticks (ceil)", "ambush risk, no guards", "as %", "P(at least one ambush in 3 trips)"], rows))
    md.append("")
    # ---------- 4F: realised first trip of a newcomer in the instrumented sim (existing bots trade concurrently)
    rows = []
    seeds = (7, 11, 13, 17, 19, 23, 29, 31, 37, 41)
    mk_list = (("A (Appendix B)", E.appendix_b, {}), ("C (contract rules)", E.contract_full, {}), ("C + unsold goods kept", E.contract_full, {"keep_unsold": True}))
    for label, mk, extra in mk_list:
        for bots in (5, 10):
            for J in (0, 60, 120, 180):
                firsts, buys, arrs, poss, npos = [], [], [], [], 0
                n = 0
                for sd in seeds:
                    r = E.run(mk(bots=bots, seed=sd, ticks=J + 120, newcomer_tick=J, **extra))
                    nc = r["nc"]
                    n += 1
                    if nc["first_trip"] is None:
                        continue
                    t_arr, pf = nc["first_trip"]
                    firsts.append(pf)
                    buys.append(nc["first_buy"] - J)
                    arrs.append(t_arr - J)
                    if pf > 0:
                        npos += 1
                    if nc["first_pos"] is not None:
                        poss.append(nc["first_pos"] - J)

                def med(xs):
                    xs = sorted(xs)
                    return xs[len(xs) // 2] if xs else None

                mf = med(firsts)
                rows.append([label, bots, J, f"{len(firsts)}/{n}", pct(npos / max(1, len(firsts)), 0),
                             f"{f0(mf)} ({pct(mf / CASH)})" if mf is not None else "n/a",
                             f0(sum(firsts) / len(firsts)) if firsts else "n/a",
                             f"{med(buys)} min" if buys else "n/a", f"{med(arrs)} min" if arrs else "n/a",
                             f"{len(poss)}/{n}", f"{med(poss)} min" if poss else "n/a"])
    md.append("#### 4F. Realised first journey of a newcomer (greedy bot with 50,000 fils joining at minute J into a world of bots-1 active bots; 10 seeds; sim ticks = minutes)\n")
    md.append(table(["rules", "bots in world (incl. newcomer)", "joins at minute J", "newcomers that completed a first journey within 120 min", "first journey profitable", "median first-journey profit (fils, % of capital)", "mean first-journey profit (fils)",
                     "median minutes join to first purchase", "median minutes join to first arrival", "newcomers with any profitable arrival", "median minutes join to first profitable arrival"], rows))
    md.append("")
    open(os.path.join(OUT, "q4.md"), "w", encoding="utf-8").write("\n".join(md))
    import json
    json.dump(E.COUNT, open(os.path.join(OUT, "conservation_q4.json"), "w"))
    print("q4 done", E.COUNT)


if __name__ == "__main__":
    main()
