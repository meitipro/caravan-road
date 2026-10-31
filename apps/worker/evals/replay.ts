// Evaluation harness (spec 8.9 task 8).
//
//   pnpm --filter @caravan/worker eval -- [--states 200] [--write ../../docs/NPC_EVAL.md]     (FAKE model, offline)
//   NEAR_AI_API_KEY=... NEAR_AI_MODEL=... pnpm --filter @caravan/worker eval -- --real [--delay-ms 1500]
//
// Part A  replay: N synthetic states (taken from SimWorld runs with random seeds, then perturbed), one
//         model call per state through the real prompt/validation/retry path.
// Part B  simulation: SimWorld for 240 ticks, same seed, baseline-only vs the worker cycle with a model.
//
// Without --real the "model" is the scripted FakeModel. Everything measured then describes THIS CODE
// (validation, clamping, retry, fallback, plumbing) under injected faults, and says NOTHING about a
// language model. Latency is only reported with --real. The generated markdown states this.

import { writeFileSync } from "node:fs";
import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, GOOD_IDS } from "@caravan/shared";
import { baselineDecision } from "../src/baseline.js";
import { NearAiClient, proposeDecision, type ModelClient } from "../src/brain.js";
import { computeShipOptions } from "../src/candidates.js";
import { FakeModel, FAKE_MODEL_NAME, type FakeFaults } from "../src/fake/fake-model.js";
import { buildFeatures, StockHistory, type Features } from "../src/features.js";
import { PERSONAS } from "../src/personas.js";
import { buildPrompt } from "../src/prompts.js";
import { Rng, SimWorld } from "../src/sim-world.js";
import { simulate } from "../src/simulate.js";
import { mean, percentile, spearman } from "./stats.js";

interface State {
  persona: CityId;
  features: Features;
  prompt: ReturnType<typeof buildPrompt>;
  ctx: { options: ReturnType<typeof computeShipOptions>; baseline: ReturnType<typeof baselineDecision> };
}

/** N states from SimWorld runs with random seeds, advanced a random number of ticks, then perturbed. */
export async function makeStates(n: number, seed: number): Promise<State[]> {
  const rng = new Rng(seed);
  const out: State[] = [];
  for (let i = 0; i < n; i++) {
    const w = new SimWorld({ bots: 5, seed: seed * 1000 + i });
    const ticks = rng.int(121);
    for (let t = 0; t < ticks; t++) await w.worldTick();
    const persona = CITY_IDS[i % CITY_IDS.length]!;
    // perturb the merchant itself so the whole treasury range is covered (the sim alone stays near 100%)
    w.treasury[persona] = Math.trunc((w.treasury[persona] * (20 + rng.int(180))) / 100);
    const snap = w.snapshot();
    const features = buildFeatures(snap, persona, new StockHistory());
    const options = computeShipOptions(snap, persona);
    const baseline = baselineDecision(features, options);
    out.push({ persona, features, prompt: buildPrompt(features, options), ctx: { options, baseline } });
  }
  return out;
}

export interface ReplayReport {
  label: string;
  n: number;
  validBeforeRetry: number;
  validAfterRetry: number;
  fallback: number;
  clampSpread: number;
  clampBias: number;
  /** among accepted decisions */
  accepted: number;
  meanSpreadByPersona: Record<CityId, number>;
  meanBiasByPersona: Record<CityId, number>;
  spearmanSpreadVsTreasury: number;
  spearmanBiasVsAvgRatio: number;
  latencyMs: { p50: number; p95: number } | null;
}

