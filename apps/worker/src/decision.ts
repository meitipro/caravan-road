// Validation of the model's raw output (spec 8.5). The model only PROPOSES; this file decides what is
// accepted. Layer 2 of the authority limits in spec 8.2: zod structure check, then clamping.
//
// Rules (each has a test):
//  - not a JSON object                      -> reject
//  - spread_bp / bias_bp missing or not an integer number (string, float, null, NaN) -> reject
//  - spread_bp / bias_bp out of range       -> clamp to [400, 2000] / [-1500, 1500], report clamp
//  - mood not one of the four (or missing)  -> derived from the baseline
//  - ship_choice not an integer index of a supplied option (or missing) -> null
//  - line (one English string): wrong type -> reject; empty after sanitising (which strips Arabic-script
//    characters, so a non-English reply ends up empty) -> persona fallback line; trimmed to <= 120
//  - reason: trimmed to <= 240, empty -> a neutral default
//  - extra keys are ignored (and reported)

import type { Decision, Mood } from "@caravan/shared";
import { DecisionSchema, PARAMS } from "@caravan/shared";
import { z } from "zod";
import { clampInt, type BaselineDecision } from "./baseline.js";
import type { ShipOption } from "./candidates.js";
import { sanitizeDisplayText } from "./sanitize.js";

export const LINE_MAX = 120;
export const REASON_MAX = 240;

const MOODS: readonly Mood[] = ["calm", "greedy", "worried", "generous"];

const RawOutputSchema = z.object({
  spread_bp: z.number().int(),
  bias_bp: z.number().int(),
  mood: z.unknown().optional(),
  ship_choice: z.unknown().optional(),
  line: z.string().optional(),
  reason: z.string().optional(),
});

export interface ValidatedOutput {
  spread_bp: number;
  bias_bp: number;
  mood: Mood;
  ship: ShipOption | null;
  line: string;
  reason: string;
}

export interface ValidationReport {
  clamped: { spread_bp: boolean; bias_bp: boolean };
  /** human-readable list of repairs applied, for logs and the evaluation */
  repairs: string[];
}

export type ValidationResult =
  | { ok: true; value: ValidatedOutput; report: ValidationReport }
  | { ok: false; error: string };

export interface ValidationContext {
  options: readonly ShipOption[];
  baseline: BaselineDecision;
}

/**
 * Extract the JSON object from model text. Strict first (whole text is JSON); otherwise tolerate a
 * <think> block and a code fence and take the outermost {...}. Anything else is rejected.
 */
export function parseModelJson(text: string): { ok: true; value: unknown; repaired: boolean } | { ok: false; error: string } {
  const t = text.trim();
  try {
    return { ok: true, value: JSON.parse(t), repaired: false };
  } catch {
    // fall through to tolerant extraction
  }
  const stripped = t.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(stripped);
  const candidate = fenced ? fenced[1]! : stripped;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "no JSON object in model output" };
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)), repaired: true };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
}

export function validateModelOutput(raw: unknown, ctx: ValidationContext): ValidationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "output is not a JSON object" };
  }
  const parsed = RawOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `schema: ${first?.path.join(".") || "root"}: ${first?.message ?? "invalid"}` };
  }
  const o = parsed.data;
  const repairs: string[] = [];

  const spread = clampInt(o.spread_bp, PARAMS.SPREAD_MIN_BP, PARAMS.SPREAD_MAX_BP);
  const bias = clampInt(o.bias_bp, PARAMS.BIAS_MIN_BP, PARAMS.BIAS_MAX_BP);
  const clamped = { spread_bp: spread !== o.spread_bp, bias_bp: bias !== o.bias_bp };
  if (clamped.spread_bp) repairs.push(`spread_bp ${o.spread_bp} clamped to ${spread}`);
  if (clamped.bias_bp) repairs.push(`bias_bp ${o.bias_bp} clamped to ${bias}`);

  let mood: Mood;
  if (typeof o.mood === "string" && (MOODS as readonly string[]).includes(o.mood)) {
    mood = o.mood as Mood;
  } else {
    mood = ctx.baseline.mood;
    repairs.push("mood invalid or missing; derived from baseline");
  }

  let ship: ShipOption | null = null;
  const sc = o.ship_choice;
  if (sc !== undefined && sc !== null) {
    const opt = typeof sc === "number" && Number.isInteger(sc) ? ctx.options.find((x) => x.index === sc) : undefined;
    if (opt) ship = opt;
    else repairs.push("ship_choice invalid; set to null");
  }

  let line = o.line !== undefined ? sanitizeDisplayText(o.line, LINE_MAX) : "";
  if (line.length === 0) {
    line = ctx.baseline.line;
    repairs.push("line empty or missing; persona fallback used");
  }

  let reason = sanitizeDisplayText(o.reason ?? "", REASON_MAX);
  if (reason.length === 0) {
    reason = "No reason given by the model.";
    repairs.push("reason empty or missing");
  }

  const extra = Object.keys(raw).filter((k) => !["spread_bp", "bias_bp", "mood", "ship_choice", "line", "reason"].includes(k));
  if (extra.length > 0) repairs.push(`ignored extra keys: ${extra.slice(0, 5).join(",").slice(0, 60)}`);

  return {
    ok: true,
    value: { spread_bp: spread, bias_bp: bias, mood, ship, line, reason },
    report: { clamped, repairs },
  };
}

export interface DecisionMeta {
  merchant: Decision["merchant"];
  ts: number;
  source: Decision["source"];
  model: string | null;
  request_id: string | null;
  attested: boolean;
  tx_hashes: string[];
}

/** Assemble the recorded Decision. The shared DecisionSchema is the last guard: it throws on any range violation. */
export function toDecision(v: ValidatedOutput | BaselineDecision, meta: DecisionMeta): Decision {
  const ship = v.ship ? { to: v.ship.to, good: v.ship.good, qty: v.ship.qty } : null;
  const decision: Decision = {
    merchant: meta.merchant,
    ts: meta.ts,
    spread_bp: v.spread_bp,
    bias_bp: v.bias_bp,
    mood: v.mood,
    ship,
    line: v.line,
    reason: v.reason,
    source: meta.source,
    model: meta.model,
    request_id: meta.request_id,
    attested: meta.attested,
    tx_hashes: meta.tx_hashes,
  };
  return DecisionSchema.parse(decision) as Decision;
}
