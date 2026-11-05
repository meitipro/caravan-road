"""Validation of the analysis variant (run first; docs/ECONOMY_TUNING.md quotes its output).

Like with like: every comparison below is made at ONE stated MULT_K_BP (the "K"), for the variant, the reference and
(where possible) the shared TypeScript sim. K is a parameter:

    python scripts/analysis/validate.py            # K = 3000 (spec-v1.2 baseline), then K = 4000 (spec-v1.1, for the evidence)
    python scripts/analysis/validate.py --k 3000   # one K only

0. K consistency: the K in scripts/ref/world.py, packages/shared/src/world.ts and contracts/caravan/src/math.rs vs the
   variant default (econ_variant.K_SPEC). If they disagree the run says so instead of comparing apples to oranges.
1. Python variant (Cfg(mult_k=K)) == scripts/ref/economy_sim.py (the real script, run as a subprocess). If K differs from the
   K written in scripts/ref/world.py the script is run through a tiny wrapper that sets world.PARAMS["MULT_K_BP"] = K in
   memory first (the file on disk is never touched).
2. Python variant == TypeScript runSim(), only when K equals the K compiled into packages/shared (runSim cannot take a K).
3. The CHANGELOG figures of the spec version that used this K:
     K = 3000: spec-v1.2 -> Appendix B rules 53/5795/10, 190/1392/47, 329/689/72 (what `pnpm sim` prints) and the
               contract-rule figures 53/8175/16, 182/739/28, 314/704/66 (`contract_d123`)
     K = 4000: spec-v1.1 -> contract-rule figures 61/6714/26, 132/933/44, 344/958/74

Run from the repo root.
"""
import argparse
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
REF_DIR = os.path.join(ROOT, "scripts", "ref")
TSX = os.path.join(ROOT, "packages", "shared", "node_modules", ".bin", "tsx.CMD" if os.name == "nt" else "tsx")

# spec CHANGELOG figures: (trips, median, broke) for seed 7, 240 ticks
CHANGELOG = {
    3000: {
        "name": "spec-v1.2",
        "appendix_b": {2: (53, 5795, 10), 5: (190, 1392, 47), 10: (329, 689, 72)},
        "contract_d123": {2: (53, 8175, 16), 5: (182, 739, 28), 10: (314, 704, 66)},
    },
    4000: {
        "name": "spec-v1.1",
        "appendix_b": {2: (64, 5944, 23), 5: (177, 1088, 43), 10: (342, 1099, 86)},
        "contract_d123": {2: (61, 6714, 26), 5: (132, 933, 44), 10: (344, 958, 74)},
    },
}

TOTAL = {"runs": 0, "conserved": 0}


def read_k(path, pattern):
    try:
        m = re.search(pattern, open(path, encoding="utf-8").read())
        return int(m.group(1)) if m else None
    except OSError:
        return None


def source_ks():
    return {
        "scripts/ref/world.py": read_k(os.path.join(ROOT, "scripts", "ref", "world.py"), r'MULT_K_BP\s*=\s*(\d+)'),
        "packages/shared/src/world.ts": read_k(os.path.join(ROOT, "packages", "shared", "src", "world.ts"), r'MULT_K_BP:\s*(\d+)'),
        "contracts/caravan/src/math.rs": read_k(os.path.join(ROOT, "contracts", "caravan", "src", "math.rs"), r'MULT_K_BP[^=\n]*=\s*(\d+)'),
        "variant default (econ_variant.K_SPEC)": E.K_SPEC,
    }


def ref_py(bots, ticks, seed, k, rebal=30, house=10, npc=True):
    """Run the real scripts/ref/economy_sim.py. At the K written in world.py it is run as is; at another K a wrapper
    sets world.PARAMS['MULT_K_BP'] in memory before running the unchanged script."""
    argv = [str(bots), str(ticks), str(seed), "npc" if npc else "nonpc", str(rebal), str(house)]
    if k == SRC_K["scripts/ref/world.py"]:
        args = [sys.executable, "-B", os.path.join(REF_DIR, "economy_sim.py")] + argv
    else:
        code = ("import sys, runpy; sys.dont_write_bytecode = True; sys.path.insert(0, %r); import world; "
                "world.PARAMS['MULT_K_BP'] = %d; sys.argv = ['economy_sim.py'] + %r; "
                "runpy.run_path('economy_sim.py', run_name='__main__')") % (REF_DIR, k, argv)
        args = [sys.executable, "-B", "-c", code]
    out = subprocess.run(args, capture_output=True, text=True, check=True, cwd=REF_DIR).stdout
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


