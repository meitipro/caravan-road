"""Validation of the analysis variant (run first; the doc quotes its output).

1. Default Cfg() == scripts/ref/economy_sim.py output (parsed from the real script, run as a subprocess).
2. Default Cfg() == TypeScript runSim() for the same options (including REBALANCE_PCT / HOUSE_RECYCLE_PCT).
3. contract_d123() reproduces the spec-v1.1 CHANGELOG numbers (61/6714/26, 132/933/44, 344/958/74).

Run from the repo root:  python scripts/analysis/validate.py
"""
import ast
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import econ_variant as E  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
TSX = os.path.join(ROOT, "packages", "shared", "node_modules", ".bin", "tsx.CMD" if os.name == "nt" else "tsx")


def ref_py(bots, ticks, seed, rebal=30, house=10, npc=True):
    args = [sys.executable, "-B", os.path.join(ROOT, "scripts", "ref", "economy_sim.py"), str(bots), str(ticks), str(seed),
            "npc" if npc else "nonpc", str(rebal), str(house)]
    out = subprocess.run(args, capture_output=True, text=True, check=True, cwd=os.path.join(ROOT, "scripts", "ref")).stdout
    m = re.search(r"trips: (\d+) \| median profit/trip \(fils\): (-?\d+) \| p10: (-?\d+) \| p90: (-?\d+)", out)
    trips, med, p10, p90 = map(int, m.groups())
    tr = ast.literal_eval(re.search(r"merchant treasuries \(fils\): (\{.*?\})", out).group(1))
    broke = int(re.search(r"merchant-broke events: (\d+)", out).group(1))
    house_bal = int(re.search(r"house balance \(fils\): (-?\d+)", out).group(1))
    worths = ast.literal_eval(re.search(r"bot net worth \(fils\): (\[.*?\])", out).group(1))
    return dict(trips=trips, median=med, p10=p10, p90=p90, treasury=tr, broke=broke, house=house_bal, worths=worths)


def ts_run(specs):
    out = subprocess.run([TSX, os.path.join(HERE, "ts_runsim.ts"), json.dumps(specs)], capture_output=True, text=True,
                         check=True, cwd=ROOT, shell=(os.name == "nt")).stdout
    return json.loads(out.strip().splitlines()[-1])


def key(r):
    return (r["trips"], r["median"], r["p10"], r["p90"], r["broke"], r["house"], tuple(r["worths"]), tuple(r["treasury"].values()))


def main():
    bad = 0
    print("== 1. Python variant (default Cfg) vs scripts/ref/economy_sim.py, and 2. vs TypeScript runSim ==")
    grid = []
    for bots in (2, 5, 10):
        for seed in (7, 11, 13):
            grid.append((bots, 240, seed, 30, 10, True))
    for rebal in (0, 10, 50, 100):
        grid.append((5, 240, 7, rebal, 10, True))
        grid.append((10, 240, 11, rebal, 10, True))
    for house in (0, 25, 50):
        grid.append((5, 240, 7, 30, house, True))
        grid.append((10, 240, 11, 30, house, True))
    grid.append((5, 240, 7, 30, 10, False))
    grid.append((0, 240, 7, 30, 10, True))
    specs = [dict(bots=b, ticks=t, seed=s, npc=n, rebalPct=rb, housePct=h) for (b, t, s, rb, h, n) in grid]
    ts = ts_run(specs)
    ok_ref = ok_ts = 0
    for (b, t, s, rb, h, n), tsr in zip(grid, ts):
        mine = E.run(E.Cfg(bots=b, ticks=t, seed=s, npc=n, rebal_pct=rb, house_pct=h))
        mine_k = (mine["trips"], mine["median"], mine["p10"], mine["p90"], mine["broke"], mine["house"], tuple(mine["worths"]),
                  tuple(mine["treasury"].values()))
        if b > 0:
            ref = ref_py(b, t, s, rb, h, n)
            if key(ref) == mine_k:
                ok_ref += 1
            else:
                bad += 1
                print("MISMATCH vs python ref", (b, t, s, rb, h, n), key(ref), mine_k)
        else:
            ok_ref += 1  # reference script divides by zero statistics for 0 bots; not comparable
        if key(tsr) == mine_k and tsr["conserved"] and mine["conserved"]:
            ok_ts += 1
        else:
            bad += 1
            print("MISMATCH vs TS", (b, t, s, rb, h, n), key(tsr), mine_k)
    print(f"python-variant == python-reference: {ok_ref}/{len(grid)} configs; python-variant == TypeScript runSim: {ok_ts}/{len(grid)} configs")

    print("== 3. contract_d123() vs spec/CHANGELOG.md spec-v1.1 numbers (seed 7, 240 ticks) ==")
    expect = {2: (61, 6714, 26), 5: (132, 933, 44), 10: (344, 958, 74)}
    for bots, (et, em, eb) in expect.items():
        r = E.run(E.contract_d123(bots=bots))
        got = (r["trips"], r["median"], r["broke"])
        flag = "OK " if got == (et, em, eb) else "DIFF"
        if got != (et, em, eb):
            bad += 1
        print(f"  {flag} bots={bots}: changelog {et}/{em}/{eb}  variant {got[0]}/{got[1]}/{got[2]}  conserved={r['conserved']}")
    print("VALIDATION", "PASSED" if bad == 0 else f"FAILED ({bad} problems)")
    return bad


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
