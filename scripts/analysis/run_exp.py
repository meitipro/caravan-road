"""Experiments for questions 1-3 of docs/ECONOMY_TUNING.md (merchant treasuries, wealth/bankruptcy, price clamps).

Run from the repo root:   python scripts/analysis/run_exp.py            (all)   |   python scripts/analysis/run_exp.py q1
Writes scripts/analysis/results/q1.md, q2.md, q3.md (markdown tables) and conservation.json.
Seeds: SEEDS3 = 7, 11, 13 for per-seed tables; SEEDS10 = ten seeds 7, 11, 13, 17, 19, 23, 29, 31, 37, 41 for averages.
"""
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import econ_variant as E  # noqa: E402

OUT = os.path.join(HERE, "results")
os.makedirs(OUT, exist_ok=True)
SEEDS3 = (7, 11, 13)
SEEDS10 = (7, 11, 13, 17, 19, 23, 29, 31, 37, 41)  # 10 seeds; the first five are 7, 11, 13, 17, 19

RUNS = {"n": 0, "conserved": 0}


def go(cfg):
    r = E.run(cfg)
    RUNS["n"] += 1
    RUNS["conserved"] += 1 if r["conserved"] else 0
    return r


def many(make, seeds, **kw):
    return [go(make(seed=s, **kw)) for s in seeds]


def _sd(xs):
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / max(1, len(xs) - 1)) ** 0.5


def agg(rs):
    n = len(rs)
    sales = sum(r["sales"] for r in rs)
    pot = sum(r["pot_net"] for r in rs)
    potp = sum(r["pot_profit"] for r in rs)
    actp = sum(r["act_profit"] for r in rs)
    trips = sum(r["trips"] for r in rs)
    tot_profit = sum(r["mean"] * r["trips"] for r in rs)
    bots = rs[0]["cfg"].bots
    return dict(
        n=n,
        trips=trips / n,
        sales=sales / n,
        trunc=sum(r["trunc_share"] * r["sales"] for r in rs) / sales if sales else 0.0,
        broke=sum(r["broke"] for r in rs) / n,
        lost_rev=(sum(r["short_tr"] + r["short_wh"] for r in rs) / pot) if pot else 0.0,
        pot_trip=potp / sales if sales else 0.0,
        act_trip=actp / sales if sales else 0.0,
        trunc_sd=_sd([r["trunc_share"] for r in rs]),
        median=sum(r["median"] for r in rs) / n,
        mean=(tot_profit / trips) if trips else 0.0,
        dry=sum(r["dry_share"] for r in rs) / n,
        gini=sum(r["gini"] for r in rs) / n,
        below_end=sum(r["final_below50"] for r in rs) / (n * bots) if bots else 0.0,
        below_avg=sum(r["timeavg_below50"] for r in rs) / n,
        claims=sum(r["claims"] for r in rs) / n,
        injected=sum(r["injected"] for r in rs) / n,
        overdraft=sum(r["overdraft"] for r in rs) / n,
        wh=sum(r["wh_hits"] for r in rs) / n,
        unsold=sum(r["units_unsold"] for r in rs) / n,
        op_final=sum(r["operator_final"] for r in rs) / n,
        op_min=min(r["min_operator"] for r in rs),
        ambushes=sum(r["ambushes"] for r in rs) / n,
        arrivals=sum(r["arrivals"] for r in rs) / n,
        bot_total=sum(sum(r["worths"]) for r in rs) / n,
        clamp_hi={g: sum(r["clamp_hi"][g] for r in rs) / n for g in E.GOOD_IDS},
        clamp_lo={g: sum(r["clamp_lo"][g] for r in rs) / n for g in E.GOOD_IDS},
        cons=f"{sum(1 for r in rs if r['conserved'])}/{n}",
    )


def pct(x, d=1):
    return "n/a" if x != x else f"{100 * x:.{d}f}%"


def ppp(a):
    return f"{a['pot_trip']:,.0f} / {a['act_trip']:,.0f}"


def f0(x):
    return f"{x:,.0f}"


def f1(x):
    return f"{x:,.1f}"


def table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out)


MAKERS = {"A": E.appendix_b, "C": E.contract_full}
RULE_NAME = {"A": "Appendix B (`pnpm sim`)", "C": "contract rules (D1-D3, D25 ship limits, warehouse cap)"}


