// One decision for one merchant (spec 8.3, 8.6, 8.9 task 6).
//
//   read state -> features + ship options -> (skip model if nothing moved) -> model or baseline
//   -> apply set_policy (only if changed) and ship -> record the Decision -> remember
//
// Fallback ladder (spec 8.6):
//   llm      model answered and the answer validated
//   baseline model timeout/error/invalid after the one retry, or no model configured
//   keep     inputs barely changed (model skipped), or set_policy was rejected (policy left as it was; ship is still tried)
//
// The model's output only ever reaches the chain through ChainPort.setPolicy / ChainPort.ship with
// values that decision.ts has clamped to the legal ranges, contract-rules.ts has stepped to within 300 bp of the
// current policy, and ship options that candidates.ts computed.

import type { CityId, Decision, Mood } from "@caravan/shared";
import type { Attestor } from "./attest.js";
import { baselineDecision, type BaselineDecision } from "./baseline.js";
import { proposeDecision, type ModelClient, type ProposeOutcome } from "./brain.js";
import { computeShipOptions, type ShipOption } from "./candidates.js";
import { stepPolicyToward } from "./contract-rules.js";
import { toDecision, type ValidatedOutput } from "./decision.js";
import { buildFeatures, StockHistory, type Features } from "./features.js";
import { buildPrompt, inputHash } from "./prompts.js";
import type { ChainPort, DecisionStore, EvidenceRecord, Logger } from "./types.js";

export const SKIP_RATIO_BP = 300;
export const SKIP_TREASURY_BP = 500;
export const SKIP_MAX_AGE_SECONDS = 600;

export interface LastLlm {
  at: number;
  treasury_bp: number;
  ratios_bp: Record<string, number>;
}

export interface LastApplied {
  mood: Mood;
  line: string;
}

export interface MerchantMemory {
  lastLlm?: LastLlm;
  lastApplied?: LastApplied;
}

export interface RunDeps {
  chain: ChainPort;
  store: DecisionStore;
  /** null: no language model available (no key); every decision is the baseline */
  model: ModelClient | null;
  attestor?: Attestor | null;
  history: StockHistory;
  memory: Map<CityId, MerchantMemory>;
  /** unix seconds */
  now: () => number;
  log: Logger;
  /** optional observer (dry run, evaluation); never required */
  observe?: (outcome: RunOutcome) => void;
}

export interface RunOutcome {
  decision: Decision;
  features: Features;
  options: ShipOption[];
  skippedModel: boolean;
  /** present when the model was called */
  propose: ProposeOutcome | null;
  evidence: EvidenceRecord | null;
  chainErrors: string[];
}

export function shouldSkipModel(last: LastLlm | undefined, f: Features, now: number): boolean {
  if (!last) return false;
  if (now - last.at >= SKIP_MAX_AGE_SECONDS) return false;
  if (Math.abs(f.treasury_bp - last.treasury_bp) >= SKIP_TREASURY_BP) return false;
  for (const [good, g] of Object.entries(f.goods)) {
    const prev = last.ratios_bp[good];
    if (prev === undefined || Math.abs(g.stock_ratio_bp - prev) >= SKIP_RATIO_BP) return false;
  }
  return true;
}

type Chosen = ValidatedOutput | BaselineDecision;