export async function replay(label: string, states: State[], model: ModelClient, opts: { measureLatency: boolean; delayMs: number }): Promise<ReplayReport> {
  let first = 0;
  let after = 0;
  let fb = 0;
  let cs = 0;
  let cb = 0;
  const spreads: Record<string, number[]> = {};
  const biases: Record<string, number[]> = {};
  const sx: number[] = [];
  const sy: number[] = [];
  const bx: number[] = [];
  const by: number[] = [];
  const lat: number[] = [];
  for (const s of states) {
    const t0 = Date.now();
    const r = await proposeDecision(model, s.prompt, s.ctx);
    if (opts.measureLatency) lat.push(Date.now() - t0);
    if (r.ok) {
      after++;
      if (r.firstAttemptValid) first++;
      if (r.report.clamped.spread_bp) cs++;
      if (r.report.clamped.bias_bp) cb++;
      (spreads[s.persona] ??= []).push(r.value.spread_bp);
      (biases[s.persona] ??= []).push(r.value.bias_bp);
      sx.push(s.features.treasury_bp);
      sy.push(r.value.spread_bp);
      bx.push(s.features.avg_ratio_bp);
      by.push(r.value.bias_bp);
    } else fb++;
    if (opts.delayMs > 0) await new Promise((res) => setTimeout(res, opts.delayMs));
  }
  const byP = (m: Record<string, number[]>) => Object.fromEntries(CITY_IDS.map((c) => [c, mean(m[c] ?? [])])) as Record<CityId, number>;
  const sorted = [...lat].sort((a, b) => a - b);
  return {
    label,
    n: states.length,
    validBeforeRetry: first,
    validAfterRetry: after,
    fallback: fb,
    clampSpread: cs,
    clampBias: cb,
    accepted: after,
    meanSpreadByPersona: byP(spreads),
    meanBiasByPersona: byP(biases),
    spearmanSpreadVsTreasury: spearman(sx, sy),
    spearmanBiasVsAvgRatio: spearman(bx, by),
    latencyMs: opts.measureLatency && sorted.length > 0 ? { p50: percentile(sorted, 50), p95: percentile(sorted, 95) } : null,
  };
}

/** The same two statistics for the deterministic baseline on the same states (reference row). */
export function baselineReference(states: State[]) {
  const spreads: Record<string, number[]> = {};
  const biases: Record<string, number[]> = {};
  for (const s of states) {
    (spreads[s.persona] ??= []).push(s.ctx.baseline.spread_bp);
    (biases[s.persona] ??= []).push(s.ctx.baseline.bias_bp);
  }
  const byP = (m: Record<string, number[]>) => Object.fromEntries(CITY_IDS.map((c) => [c, mean(m[c] ?? [])])) as Record<CityId, number>;
  return {
    meanSpreadByPersona: byP(spreads),
    meanBiasByPersona: byP(biases),
    spearmanSpreadVsTreasury: spearman(states.map((s) => s.features.treasury_bp), states.map((s) => s.ctx.baseline.spread_bp)),
    spearmanBiasVsAvgRatio: spearman(states.map((s) => s.features.avg_ratio_bp), states.map((s) => s.ctx.baseline.bias_bp)),
  };
}

export interface SimRow {
  seed: number;
  mode: string;
  decisions: number;
  llm: number;
  baseline: number;
  keep: number;
  trips: number;
  medianProfit: number;
  brokeEvents: number;
  ambushes: number;
  meanSpreadBp: number;
  conserved: boolean;
  priceRange: Record<GoodId, [number, number]>;
}

