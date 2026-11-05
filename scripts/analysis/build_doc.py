"""Builds docs/ECONOMY_TUNING.md from scripts/analysis/doc_template.md by inserting the generated result tables.

Placeholders in the template:  {{T:q1:1B}}  -> table whose heading starts with "#### 1B." in results/q1.md
                               {{X:5-1}}    -> table built from the JSON line "check":"5-1 ..." in results/q5_exploits.txt
                               {{V}}        -> contents of results/validate.txt
                               {{C}}        -> sentence with the money-conservation run counts (results/conservation_*.json, validate.txt)
                               {{C:total}}  -> total number of variant runs behind the doc (build fails if any run was not conserved)
Run from the repo root: python scripts/analysis/build_doc.py
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
RES = os.path.join(HERE, "results")


def load_blocks(name):
    text = open(os.path.join(RES, name + ".md"), encoding="utf-8").read()
    blocks = {}
    for part in re.split(r"(?m)^#### ", text):
        if not part.strip():
            continue
        head, _, body = part.partition("\n")
        key = head.split(".")[0].strip() if re.match(r"^\d[A-Z]?(-[A-Z])?\.", head) else head
        key = re.match(r"^([0-9A-Z-]+)\.", head).group(1)
        blocks[key] = (head.strip(), body.strip())
    return blocks


BLOCKS = {n: load_blocks(n) for n in ("q1", "q2", "q3", "q4", "q5")}
EXPL = [json.loads(line) for line in open(os.path.join(RES, "q5_exploits.txt"), encoding="utf-8") if line.startswith("{")]


def tbl(headers, rows):
    headers = [str(h) for h in headers]
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out)


def expl(key):
    for e in EXPL:
        if e["check"].startswith(key):
            return e
    raise KeyError(key)


def render_x(key):
    if key == "5-1":
        e = expl("5-1")
        return tbl(["check", "cases", "profitable cases", "best net result (fils)", "where", "smallest loss as share of outlay", "where"],
                   [["buy q then sell q back, and sell q then buy q back, same merchant; 5 goods x every stock 0..cap x q 1..40 x spread {400, 800, 2000} x bias {-1500, 0, +1500}",
                     f"{e['tested']:,}", e["positive"], e["bestNetFils"], e["bestDesc"], f"{100 * e['smallestLossShareOfOutlay']:.2f}%", e["smallestLossDesc"]]])
    if key == "5-2":
        e = expl("5-2")
        ss = e["startStocks"]
        return tbl(["check", "closed loops tested", "profitable", "best net result (fils)", "where"],
                   [[f"sequences of 2-4 trades (sizes 1, 2, 3, 5, 10, 20, 40) that return the player's inventory to its start, spread 400, {min(ss.values())}-{max(ss.values())} start stocks per good incl. the clamp edges of both the K = 3000 and the K = 4000 curve, both from empty hands and from a full 40-unit hold",
                     f"{e['tested']:,}", e["positive"], e["bestNetFils"], e["bestDesc"]]])
    if key == "5-3":
        b = expl("5-3 buy")
        s = expl("5-3 sell")
        return tbl(["check", "cases (good x start stock)", "split better in", "largest edge (fils)", "where", "largest edge as share of the trade", "where"],
                   [["buy 40 as 40 one-unit buys instead of one 40-unit buy (spread 800)", b["cases"], b["splitCheaper"], f"{b['maxSavingFils']:,}", b["maxSavingDesc"], f"{100 * b['maxSavingShare']:.2f}%", b["maxSavingShareDesc"]],
                    ["sell 40 as 40 one-unit sells instead of one 40-unit sell (spread 800)", s["cases"], s["splitBetter"], f"{s['maxGainFils']:,}", s["maxGainDesc"], f"{100 * s['maxGainShare']:.2f}%", s["maxGainShareDesc"]]])
    if key == "5-4":
        e = expl("5-4")
        rows = []
        for k, v in e.items():
            if k == "check":
                continue
            rows.append([k] + [v[g] for g in ("grain", "salt", "iron", "spice", "silk")])
        return tbl(["merchant policy path (start bias -1500; player buys 10 at tick 0, sells 10 after k ticks, no travel)", "grain", "salt", "iron", "spice", "silk"], rows) + "\n\n(cells: smallest k, in ticks = minutes, at which the hold-and-sell is profitable after both 1% fees)"
    if key == "5-5":
        e = expl("5-5 ambush")
        v = expl("5-5 value")
        t = tbl(["units of a good in the cargo"] + [r["q"] for r in e["rows"]],
                [["lost, contract (floor 30%)"] + [r["floorLoss"] for r in e["rows"]], ["lost, Appendix B / `sim.ts` (ceil 30%)"] + [r["appendixBLoss"] for r in e["rows"]]])
        return t + f"\n\nA cargo of 3 units of each of the 5 goods (15 units) has a base value of {v['baseValueFils']:,} fils and loses nothing in an ambush under the contract rule."
    if key == "5-6":
        e = expl("5-6")
        return tbl(["check", "result"],
                   [["lowest effective stall fee rate over prices 1..200,000 fils", f"{100 * e['minEffectiveRate']:.2f}% (first reached at price {e['minAtPriceFils']} fils)"],
                    ["highest effective rate", f"{100 * e['maxEffectiveRate']:.0f}% (price {e['maxAtPriceFils']} fil: minimum fee of 1 fils)"],
                    ["splitting a sale into 2, 3, 5 or 10 stalls (prices 2..5,000 fils)", f"{e['splitCheaper']} of {e['splitCases']:,} cases had a lower total fee"]])
    if key == "5-7":
        e = expl("5-7")
        return tbl(["good", "mid at target stock", "mid at target - 1", "change per stock unit (fils)", "as share of base"],
                   [[r["good"], r["midAtTarget"], r["midAtTargetMinus1"], r["perUnitFils"], f"{100 * r['perUnitPctOfBase']:.2f}%"] for r in e["rows"]])
    raise KeyError(key)


def conservation():
    """(sentence, total, all_conserved) from the real run counters."""
    def load(name):
        d = json.load(open(os.path.join(RES, name), encoding="utf-8"))
        return d["n"], d.get("conserved", d.get("ok"))
    parts = {k: load(f"conservation_{k}.json") for k in ("q1", "q2", "q3", "q4", "q5")}
    pat = r"variant runs in this validation: (\d+) \(money conserved in (\d+)\); TypeScript runSim configurations conserved on every tick: (\d+)"
    v = re.search(pat, open(os.path.join(RES, "validate.txt"), encoding="utf-8").read())
    vn, vc, ts = int(v.group(1)), int(v.group(2)), int(v.group(3))
    exp_n = sum(parts[k][0] for k in ("q1", "q2", "q3"))
    total = exp_n + parts["q4"][0] + parts["q5"][0] + vn
    conserved = sum(parts[k][1] for k in ("q1", "q2", "q3")) + parts["q4"][1] + parts["q5"][1] + vc
    verdict = "all conserved" if conserved == total else f"NOT ALL CONSERVED ({conserved} of {total})"
    sentence = (f"{exp_n:,} runs of `run_exp.py` (q1 {parts['q1'][0]:,}, q2 {parts['q2'][0]:,}, q3 {parts['q3'][0]:,}), {parts['q4'][0]:,} of `run_q4.py`, "
                f"{parts['q5'][0]:,} of `run_q5.py`, {vn} of `validate.py`: {total:,} variant runs in all, {verdict}. "
                f"The {ts} TypeScript `runSim()` configurations checked in validation also conserved on every tick.")
    return sentence, total, conserved == total


def sub(m):
    kind = m.group(1)
    if kind == "C":
        sentence, total, ok = conservation()
        if not ok:
            raise SystemExit("money conservation failed in at least one run: " + sentence)
        return f"{total:,}" if m.group(2) == "total" else sentence
    if kind == "V":
        return "```\n" + open(os.path.join(RES, "validate.txt"), encoding="utf-8").read().strip() + "\n```"
    if kind == "T":
        name, key = m.group(2), m.group(3)
        head, body = BLOCKS[name][key]
        return f"**Table {key}. {head.split('. ', 1)[1] if '. ' in head else head}**\n\n{body}"
    if kind == "X":
        return render_x(m.group(2))
    raise ValueError(kind)


def main():
    tpl = open(os.path.join(HERE, "doc_template.md"), encoding="utf-8").read()
    out = re.sub(r"\{\{(T|V|C)(?::([a-z0-9]+))?(?::([0-9A-Z-]+))?\}\}", sub, tpl)
    out = re.sub(r"\{\{X:([0-9a-z-]+)\}\}", lambda m: render_x(m.group(1)), out)
    left = re.findall(r"\{\{[^}]*\}\}", out)
    if left:
        raise SystemExit(f"unresolved placeholders: {left}")
    dest = os.path.join(ROOT, "docs", "ECONOMY_TUNING.md")
    open(dest, "w", encoding="utf-8", newline="\n").write(out)
    print("wrote", dest, len(out.splitlines()), "lines")


if __name__ == "__main__":
    main()
