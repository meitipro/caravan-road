// Model discovery (spec 8.4): read the list at startup, never hard-code a model.
//
// Sources (read 2026-10-31):
//   GET /v1/model/list  -> { models: [{ modelId, metadata: { supportedFeatures?, attestationSupported, verifiable, ... } }], limit, offset, total }
//     https://docs.near.ai/api-reference/models/list-models-with-pricing.md
//   GET /v1/models      -> OpenAI style { object, data: [{ id, supported_features, ... }] } (no auth documented)
//     https://docs.near.ai/api-reference/chat/list-available-models.md
// The worker tries /model/list first and falls back to /models.

import { z } from "zod";
import { NEAR_AI_DEFAULT_BASE_URL } from "./brain.js";

export interface ModelInfo {
  id: string;
  structuredOutputs: boolean | null; // null = list did not say
  attestationSupported: boolean | null;
}

export class ModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSelectionError";
  }
}

const ModelListSchema = z.object({
  models: z.array(
    z.object({
      modelId: z.string().min(1),
      metadata: z
        .object({
          supportedFeatures: z.array(z.string()).nullish(),
          attestationSupported: z.boolean().nullish(),
        })
        .passthrough()
        .nullish(),
    }),
  ),
});

const OpenAiListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1), supported_features: z.array(z.string()).nullish() })),
});

export interface ListOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function getJson(url: string, o: ListOptions): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 10_000);
  try {
    const res = await (o.fetchImpl ?? fetch)(url, {
      headers: { accept: "application/json", ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels(o: ListOptions = {}): Promise<ModelInfo[]> {
  const base = (o.baseUrl ?? NEAR_AI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const parsed = ModelListSchema.parse(await getJson(`${base}/model/list?limit=200`, o));
    return parsed.models.map((m) => ({
      id: m.modelId,
      structuredOutputs: m.metadata?.supportedFeatures ? m.metadata.supportedFeatures.includes("structured_outputs") : null,
      attestationSupported: m.metadata?.attestationSupported ?? null,
    }));
  } catch (first) {
    try {
      const parsed = OpenAiListSchema.parse(await getJson(`${base}/models`, o));
      return parsed.data.map((m) => ({
        id: m.id,
        structuredOutputs: m.supported_features ? m.supported_features.includes("structured_outputs") : null,
        attestationSupported: null,
      }));
    } catch (second) {
      throw new ModelSelectionError(
        `could not read the model list from ${base} (/model/list: ${(first as Error).message}; /models: ${(second as Error).message})`,
      );
    }
  }
}

/** Fails clearly if NEAR_AI_MODEL is missing or not in the list (no silent default model). */
export function resolveModel(configured: string | undefined, available: readonly ModelInfo[]): ModelInfo {
  if (!configured || configured.trim().length === 0) {
    const sample = available.slice(0, 8).map((m) => m.id).join(", ");
    throw new ModelSelectionError(`NEAR_AI_MODEL is not set. Pick one from the list (${available.length} available, e.g. ${sample}).`);
  }
  const found = available.find((m) => m.id === configured);
  if (!found) {
    throw new ModelSelectionError(`NEAR_AI_MODEL "${configured}" is not in the service's model list.`);
  }
  return found;
}
