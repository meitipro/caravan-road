// FAKE MODEL. A scripted stand-in for the language model, used ONLY by tests, the dry run and the
// evaluation harness. It is a deterministic heuristic per persona plus optional injected faults. It is
// NOT an LLM: nothing measured with it says anything about a real model. Never imported by main.ts or
// bootstrap.ts (a test enforces that).

import type { CityId, Mood } from "@caravan/shared";
import { PARAMS } from "@caravan/shared";
import { clampInt, deriveMood } from "../baseline.js";
import { NearAiError, type ModelClient, type ModelReply } from "../brain.js";
import type { Features } from "../features.js";
import { PERSONAS } from "../personas.js";
import type { ChatMessage } from "../prompts.js";
import { Rng } from "../sim-world.js";

/** Value of Decision.model for every decision the fake produces. Never a real model id. */
export const FAKE_MODEL_NAME = "fake-scripted";
/** Prefix of every request id / chat id the fake invents; real service ids never use it. */
export const FAKE_ID_PREFIX = "fake-";

export interface FakeFaults {
  /** probability per call of: reply without any JSON */
  noJson?: number;
  /** probability per call of: spread/bias far outside the allowed ranges (must be clamped) */
  outOfRange?: number;
  /** probability per call of: spread_bp as a string (must be rejected) */
  wrongType?: number;
  /** probability per call of: a timeout error */
  timeout?: number;
}

interface PersonaScript {
  baseSpread: number;
  /** multiplier on the scarcity push, in 1/100 */
  biasGain: number;
  /** extra spread per 1000 bp of treasury shortfall, in 1/100 */
  treasuryGain: number;
  shipsOften: boolean;
}

const SCRIPT: Record<CityId, PersonaScript> = {
  dasht: { baseSpread: 700, biasGain: 80, treasuryGain: 100, shipsOften: false },
  madan: { baseSpread: 900, biasGain: 60, treasuryGain: 100, shipsOften: false },
  bandar: { baseSpread: 1000, biasGain: 160, treasuryGain: 100, shipsOften: false },
  shahr: { baseSpread: 1300, biasGain: 80, treasuryGain: 100, shipsOften: true },
};

/** The scripted policy for a feature vector (exported so the evaluation can reason about it). */
export function scriptedPolicy(f: Features, optionCount: number): { spread_bp: number; bias_bp: number; mood: Mood; ship_choice: number | null } {
  const s = SCRIPT[f.merchant];
  const shortfall = Math.max(0, 10000 - f.treasury_bp);
  const spread = clampInt(s.baseSpread + Math.trunc((shortfall * s.treasuryGain) / 1000 / 10), PARAMS.SPREAD_MIN_BP, PARAMS.SPREAD_MAX_BP);
  const bias = clampInt(Math.trunc(((10000 - f.avg_ratio_bp) * s.biasGain) / 100 / 3), PARAMS.BIAS_MIN_BP, PARAMS.BIAS_MAX_BP);
  const mood = deriveMood(f.treasury_bp, f.avg_ratio_bp);
  const ship = optionCount > 0 && (s.shipsOften || f.avg_ratio_bp > 11000) ? 0 : null;
  return { spread_bp: spread, bias_bp: bias, mood, ship_choice: ship };
}

/** True for any decision that came from the fake model (by model value or by invented request id). */
export function isFakeDecision(d: { model: string | null; request_id: string | null }): boolean {
  return d.model === FAKE_MODEL_NAME || (d.request_id?.startsWith(FAKE_ID_PREFIX) ?? false);
}

export class FakeModel implements ModelClient {
  private readonly rng: Rng;
  calls = 0;
  constructor(
    seed: number,
    private readonly faults: FakeFaults = {},
  ) {
    this.rng = new Rng(seed);
  }

  async complete(messages: ChatMessage[]): Promise<ModelReply> {
    this.calls++;
    const f = this.faults;
    const roll = this.rng.next();
    if (roll < (f.timeout ?? 0)) throw new NearAiError("timeout", "request timed out (injected by FakeModel)");
    const user = [...messages].reverse().find((m) => m.role === "user" && m.content.startsWith("{"));
    if (!user) throw new Error("FakeModel: no feature message");
    const parsed = JSON.parse(user.content) as { features: Features; ship_options: unknown[] };
    const p = scriptedPolicy(parsed.features, parsed.ship_options.length);
    const persona = PERSONAS[parsed.features.merchant];
    const line = persona.fallbackLines[p.mood];
    const body: unknown = { ...p, line, reason: `Scripted fake: treasury ${parsed.features.treasury_bp} bp, average stock ${parsed.features.avg_ratio_bp} bp.` };
    let content = JSON.stringify(body);
    const isRetry = messages[messages.length - 1]?.content.startsWith("Your last reply was not valid");
    const r2 = this.rng.next();
    let acc = 0;
    if (!isRetry) {
      if (r2 < (acc += f.noJson ?? 0)) content = "Certainly! Prices are fair today, come and trade.";
      else if (r2 < (acc += f.outOfRange ?? 0)) content = JSON.stringify({ ...(body as object), spread_bp: 5000, bias_bp: -9000 });
      else if (r2 < (acc += f.wrongType ?? 0)) content = JSON.stringify({ ...(body as object), spread_bp: "900" });
    }
    const responseBody = JSON.stringify({ id: `${FAKE_ID_PREFIX}${this.calls}`, model: FAKE_MODEL_NAME, choices: [{ message: { content } }] });
    return {
      content,
      requestId: `${FAKE_ID_PREFIX}req-${this.calls}`,
      model: FAKE_MODEL_NAME,
      chatId: `${FAKE_ID_PREFIX}${this.calls}`,
      latencyMs: 0,
      requestBody: JSON.stringify(messages),
      responseBody,
    };
  }
}
