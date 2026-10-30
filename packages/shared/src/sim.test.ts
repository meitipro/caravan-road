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

// Numbers below come from scripts/ref/economy_sim.py (seed 7, 240 ticks) and master plan section 2.9.
const EXPECTED = [
  { bots: 2, trips: 64, median: 5944, broke: 23, p10: -15756, p90: 19810 },
  { bots: 5, trips: 177, median: 1088, broke: 43, p10: -10531, p90: 12948 },
  { bots: 10, trips: 342, median: 1099, broke: 86, p10: -18487, p90: 15775 },
];

describe("economy sim reproduces the Python reference", () => {
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
