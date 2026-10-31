// Sends ONE real request to NEAR AI Cloud and shows what the worker would do with the answer.
// Mahdi runs this with his own key (it spends a few tokens of credit); it is never run by tests or CI.
//
//   NEAR_AI_API_KEY=<set in your shell/.env.local> NEAR_AI_MODEL=<id from the model list> \
//     pnpm --filter @caravan/worker try-brain -- [--list] [--city dasht]
//
// `--list` only prints the model ids (no chat request). Nothing secret is printed.

import { EvidenceAttestor } from "../src/attest.js";
import { baselineDecision } from "../src/baseline.js";
import { MissingApiKeyError, NearAiClient, proposeDecision } from "../src/brain.js";
import { computeShipOptions } from "../src/candidates.js";
import { buildFeatures, StockHistory } from "../src/features.js";
import { listModels, resolveModel } from "../src/models.js";
import { buildPrompt } from "../src/prompts.js";
import { scenarioSnapshot } from "../src/scenario.js";
import { CITY_IDS, type CityId } from "@caravan/shared";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cityArg = argv[argv.indexOf("--city") + 1];
  const city: CityId = (CITY_IDS as readonly string[]).includes(cityArg ?? "") ? (cityArg as CityId) : "dasht";
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();

  const models = await listModels({ apiKey });
  if (argv.includes("--list")) {
    for (const m of models) console.log(`${m.id}  structured_outputs=${m.structuredOutputs}  attestation=${m.attestationSupported}`);
    return;
  }
  const info = resolveModel(process.env.NEAR_AI_MODEL, models);
  console.log(`model: ${info.id} (structured_outputs=${info.structuredOutputs}, attestationSupported=${info.attestationSupported})`);

  const snap = scenarioSnapshot(city, { treasury_bp: 6500, own_ratio_bp: { grain: 16000, spice: 5000 }, others_ratio_bp: {} });
  const features = buildFeatures(snap, city, new StockHistory());
  const options = computeShipOptions(snap, city);
  const baseline = baselineDecision(features, options);
  const prompt = buildPrompt(features, options);

  const client = new NearAiClient({ apiKey, model: info.id });
  const out = await proposeDecision(client, prompt, { options, baseline });
  if (!out.ok) {
    console.log("model answer unusable; the worker would fall back to the baseline:", out.errors);
    return;
  }
  console.log(`attempts: ${out.attempts}  first attempt valid: ${out.firstAttemptValid}  latency: ${out.reply.latencyMs} ms`);
  console.log(`request id: ${out.reply.requestId}  model reported: ${out.reply.model}`);
  console.log("validated decision:", JSON.stringify(out.value));
  console.log("repairs/clamps:", JSON.stringify(out.report));
  const evidence = await new EvidenceAttestor({ apiKey }).capture({ merchant: city, at: Math.floor(Date.now() / 1000), reply: out.reply });
  console.log("evidence:", JSON.stringify({ ...evidence, signature: evidence.signature ? "(captured)" : null }));
  console.log(`attested: ${evidence.attested}  (true only if the response signature AND a TEE quote verifier both passed; no quote verifier is implemented)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
