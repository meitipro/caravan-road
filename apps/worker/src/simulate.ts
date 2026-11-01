// Runs the worker's real cycle (runCycle -> runMerchantOnce) against the in-memory SimWorld.
// With a FakeModel it shows behaviour; with model=null every decision is the baseline.
// Used by the dry-run CLI, the integration tests and the evaluation harness.

import type { Decision } from "@caravan/shared";
import type { ModelClient } from "./brain.js";
import { isFakeDecision } from "./fake/fake-model.js";
import { StockHistory } from "./features.js";
import { runCycle } from "./loop.js";
import { MemoryStore } from "./memory-store.js";
import type { RunOutcome } from "./run-once.js";
import { SimWorld, type SimStats } from "./sim-world.js";
import { silentLogger, type Logger } from "./types.js";

export interface SimulateOptions {
  ticks: number;
  bots: number;
  seed: number;
  model: ModelClient | null;
  log?: Logger;
  /** called for every merchant decision (run-once outcome) */
  onOutcome?: (o: RunOutcome) => void;
}

export interface SimulateResult {
  stats: SimStats;
  decisions: Decision[];
  bySource: Record<Decision["source"], number>;
  world: SimWorld;
}

export async function simulate(opts: SimulateOptions): Promise<SimulateResult> {
  const world = new SimWorld({ bots: opts.bots, seed: opts.seed });
  const store = new MemoryStore();
  const log: Logger = opts.log ?? silentLogger;
  const memory = new Map();
  const history = new StockHistory();

  const deps = {
    chain: world,
    store,
    model: opts.model,
    attestor: null,
    history,
    memory,
    now: () => world.snapshot().now,
    log,
    ...(opts.onOutcome ? { observe: opts.onOutcome } : {}),
  };
  for (let t = 0; t < opts.ticks; t++) {
    const r = await runCycle(deps, { staggerMs: 0, sleep: async () => {} });
    if (r.failed.length > 0) throw new Error(`merchant run failed in simulation: ${r.failed[0]!.error}`);
  }
  const decisions = store.rows.map((r) => r.decision);
  // A decision from the fake model must never look like real inference evidence.
  for (const r of store.rows) {
    if (isFakeDecision(r.decision) && (r.decision.attested || r.evidence !== null)) {
      throw new Error("fake-model decision carries attestation or evidence; refusing to continue");
    }
  }
  const bySource = { llm: 0, baseline: 0, keep: 0 };
  for (const d of decisions) bySource[d.source]++;
  return { stats: world.stats(), decisions, bySource, world };
}