def run_variant(**kw):
    r = E.run(E.Cfg(**kw))
    TOTAL["runs"] += 1
    TOTAL["conserved"] += 1 if r["conserved"] else 0
    return r


def validate_k(k, bad):
    ver = CHANGELOG.get(k, {}).get("name", "no spec version")
    print(f"=== K = MULT_K_BP {k} ({ver}) ===")
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

    ts = None
    ts_ok_possible = (k == SRC_K["packages/shared/src/world.ts"])
    if ts_ok_possible:
        ts = ts_run([dict(bots=b, ticks=t, seed=s, npc=n, rebalPct=rb, housePct=h) for (b, t, s, rb, h, n) in grid])
    ok_ref = ok_ts = 0
    for i, (b, t, s, rb, h, n) in enumerate(grid):
        mine = run_variant(bots=b, ticks=t, seed=s, npc=n, rebal_pct=rb, house_pct=h, mult_k=k)
        mine_k = key(mine)
        if b > 0:
            ref = ref_py(b, t, s, k, rb, h, n)
            if key(ref) == mine_k:
                ok_ref += 1
            else:
                bad[0] += 1
                print("MISMATCH vs python ref", (b, t, s, rb, h, n), key(ref), mine_k)
        else:
            ok_ref += 1  # the reference script divides by zero statistics for 0 bots; not comparable
        if ts is not None:
            if key(ts[i]) == mine_k and ts[i]["conserved"] and mine["conserved"]:
                ok_ts += 1
            else:
                bad[0] += 1
                print("MISMATCH vs TS", (b, t, s, rb, h, n), key(ts[i]), mine_k)
    ref_how = "as is" if k == SRC_K["scripts/ref/world.py"] else "with MULT_K_BP patched in memory to %d" % k
    print(f"python-variant == python-reference ({ref_how}): {ok_ref}/{len(grid)} configs")
    if ts is not None:
        print(f"python-variant == TypeScript runSim (K compiled into packages/shared = {k}): {ok_ts}/{len(grid)} configs")
    else:
        print(f"TypeScript runSim not compared at K = {k}: packages/shared is compiled with K = {SRC_K['packages/shared/src/world.ts']} and runSim takes no K")

    log = CHANGELOG.get(k)
    if log:
        print(f"-- vs spec/CHANGELOG.md {log['name']} figures (seed 7, 240 ticks), trips/median/broke --")
        for label, mk in (("Appendix B rules (`pnpm sim`)", E.appendix_b), ("contract rules D1-D3 (contract_d123)", E.contract_d123)):
            kind = "appendix_b" if mk is E.appendix_b else "contract_d123"
            for bots, expect in log[kind].items():
                r = E.run(mk(bots=bots, mult_k=k))
                TOTAL["runs"] += 1
                TOTAL["conserved"] += 1 if r["conserved"] else 0
                got = (r["trips"], r["median"], r["broke"])
                flag = "OK  " if got == expect else "DIFF"
                if got != expect:
                    bad[0] += 1
                print(f"  {flag} {label} bots={bots}: changelog {expect[0]}/{expect[1]}/{expect[2]}  variant {got[0]}/{got[1]}/{got[2]}  conserved={r['conserved']}")
    return ok_ts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, action="append", help="MULT_K_BP to validate (repeatable); default: 3000 then 4000")
    args = ap.parse_args()
    ks = args.k or [E.K_SPEC, E.K_PREV]
    bad = [0]
    print("== 0. MULT_K_BP in every source (the baseline must be the same everywhere) ==")
    for name, v in SRC_K.items():
        print(f"  {name}: {v}")
    if len(set(v for v in SRC_K.values() if v is not None)) != 1:
        bad[0] += 1
        print("  NOT CONSISTENT: comparisons at the baseline K are not like with like")
    else:
        print("  consistent")
    ts_total = 0
    for k in ks:
        ts_total += validate_k(k, bad) or 0
    print(f"variant runs in this validation: {TOTAL['runs']} (money conserved in {TOTAL['conserved']}); TypeScript runSim configurations conserved on every tick: {ts_total}")
    print("VALIDATION", "PASSED" if bad[0] == 0 else f"FAILED ({bad[0]} problems)")
    return bad[0]


SRC_K = source_ks()

if __name__ == "__main__":
    sys.exit(1 if main() else 0)