# ------------------------------------------------------------------ Q1
def q1():
    md = []
    # 1A per-seed, ruleset A and C
    for rule in ("A", "C"):
        rows = []
        for bots in (2, 5, 10):
            for s in SEEDS3:
                r = go(MAKERS[rule](bots=bots, seed=s))
                a = agg([r])
                rows.append([bots, s, r["trips"], r["sales"], r["broke"], pct(a["trunc"]), pct(a["lost_rev"]), ppp(a),
                             f0(r["median"]), pct(a["dry"]), r["overdraft"], r["wh_hits"], "yes" if r["conserved"] else "NO"])
        md.append(f"#### 1A-{rule}. Truncated sales per run, {RULE_NAME[rule]}, 240 ticks\n")
        md.append(table(["bots", "seed", "trips", "cargo sales", "truncated (= 'broke')", "truncated share", "net revenue lost",
                         "profit per cargo sale (fils): if merchant always paid / actual", "median profit/trip (fils)", "merchant-ticks with treasury < 20%", "overdrafts", "warehouse-cap hits", "money conserved"], rows))
        md.append("")
    # 1B 10-seed means
    rows = []
    for rule in ("A", "C"):
        for bots in (2, 5, 10):
            a = agg(many(MAKERS[rule], SEEDS10, bots=bots))
            rows.append([rule, bots, f1(a["trips"]), f1(a["sales"]), f1(a["broke"]), f"{pct(a['trunc'])} (sd {pct(a['trunc_sd'])})", pct(a["lost_rev"]), ppp(a),
                         f0(a["median"]), f0(a["mean"]), pct(a["dry"]), f1(a["overdraft"]), f1(a["wh"]), a["cons"]])
    md.append("#### 1B. Ten-seed means (seeds 7, 11, 13, 17, 19, 23, 29, 31, 37, 41), 240 ticks\n")
    md.append(table(["rules", "bots", "trips", "cargo sales", "truncated", "truncated share", "net revenue lost", "profit per cargo sale (fils): if merchant always paid / actual",
                     "median profit/trip (fils)", "mean profit/trip (fils)", "merchant-ticks < 20% treasury", "overdrafts", "warehouse hits", "conserved runs"], rows))
    md.append("")

    # 1C treasury sweep
    for rule in ("A", "C"):
        rows = []
        for bots in (5, 10):
            for tr in (50000, 75000, 100000, 150000, 200000):
                a = agg(many(MAKERS[rule], SEEDS10, bots=bots, treasury=tr))
                rows.append([bots, f"{tr:,}", f"{4 * tr / 10000:.0f}", f1(a["broke"]), pct(a["trunc"]), pct(a["lost_rev"]), ppp(a), f0(a["median"]), f0(a["mean"]),
                             pct(a["dry"]), f0(a["op_final"]), f0(a["op_min"]), a["cons"]])
        md.append(f"#### 1C-{rule}. Merchant treasury sweep, {RULE_NAME[rule]}, 10-seed means, 240 ticks (bot start cash stays 50,000)\n")
        md.append(table(["bots", "treasury per merchant (fils)", "operator seed capital (USDC)", "truncated sales", "truncated share", "net revenue lost", "profit per cargo sale (fils): if merchant always paid / actual",
                         "median profit/trip", "mean profit/trip", "merchant-ticks < 20%", "operator P&L at end (fils, mean)", "worst operator P&L seen (fils)", "conserved"], rows))
        md.append("")

    # 1D rebalance sweep, 1E house sweep, 1F ship units
    def sweep(title, tag, param, values, fmt=str):
        for rule in ("A", "C"):
            rows = []
            for bots in (5, 10):
                for v in values:
                    a = agg(many(MAKERS[rule], SEEDS10, bots=bots, **{param: v}))
                    rows.append([bots, fmt(v), f1(a["trips"]), f1(a["broke"]), pct(a["trunc"]), pct(a["lost_rev"]), ppp(a), f0(a["median"]), f0(a["mean"]), pct(a["dry"]), a["cons"]])
            md.append(f"#### {tag}-{rule}. {title}, {RULE_NAME[rule]}, 10-seed means, 240 ticks\n")
            md.append(table(["bots", param, "trips", "truncated sales", "truncated share", "net revenue lost", "profit per cargo sale (fils): if merchant always paid / actual", "median profit/trip", "mean profit/trip", "merchant-ticks < 20%", "conserved"], rows))
            md.append("")

    sweep("REBALANCE_PCT sweep (0 = rebalancing off, other NPC steps on)", "1D", "rebal_pct", (0, 10, 30, 50, 100))
    sweep("HOUSE_RECYCLE_PCT sweep (0 = recycling off)", "1E", "house_pct", (0, 5, 10, 25, 50))
    sweep("NPC_SHIP_UNITS_PER_TICK sweep (0 = no house caravans)", "1F", "ship_units", (0, 2, 4, 8, 16))

    # 1G keep_unsold
    rows = []
    for rule in ("A", "C"):
        for bots in (5, 10):
            for keep in (False, True):
                a = agg(many(MAKERS[rule], SEEDS10, bots=bots, keep_unsold=keep))
                rows.append([rule, bots, "keeps unsold goods" if keep else "unsold goods destroyed (reference)", f1(a["trips"]), f1(a["broke"]), pct(a["trunc"]), f0(a["unsold"]), f0(a["median"]), f0(a["mean"]), f0(a["bot_total"]), a["cons"]])
    md.append("#### 1G. What happens to the unsold part of a truncated cargo (10-seed means, 240 ticks)\n")
    md.append(table(["rules", "bots", "policy", "trips", "truncated sales", "truncated share", "units unsold per run", "median profit/trip", "mean profit/trip", "total bot net worth at end (fils)", "conserved"], rows))
    md.append("")
    open(os.path.join(OUT, "q1.md"), "w", encoding="utf-8").write("\n".join(md))


