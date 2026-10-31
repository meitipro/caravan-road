// Production wiring. Refuses to start without NEAR_AI_API_KEY (and the rest of the configuration):
// the worker never runs a degraded "no key" mode on its own. The fallback ladder (baseline) covers a
// key that is present but rejected or a model that is down at run time, not a missing key.

import { EvidenceAttestor } from "./attest.js";
import { NearAiClient } from "./brain.js";
import { NearChain } from "./chain-near.js";
import { loadConfig, type WorkerConfig } from "./config.js";
import { createPool, PgDecisionStore } from "./db.js";
import { StockHistory } from "./features.js";
import { listModels, resolveModel, type ModelInfo } from "./models.js";
import type { RunDeps } from "./run-once.js";
import { consoleLogger, type Logger } from "./types.js";

export interface Bootstrapped {
  cfg: WorkerConfig;
  deps: RunDeps;
  model: ModelInfo;
  shutdown(): Promise<void>;
}

export async function bootstrap(env: Record<string, string | undefined> = process.env, log: Logger = consoleLogger()): Promise<Bootstrapped> {
  const cfg = loadConfig(env); // throws ConfigError naming missing variables, before anything else happens

  const models = await listModels({
    ...(cfg.nearAi.baseUrl ? { baseUrl: cfg.nearAi.baseUrl } : {}),
    apiKey: cfg.nearAi.apiKey,
  });
  const model = resolveModel(cfg.nearAi.model, models);
  if (model.attestationSupported === false) log.warn("model reports attestationSupported=false", { model: model.id });

  const client = new NearAiClient({
    apiKey: cfg.nearAi.apiKey,
    model: model.id,
    ...(cfg.nearAi.baseUrl ? { baseUrl: cfg.nearAi.baseUrl } : {}),
    ...(cfg.nearAi.responseFormat ? { responseFormat: cfg.nearAi.responseFormat } : {}),
  });
  const attestor = new EvidenceAttestor({ apiKey: cfg.nearAi.apiKey, ...(cfg.nearAi.baseUrl ? { baseUrl: cfg.nearAi.baseUrl } : {}) });

  const pool = createPool(cfg.databaseUrl);
  const store = new PgDecisionStore(pool, cfg.workerId);
  await store.ensureSchema();

  const deps: RunDeps = {
    chain: new NearChain(cfg),
    store,
    model: client,
    attestor,
    history: new StockHistory(),
    memory: new Map(),
    now: () => Math.floor(Date.now() / 1000),
    log,
  };
  return { cfg, deps, model, shutdown: () => pool.end() };
}