export async function runMerchantOnce(deps: RunDeps, city: CityId): Promise<RunOutcome> {
  const { chain, store, log } = deps;
  const snapshot = await chain.readSnapshot();
  deps.history.record(snapshot);
  const features = buildFeatures(snapshot, city, deps.history);
  const options = computeShipOptions(snapshot, city);
  const baseline = baselineDecision(features, options);
  const prompt = buildPrompt(features, options);
  const hash = inputHash(prompt.user);
  const now = deps.now();
  const mem = deps.memory.get(city) ?? {};
  const current = snapshot.merchants[city].policy;
  const chainErrors: string[] = [];

  let chosen: Chosen;
  let source: Decision["source"];
  let propose: ProposeOutcome | null = null;
  let skippedModel = false;
  let reply: Extract<ProposeOutcome, { ok: true }>["reply"] | null = null;

  if (deps.model && shouldSkipModel(mem.lastLlm, features, now)) {
    skippedModel = true;
    source = "keep";
    chosen = {
      spread_bp: current.spread_bp,
      bias_bp: current.bias_bp,
      mood: mem.lastApplied?.mood ?? baseline.mood,
      ship: baseline.ship, // deterministic rule; costs no credits
      line: mem.lastApplied?.line ?? baseline.line,
      reason: "Inputs barely changed since the last model decision; policy kept.",
    };
  } else if (deps.model) {
    propose = await proposeDecision(deps.model, prompt, { options, baseline });
    if (propose.ok) {
      source = "llm";
      chosen = propose.value;
      reply = propose.reply;
    } else {
      source = "baseline";
      chosen = { ...baseline, reason: `Model unavailable or invalid (${propose.errors.length} errors); baseline rule used.` };
      log.warn("model failed, using baseline", { merchant: city, errors: propose.errors.map((e) => e.slice(0, 160)) });
    }
  } else {
    source = "baseline";
    chosen = baseline;
  }

  // ---- apply on chain ----
  // set_policy and ship are independent calls: a failed policy change must not silence shipping.
  const txHashes: string[] = [];
  let shipApplied: ShipOption | null = null;
  let reason = chosen.reason;
  // The contract lets each of spread and bias move at most 300 bp per change, measured from the CURRENT
  // policy. Move toward the chosen values by that much; later rounds continue toward them.
  const sent = stepPolicyToward(current, { spread_bp: chosen.spread_bp, bias_bp: chosen.bias_bp });
  let spread = sent.spread_bp;
  let bias = sent.bias_bp;
  const limited = sent.spread_bp !== chosen.spread_bp || sent.bias_bp !== chosen.bias_bp;

  if (spread !== current.spread_bp || bias !== current.bias_bp) {
    try {
      const tx = await chain.setPolicy(city, spread, bias);
      if (tx.txHash) txHashes.push(tx.txHash);
      if (limited) reason = `Policy step limited to 300 bp: sent spread ${spread}, bias ${bias}; target ${chosen.spread_bp}, ${chosen.bias_bp}. ${reason}`;
    } catch (e) {
      chainErrors.push(`set_policy: ${(e as Error).message}`);
      spread = current.spread_bp;
      bias = current.bias_bp;
      source = "keep";
      reason = `Chain rejected set_policy; previous policy kept. ${reason}`;
    }
  } else if (limited) {
    reason = `Policy step limited to 300 bp: kept spread ${spread}, bias ${bias}; target ${chosen.spread_bp}, ${chosen.bias_bp}. ${reason}`;
  }
  if (chosen.ship) {
    try {
      const tx = await chain.ship(city, chosen.ship.to, chosen.ship.good, chosen.ship.qty);
      if (tx.txHash) txHashes.push(tx.txHash);
      shipApplied = chosen.ship;
    } catch (e) {
      chainErrors.push(`ship: ${(e as Error).message}`);
      reason = `Ship was rejected by the chain. ${reason}`;
    }
  }
  if (chainErrors.length > 0) log.warn("chain error", { merchant: city, errors: chainErrors.map((e) => e.slice(0, 200)) });

  // ---- evidence (llm decisions that were actually applied) ----
  let evidence: EvidenceRecord | null = null;
  const llmApplied = source === "llm" && reply !== null;
  if (llmApplied && deps.attestor && reply) {
    try {
      evidence = await deps.attestor.capture({ merchant: city, at: now, reply });
    } catch (e) {
      log.warn("evidence capture failed", { merchant: city, error: (e as Error).message.slice(0, 160) });
    }
  }

  const final: ValidatedOutput | BaselineDecision = { ...chosen, spread_bp: spread, bias_bp: bias, ship: shipApplied, reason: reason.slice(0, 240) };
  const decision = toDecision(final, {
    merchant: city,
    ts: now,
    source,
    model: llmApplied && reply ? reply.model : null,
    request_id: llmApplied && reply ? reply.requestId : null,
    // never true unless the attestor's checks all passed
    attested: evidence?.attested === true,
    tx_hashes: txHashes,
  });

  try {
    await store.insertDecision({ decision, input_hash: hash, evidence });
  } catch (e) {
    log.error("could not store decision", { merchant: city, error: (e as Error).message.slice(0, 160) });
  }

  // ---- memory ----
  deps.memory.set(city, {
    lastApplied: { mood: decision.mood, line: decision.line },
    ...(llmApplied
      ? {
          lastLlm: {
            at: now,
            treasury_bp: features.treasury_bp,
            ratios_bp: Object.fromEntries(Object.entries(features.goods).map(([g, v]) => [g, v.stock_ratio_bp])),
          },
        }
      : mem.lastLlm
        ? { lastLlm: mem.lastLlm }
        : {}),
  });

  const outcome: RunOutcome = { decision, features, options, skippedModel, propose, evidence, chainErrors };
  try {
    deps.observe?.(outcome);
  } catch {
    // observers must never affect the worker
  }
  return outcome;
}