# ------------------------------------------------------------------ Q2
def q2():
    md = []
    rows = []
    for rule in ("A", "C"):
        for ticks in (240, 1440):
            for bots in (2, 5, 10):
                for fa in (False, True):
                    a = agg(many(MAKERS[rule], SEEDS10, bots=bots, ticks=ticks, faucet=fa))
                    rows.append([rule, f"{ticks} ({ticks // 60} h)", bots, "faucet on" if fa else "no faucet", f"{a['gini']:.2f}", f"{pct(a['below_end'], 0)}",
                                 pct(a["below_avg"], 1), f1(a["claims"] / bots), f"{a['injected'] / 10000:.1f}", f0(a["bot_total"] / bots), a["cons"]])
    md.append("#### 2A. Gini of final bot net worth and bots under 50 dinars, 10-seed means\n")
    md.append(table(["rules", "ticks", "bots", "PLAY faucet rule", "Gini of final net worth", "bots < 50 dinars at the end", "share of bot-ticks < 50 dinars", "faucet claims per bot", "money injected (USDC-equivalent per run)", "mean bot net worth at end (fils)", "conserved (start + injected)"], rows))
    md.append("")
    # 2B per-seed detail, 5 bots 240 ticks, A
    rows = []
    for fa in (False, True):
        for s in SEEDS3:
            r = go(E.appendix_b(bots=5, seed=s, faucet=fa))
            rows.append(["faucet on" if fa else "no faucet", s, ", ".join(f0(w) for w in sorted(r["worths"], reverse=True)), f"{r['gini']:.2f}", r["final_below50"], r["claims"]])
    md.append("#### 2B. Per-seed final net worth (fils), Appendix B rules, 5 bots, 240 ticks\n")
    md.append(table(["rule", "seed", "final net worth, richest first", "Gini", "bots < 5,000 fils", "claims"], rows))
    md.append("")
    # 2C: what is the lowest net worth a stuck bot has? how fast does a sub-threshold bot recover without faucet? time stuck
    open(os.path.join(OUT, "q2.md"), "w", encoding="utf-8").write("\n".join(md))


