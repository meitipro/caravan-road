import type { CityId } from "@caravan/shared";
import { baselineDecision } from "../src/baseline.js";
import { computeShipOptions } from "../src/candidates.js";
import { buildFeatures, StockHistory } from "../src/features.js";
import { buildPrompt } from "../src/prompts.js";
import { scenarioSnapshot, type ScenarioSpec } from "../src/scenario.js";

export function ctxFor(city: CityId, spec: ScenarioSpec) {
  const snapshot = scenarioSnapshot(city, spec);
  const features = buildFeatures(snapshot, city, new StockHistory());
  const options = computeShipOptions(snapshot, city);
  const baseline = baselineDecision(features, options);
  const prompt = buildPrompt(features, options);
  return { snapshot, features, options, baseline, prompt };
}

/** A state in which dasht has a grain glut and every other city is below its grain target, so a ship option exists. */
export const GLUT: ScenarioSpec = { treasury_bp: 10000, own_ratio_bp: { grain: 17000 }, others_ratio_bp: { grain: 9000 } };
export const NEUTRAL: ScenarioSpec = { treasury_bp: 10000 };
