import { describe, expect, it } from "vitest";
import { baselineReference, makeStates, renderDoc, replay, simCompare } from "../evals/replay.js";
import { percentile, ranks, spearman } from "../evals/stats.js";
import { FakeModel } from "../src/fake/fake-model.js";

describe("stats", () => {
  it("spearman: monotone, reversed, ties, constant", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4, 5], [9, 7, 5, 3, 1])).toBeCloseTo(-1, 10);
    expect(spearman([1, 2, 3, 4], [1, 1, 2, 2])).toBeCloseTo(4 / Math.sqrt(20), 10);
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNaN();
    expect(spearman([1], [1])).toBeNaN();
  });
  it("ranks average ties; percentile is nearest-rank", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe("replay harness (fake model)", () => {
  it("counts valid-before-retry, fallbacks and clamp hits from injected faults; sign checks point the intended way", async () => {
    const states = await makeStates(60, 5);
    expect(states).toHaveLength(60);
    const clean = await replay("clean", states, new FakeModel(1, {}), { measureLatency: false, delayMs: 0 });
    expect(clean.validBeforeRetry).toBe(60);
    expect(clean.fallback).toBe(0);
    expect(clean.clampSpread + clean.clampBias).toBe(0);
    expect(clean.spearmanSpreadVsTreasury).toBeLessThan(0);
    expect(clean.spearmanBiasVsAvgRatio).toBeLessThan(0);
    expect(clean.latencyMs).toBeNull();

    const faulty = await replay("faulty", states, new FakeModel(2, { outOfRange: 1 }), { measureLatency: false, delayMs: 0 });
    expect(faulty.validBeforeRetry).toBe(60); // out-of-range is clamped, not rejected
    expect(faulty.clampSpread).toBe(60);
    expect(faulty.clampBias).toBe(60);

    const broken = await replay("broken", states, new FakeModel(3, { noJson: 1 }), { measureLatency: false, delayMs: 0 });
    expect(broken.validBeforeRetry).toBe(0);
    expect(broken.validAfterRetry).toBe(60); // the retry (nudge) is answered correctly by the fake
    const dead = await replay("dead", states, new FakeModel(4, { timeout: 1 }), { measureLatency: false, delayMs: 0 });
    expect(dead.fallback).toBe(60);

    const ref = baselineReference(states);
    expect(ref.spearmanSpreadVsTreasury).toBeLessThan(0);
    expect(ref.spearmanBiasVsAvgRatio).toBeLessThan(0);
  });

  it("renders a document that labels the model as fake and gives no latency or real-model claims", async () => {
    const states = await makeStates(8, 5);
    const r = await replay("x", states, new FakeModel(1, {}), { measureLatency: false, delayMs: 0 });
    const sim = await simCompare([7], 12, {});
    const doc = renderDoc({ states: 8, statesSeed: 5, reports: [r, r], baseline: baselineReference(states), sim, ticks: 12, faults: {}, real: null, generatedBy: "test" });
    expect(doc).toMatch(/not a language model/);
    expect(doc).toMatch(/\*\*not run\*\*/);
    expect(doc).not.toMatch(/p50/);
    expect(sim.every((s) => s.conserved)).toBe(true);
    expect(sim).toHaveLength(3);
  });
});
