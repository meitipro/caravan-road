import { describe, expect, it } from "vitest";
import { PyRandom } from "./pyrandom.js";
import { defaultSimOptions, runSim } from "./sim.js";

describe("PyRandom matches CPython", () => {
  it("random() after seed(7), seed(1), seed(123456789012)", () => {
    const a = new PyRandom(7);
    expect(a.random()).toBe(0.32383276483316237);
    expect(a.random()).toBe(0.15084917392450192);
    expect(new PyRandom(1).random()).toBe(0.13436424411240122);
    expect(new PyRandom(123456789012).random()).toBe(0.37701448538609916);
  });
  it("choice() after seed(7)", () => {
    const r = new PyRandom(7);
    const picks = Array.from({ length: 8 }, () => r.choice(["a", "b", "c", "d"]));
    expect(picks).toEqual(["c", "b", "d", "a", "a", "a", "c", "a"]);
  });
});

// spec-v1.2 (PROPOSAL, MULT_K_BP = 3000): these numbers come from real `pnpm sim --bots N --ticks 240 --seed 7` runs and
// were cross-checked against a LOCAL copy of scripts/ref/economy_sim.py with MULT_K_BP changed to 3000 (the full
// printed output is identical). They REPLACE the Appendix B figures of spec-v1.1 (K=4000), which `scripts/ref` still
// produces and which no longer match this sim:
//   spec-v1.1 / Appendix B (K=4000): 2 bots 64 / 5944 / 23, 5 bots 177 / 1088 / 43, 10 bots 342 / 1099 / 86
// p10 and p90 are the 10th/90th percentile of profit per trip.
const EXPECTED = [
  { bots: 2, trips: 53, median: 5795, broke: 10, p10: -13572, p90: 17385 },
  { bots: 5, trips: 190, median: 1392, broke: 47, p10: -17013, p90: 14836 },
  { bots: 10, trips: 329, median: 689, broke: 72, p10: -15825, p90: 14578 },
];

describe("economy sim reproduces the Python reference (with MULT_K_BP = 3000, spec-v1.2)", () => {
  it.each(EXPECTED)("$bots bots", (e) => {
    const start = 50000 * 4 + 50000 * e.bots;
    let ticks = 0;
    const r = runSim({
      ...defaultSimOptions(), bots: e.bots, ticks: 240, seed: 7,
      onTick: (_t, total) => { ticks++; expect(total).toBe(start); }, // money conserved on every tick
    });
    expect(ticks).toBe(240);
    expect([r.trips, r.medianProfit, r.brokeEvents, r.p10, r.p90]).toEqual([e.trips, e.median, e.broke, e.p10, e.p90]);
  });
});
