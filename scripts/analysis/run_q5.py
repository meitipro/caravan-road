"""Question 5 (Python half): operator exposure under whales, value flux, and a conservation tally. Writes results/q5.md.
The integer-math loop checks (round trips, closed loops, split trades, policy drift, stall fee, ambush rounding) are in exploits.ts.
Run from the repo root: python scripts/analysis/run_q5.py
Every table runs at the spec-v1.2 baseline MULT_K_BP = 3000 (econ_variant.K_SPEC); the titles say so.
"""
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import econ_variant as E  # noqa: E402

OUT = os.path.join(HERE, "results")
SEEDS = (7, 11, 13, 17, 19, 23, 29, 31, 37, 41)
KB = f"K = {E.K_SPEC} (spec-v1.2 baseline)"


def table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out)


def f0(x):
    return f"{x:,.0f}"


def main():
    md = []
    # 5A: whales. LIVE caps a player's deposit at 200,000 fils (20 USDC); operator seed capital is 4 x 50,000.
    rows = []
    for label, mk in (("A (Appendix B)", E.appendix_b), ("C (contract rules)", E.contract_full)):
        for bots, cash in ((1, 200000), (2, 200000), (4, 200000), (5, 50000), (10, 50000)):
            for ticks in (240, 1440):
                rs = [E.run(mk(bots=bots, bot_cash=cash, ticks=ticks, seed=s)) for s in SEEDS]
                n = len(rs)
                fin = sum(r["operator_final"] for r in rs) / n
                worst = min(r["min_operator"] for r in rs)
                mean_worst = sum(r["min_operator"] for r in rs) / n
                gain = sum(r["bot_cash_final"] - cash * bots for r in rs) / n
                rows.append([label, f"{bots} x {cash:,}", ticks, f0(fin), f0(mean_worst), f0(worst), f"{-worst / 2000:.0f}%" if worst < 0 else "0%", f0(gain),
                             f"{sum(1 for r in rs if r['conserved'])}/{n}"])
    md.append(f"#### 5A. Operator exposure ({KB}): merchants + house cash vs their 200,000-fils seed (10 seeds). Whales hold the 200,000-fils LIVE deposit cap in cash\n")
    md.append(table(["rules", "players x starting cash (fils)", "ticks", "operator P&L at end (mean, fils)", "worst operator P&L over time (mean of seeds)", "worst single seed (fils)", "worst seed as % of the 200,000 seed capital", "players' cash gain at end (mean, fils)", "money conserved"], rows))
    md.append("")

    # 5B: value flux
    flux = 0
    rows = []
    for g in E.GOODS:
        gid = g["id"]
        prod = sum(c["prod"].get(gid, 0) for c in E.W.CITIES)
        cons = sum(c["cons"].get(gid, 0) for c in E.W.CITIES)
        v = prod * g["base"]
        flux += v
        rows.append([gid, prod, cons, f0(g["base"]), f0(v)])
    rows.append(["all goods", "", "", "", f"{f0(flux)} fils/tick = {flux * 60 / 10000:,.0f} USDC-equivalent per hour of goods created"])
    md.append("#### 5B. Goods created per tick at base price (the only thing that is not conserved; money is)\n")
    md.append(table(["good", "produced / tick (world)", "consumed / tick (world)", "base (fils)", "value created / tick (fils)"], rows))
    md.append("")
    # 5C: why spice/silk live on the clamps: house caravans cannot pay for them with a 50,000-fils treasury
    rows = []
    for label, mk in (("A (Appendix B)", E.appendix_b), ("C (contract rules)", E.contract_full)):
        for tr in (50000, 100000, 200000):
            rs = [E.run(mk(bots=5, treasury=tr, seed=s)) for s in SEEDS]
            n = len(rs)
            cells = [f"{sum(r['shipped'][g] for r in rs) / n:,.0f} / {sum(r['blocked'][g] for r in rs) / n:,.0f}" for g in E.GOOD_IDS]
            rows.append([label, f"{tr:,}"] + cells)
    md.append(f"#### 5C. NPC shipping per good, {KB}, 5 bots, 240 ticks, 10-seed means: units shipped per run / ticks where the gap test passed but the receiving treasury (A) or its 25% budget (C) could not pay\n")
    md.append(table(["rules", "treasury per merchant (fils)"] + [f"{g}" for g in E.GOOD_IDS], rows))
    md.append("")

    # 5D: contract semantics (unsold goods stay with the player) vs the reference (destroyed): who ends up with the cash
    rows = []
    for label, mk in (("A (Appendix B)", E.appendix_b), ("C (contract rules)", E.contract_full)):
        for bots in (5, 10):
            for keep in (False, True):
                rs = [E.run(mk(bots=bots, keep_unsold=keep, ticks=240, seed=s)) for s in SEEDS]
                n = len(rs)
                rows.append([label, bots, "unsold kept by the player" if keep else "unsold destroyed (reference)",
                             f0(sum(r["trips"] for r in rs) / n), f0(sum(sum(r["treasury"].values()) for r in rs) / n),
                             f0(sum(r["min_treasury"] for r in rs) / n), f"{100 * sum(r['dry_share'] for r in rs) / n:.1f}%",
                             f0(sum(r["operator_final"] for r in rs) / n), f0(sum(r["bot_cash_final"] for r in rs) / n),
                             f"{sum(1 for r in rs if r['conserved'])}/{n}"])
    md.append(f"#### 5D. Cash location at the end of 240 ticks, {KB}, 10-seed means (merchant seed capital 200,000; bots start with 50,000 each)\n")
    md.append(table(["rules", "bots", "policy for the unsold part of a truncated cargo", "trips", "sum of merchant treasuries (fils)", "lowest single treasury seen (mean)", "merchant-ticks < 20% of seed", "operator P&L (merchants + house - 200,000)", "bots' cash (fils)", "conserved"], rows))
    md.append("")
    open(os.path.join(OUT, "q5.md"), "w", encoding="utf-8").write("\n".join(md))
    json.dump(E.COUNT, open(os.path.join(OUT, "conservation_q5.json"), "w"))
    print("q5 done", E.COUNT)


if __name__ == "__main__":
    main()