# ------------------------------------------------------------------ Q3
def q3():
    md = []
    # 3A analytic clamp thresholds
    rows = []
    for k in (2000, 3000, 3500, 4000, 6000, 8000):
        hi = 1 - 3500 / k  # stock/target at or below which mult = 13500
        lo = 1 + 2500 / k  # stock/target at or above which mult = 7500
        rows.append([k, f"{hi * 100:.1f}% of target" if hi > 0 else ("only at stock 0 (no effect)" if hi == 0 else "never (multiplier cannot reach 13,500)"),
                     f"{lo * 100:.1f}% of target" if lo < 2 else "never (above the 200% cap)",
                     f"{E.mult_bp(E.Cfg(mult_k=k), 0, 40)}", f"{E.mult_bp(E.Cfg(mult_k=k), 80, 40)}"])
    md.append("#### 3A. Where the multiplier clamps bind (analytic, from `mult_bp`)\n")
    md.append(table(["MULT_K_BP", "high clamp (13,500) when stock is at or below", "low clamp (7,500) when stock is at or above", "mult at stock 0", "mult at stock = 2 x target"], rows))
    md.append("")
    # 3B clamp share by good, default K
    for rule in ("A", "C"):
        rows = []
        for bots in (0, 2, 5, 10):
            for ticks in (240, 1440):
                a = agg(many(MAKERS[rule], SEEDS10, bots=bots, ticks=ticks))
                cells = []
                for g in E.GOOD_IDS:
                    cells.append(f"{pct(a['clamp_hi'][g], 0)} / {pct(a['clamp_lo'][g], 0)}")
                tot = (sum(a["clamp_hi"].values()) + sum(a["clamp_lo"].values())) / 5
                rows.append([bots, ticks] + cells + [pct(tot, 0), a["cons"]])
        md.append(f"#### 3B-{rule}. Share of time the multiplier sits at the HIGH clamp / LOW clamp, per good (all 4 cities pooled), {RULE_NAME[rule]}, 10-seed means\n")
        md.append(table(["bots", "ticks"] + [f"{g} (high / low)" for g in E.GOOD_IDS] + ["all goods at either clamp", "conserved"], rows))
        md.append("")
    # 3C K sweep
    for rule in ("A", "C"):
        rows = []
        for bots in (5, 10):
            for k in (2000, 3000, 4000, 6000, 8000):
                rs = many(MAKERS[rule], SEEDS10, bots=bots, mult_k=k)
                a = agg(rs)
                allc = (sum(a["clamp_hi"].values()) + sum(a["clamp_lo"].values())) / 5
                ss = (a["clamp_hi"]["spice"] + a["clamp_lo"]["spice"] + a["clamp_hi"]["silk"] + a["clamp_lo"]["silk"]) / 2
                gsi = sum(a["clamp_hi"][g] + a["clamp_lo"][g] for g in ("grain", "salt", "iron")) / 3
                rows.append([bots, k, pct(allc, 0), pct(ss, 0), pct(gsi, 0), f1(a["trips"]), f0(a["median"]), f0(a["mean"]), f1(a["broke"]), pct(a["trunc"]), pct(a["dry"]), f0(a["bot_total"] / bots), a["cons"]])
        md.append(f"#### 3C-{rule}. MULT_K_BP sweep, {RULE_NAME[rule]}, 10-seed means, 240 ticks (clamps 7,500 / 13,500)\n")
        md.append(table(["bots", "MULT_K_BP", "all goods at a clamp", "spice+silk at a clamp", "grain+salt+iron at a clamp", "trips", "median profit/trip (fils)", "mean profit/trip (fils)", "truncated sales", "truncated share", "merchant-ticks < 20%", "mean bot net worth at end (fils)", "conserved"], rows))
        md.append("")
    # 3D wider clamps
    rows = []
    for bots in (5, 10):
        for k, mn, mx in ((4000, 7500, 13500), (4000, 6000, 15000), (6000, 6000, 15000), (6000, 5000, 17000), (8000, 5000, 17000)):
            rs = many(E.appendix_b, SEEDS10, bots=bots, mult_k=k, mult_min=mn, mult_max=mx)
            a = agg(rs)
            allc = (sum(a["clamp_hi"].values()) + sum(a["clamp_lo"].values())) / 5
            ss = (a["clamp_hi"]["spice"] + a["clamp_lo"]["spice"] + a["clamp_hi"]["silk"] + a["clamp_lo"]["silk"]) / 2
            rows.append([bots, k, mn, mx, pct(allc, 0), pct(ss, 0), f1(a["trips"]), f0(a["median"]), f0(a["mean"]), f1(a["broke"]), pct(a["trunc"]), a["cons"]])
    md.append("#### 3D. Clamp widening together with MULT_K_BP, Appendix B rules, 10-seed means, 240 ticks\n")
    md.append(table(["bots", "MULT_K_BP", "MULT_MIN_BP", "MULT_MAX_BP", "all goods at a clamp", "spice+silk at a clamp", "trips", "median profit/trip", "mean profit/trip", "truncated sales", "truncated share", "conserved"], rows))
    md.append("")
    # 3E: bigger target stock (and cap) for the two goods that live on the clamps
    rows = []
    for rule in ("A", "C"):
        for bots in (5, 10):
            for label, tp in (("spec (40 / 30)", ()), ("x2 (80 / 60)", (("spice", 200), ("silk", 200))), ("x3 (120 / 90)", (("spice", 300), ("silk", 300)))):
                a = agg(many(MAKERS[rule], SEEDS10, bots=bots, target_pct=tp))
                ss = (a["clamp_hi"]["spice"] + a["clamp_lo"]["spice"] + a["clamp_hi"]["silk"] + a["clamp_lo"]["silk"]) / 2
                rows.append([rule, bots, label, pct(ss, 0), f1(a["trips"]), f0(a["median"]), f0(a["mean"]), f1(a["broke"]), pct(a["trunc"]), pct(a["dry"]), a["cons"]])
    md.append("#### 3E. Spice and silk target stock scaled (cap = 2 x target), MULT_K 4000 and clamps unchanged, 10-seed means, 240 ticks\n")
    md.append(table(["rules", "bots", "spice / silk target stock", "spice+silk at a clamp", "trips", "median profit/trip", "mean profit/trip", "truncated sales", "truncated share", "merchant-ticks < 20%", "conserved"], rows))
    md.append("")
    open(os.path.join(OUT, "q3.md"), "w", encoding="utf-8").write("\n".join(md))


if __name__ == "__main__":
    which = sys.argv[1:] or ["q1", "q2", "q3"]
    for w in which:
        {"q1": q1, "q2": q2, "q3": q3}[w]()
        print("done", w, RUNS)
    cons_path = os.path.join(OUT, "conservation_q123.json")
    json.dump(RUNS, open(cons_path, "w"))