export async function simCompare(seeds: number[], ticks: number, faults: FakeFaults): Promise<SimRow[]> {
  const rows: SimRow[] = [];
  for (const seed of seeds) {
    for (const [mode, model] of [
      ["baseline only", null],
      [`${FAKE_MODEL_NAME}, no faults`, new FakeModel(seed, {})],
      [`${FAKE_MODEL_NAME}, faults injected`, new FakeModel(seed, faults)],
    ] as Array<[string, ModelClient | null]>) {
      const r = await simulate({ ticks, bots: 5, seed, model });
      rows.push({
        seed,
        mode,
        decisions: r.decisions.length,
        llm: r.bySource.llm,
        baseline: r.bySource.baseline,
        keep: r.bySource.keep,
        trips: r.stats.trips,
        medianProfit: r.stats.medianProfit,
        brokeEvents: r.stats.brokeEvents,
        ambushes: r.stats.ambushes,
        meanSpreadBp: r.stats.meanSpreadBp,
        conserved: r.stats.moneyNow === r.stats.moneyStart,
        priceRange: r.stats.priceRange,
      });
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------
const f2 = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
const f0 = (x: number) => (Number.isNaN(x) ? "n/a" : String(Math.round(x)));
const pct = (a: number, n: number) => `${a}/${n} (${((100 * a) / n).toFixed(1)}%)`;

export function renderDoc(p: {
  states: number;
  statesSeed: number;
  reports: ReplayReport[];
  baseline: ReturnType<typeof baselineReference>;
  sim: SimRow[];
  ticks: number;
  faults: FakeFaults;
  real: ReplayReport | null;
  generatedBy: string;
}): string {
  const L: string[] = [];
  L.push("# NPC evaluation");
  L.push("");
  L.push(`Generated by \`${p.generatedBy}\`. Every number below was printed by that script; nothing is hand-edited.`);
  L.push("");
  L.push("## Read this first");
  L.push("");
  L.push(`- The model used for every table below is **${FAKE_MODEL_NAME}**: a scripted heuristic with optional injected faults (src/fake/fake-model.ts). It is **not a language model**. These tables measure this repository's validation, clamping, retry, fallback and simulation plumbing. They say nothing about how a real model on NEAR AI Cloud behaves.`);
  L.push("- The simulation uses the worker's own in-memory world (src/sim-world.ts), not the Appendix B reference simulation. Numbers are comparable only with other rows of this document (same seeds, same bots), never with spec/ECONOMY.md section 2.9.");
  L.push("- No latency figure is given for the fake model, because there is no network to measure.");
  L.push(`- Real-model results: ${p.real ? "see the last section." : "**not run**. They require a NEAR_AI_API_KEY and a model choice (see docs/WORKER.md). The harness supports them with `--real`."}`);
  L.push("");
  L.push(`## A. Replay of ${p.states} synthetic states (seed ${p.statesSeed})`);
  L.push("");
  L.push("States come from SimWorld runs with random seeds (0-120 ticks, 5 bots), with the merchant's own treasury perturbed to 20%-200% of initial. Each state goes through the real prompt builder, the one-retry loop and the validator.");
  L.push("");
  L.push(`Injected faults for the "faults" row (per call, first attempt only): ${JSON.stringify(p.faults)}.`);
  L.push("");
  L.push("| model | states | valid JSON before retry | valid after retry | fallback to baseline | clamp hit: spread | clamp hit: bias |");
  L.push("|---|---|---|---|---|---|---|");
  for (const r of p.reports) {
    L.push(`| ${r.label} | ${r.n} | ${pct(r.validBeforeRetry, r.n)} | ${pct(r.validAfterRetry, r.n)} | ${pct(r.fallback, r.n)} | ${pct(r.clampSpread, r.accepted)} | ${pct(r.clampBias, r.accepted)} |`);
  }
  L.push("");
  L.push("Clamp-hit rates are over accepted decisions. A valid first answer that is clamped still counts as valid (clamping is the designed behaviour).");
  L.push("");
  L.push("### Mean spread and bias by persona (basis points)");
  L.push("");
  const clean = p.reports[0]!;
  L.push("| persona | scripted fake: mean spread | scripted fake: mean bias | baseline: mean spread | baseline: mean bias |");
  L.push("|---|---|---|---|---|");
  for (const c of CITY_IDS) {
    L.push(`| ${PERSONAS[c].name} (${c}) | ${f0(clean.meanSpreadByPersona[c])} | ${f0(clean.meanBiasByPersona[c])} | ${f0(p.baseline.meanSpreadByPersona[c])} | ${f0(p.baseline.meanBiasByPersona[c])} |`);
  }
  L.push("");
  L.push("The baseline is persona-agnostic by design, so its columns differ only through the states each persona received. The fake's spreads are ordered by its script (golnar < rostam < nahid < sohrab); that ordering is a property of the script, shown here to prove the harness can detect the intended direction, not evidence about a model.");
  L.push("");
  L.push("### Sign checks (Spearman rank correlation)");
  L.push("");
  L.push("| source | spread vs treasury_bp (expected negative) | bias vs average stock ratio (expected negative) |");
  L.push("|---|---|---|");
  L.push(`| ${clean.label} | ${f2(clean.spearmanSpreadVsTreasury)} | ${f2(clean.spearmanBiasVsAvgRatio)} |`);
  L.push(`| baseline (deterministic) | ${f2(p.baseline.spearmanSpreadVsTreasury)} | ${f2(p.baseline.spearmanBiasVsAvgRatio)} |`);
  L.push("");
  L.push(`## B. Simulation, ${p.ticks} ticks, 5 greedy bots, same seed per group`);
  L.push("");
  L.push("Worker cycle against SimWorld. \"Baseline only\" means no model: every decision is the spec 8.6 baseline. Spread and bias set by the merchants change what the bots pay, so the economy differs between rows.");
  L.push("");
  L.push("| seed | mode | decisions (llm / baseline / keep) | bot trips | median profit per trip (fils) | merchant-broke events | ambushes | mean spread (bp) | money conserved |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const s of p.sim) {
    L.push(`| ${s.seed} | ${s.mode} | ${s.decisions} (${s.llm} / ${s.baseline} / ${s.keep}) | ${s.trips} | ${s.medianProfit} | ${s.brokeEvents} | ${s.ambushes} | ${s.meanSpreadBp} | ${s.conserved ? "yes" : "NO"} |`);
  }
  L.push("");
  L.push("Mid-price range seen (fils, min-max, sampled every 20 ticks across all cities):");
  L.push("");
  L.push(`| seed | mode | ${GOOD_IDS.join(" | ")} |`);
  L.push(`|---|---|${GOOD_IDS.map(() => "---").join("|")}|`);
  for (const s of p.sim) {
    L.push(`| ${s.seed} | ${s.mode} | ${GOOD_IDS.map((g) => `${s.priceRange[g][0]}-${s.priceRange[g][1]}`).join(" | ")} |`);
  }
  L.push("");
  L.push("Money is conserved on every tick in every run (the world throws if it is not). Three seeds are shown so that no conclusion rests on one run; differences between rows are small samples of a noisy greedy-bot economy and should not be read as proof that one policy is better.");
  L.push("");
  if (p.real) {
    const r = p.real;
    L.push("## C. Real model replay");
    L.push("");
    L.push(`Model: ${r.label}.`);
    L.push("");
    L.push("| states | valid JSON before retry | valid after retry | fallback | clamp: spread | clamp: bias | latency p50 / p95 (ms, wall clock per decision incl. retry) |");
    L.push("|---|---|---|---|---|---|---|");
    L.push(`| ${r.n} | ${pct(r.validBeforeRetry, r.n)} | ${pct(r.validAfterRetry, r.n)} | ${pct(r.fallback, r.n)} | ${pct(r.clampSpread, r.accepted)} | ${pct(r.clampBias, r.accepted)} | ${r.latencyMs ? `${r.latencyMs.p50} / ${r.latencyMs.p95}` : "n/a"} |`);
    L.push("");
    L.push(`Spearman: spread vs treasury_bp ${f2(r.spearmanSpreadVsTreasury)}; bias vs average stock ratio ${f2(r.spearmanBiasVsAvgRatio)}.`);
    L.push("");
  } else {
    L.push("## C. Real model replay");
    L.push("");
    L.push("Not run. See docs/WORKER.md for what is needed (key, model choice).");
    L.push("");
  }
  L.push("## Reproduce");
  L.push("");
  L.push("```");
  L.push("pnpm --filter @caravan/worker eval -- --write ../../docs/NPC_EVAL.md");
  L.push("```");
  L.push("");
  return L.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const n = Number(get("--states") ?? 200);
  const out = get("--write");
  const real = argv.includes("--real");
  const delayMs = Number(get("--delay-ms") ?? 1500);
  const statesSeed = 20260;
  const ticks = 240;
  const faults: FakeFaults = { noJson: 0.1, outOfRange: 0.1, wrongType: 0.1, timeout: 0.05 };

  console.log(`building ${n} synthetic states ...`);
  const states = await makeStates(n, statesSeed);
  const reports = [
    await replay(`${FAKE_MODEL_NAME}, no faults`, states, new FakeModel(1, {}), { measureLatency: false, delayMs: 0 }),
    await replay(`${FAKE_MODEL_NAME}, faults injected`, states, new FakeModel(2, faults), { measureLatency: false, delayMs: 0 }),
  ];
  const baseline = baselineReference(states);
  console.log("running simulations ...");
  const sim = await simCompare([7, 11, 13], ticks, faults);

  let realReport: ReplayReport | null = null;
  if (real) {
    const apiKey = process.env.NEAR_AI_API_KEY;
    const model = process.env.NEAR_AI_MODEL;
    if (!apiKey || !model) throw new Error("--real needs NEAR_AI_API_KEY and NEAR_AI_MODEL in the environment");
    const client = new NearAiClient({ apiKey, model });
    console.log(`replaying ${n} states against the real model (${model}) with ${delayMs} ms between calls ...`);
    realReport = await replay(model, states, client, { measureLatency: true, delayMs });
  }

  const doc = renderDoc({
    states: n,
    statesSeed,
    reports,
    baseline,
    sim,
    ticks,
    faults,
    real: realReport,
    generatedBy: `pnpm --filter @caravan/worker eval${real ? " -- --real" : ""}${out ? ` -- --write ${out}` : ""}`,
  });
  console.log(doc);
  if (out) {
    writeFileSync(out, doc, "utf8");
    console.log(`written: ${out}`);
  }
}

if (process.argv[1] && /replay\.[tj]s$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
}
