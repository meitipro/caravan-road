// NEAR AI Cloud client (spec 8.4) and the one-retry loop (spec 8.5 / 8.6).
//
// Sources (read 2026-10-31):
//   Base URL, auth, X-Request-Id header:  https://docs.near.ai/cloud/quickstart
//     base https://cloud-api.near.ai/v1, "Authorization: Bearer <key>", responses carry an `X-Request-Id` header.
//   Chat completions (OpenAI format; documented params model, messages, max_tokens, temperature, ...):
//     https://docs.near.ai/api-reference/chat/create-chat-completion.md   -> POST /v1/chat/completions
//   `response_format` / JSON schema is NOT documented there. This client therefore asks for JSON in the
//   prompt and validates strictly (decision.ts). `response_format: {type:"json_object"}` is opt-in only
//   (NEAR_AI_RESPONSE_FORMAT=json_object) and has not been confirmed against the live service.
//   `x-no-aliasing: true` is sent so the model id in the response (and in the response signature) is
//   the canonical one:  https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md
//
// This module never runs without a key: constructing the client with an empty key throws.

import type { BaselineDecision } from "./baseline.js";
import type { ShipOption } from "./candidates.js";
import { parseModelJson, validateModelOutput, type ValidatedOutput, type ValidationReport } from "./decision.js";
import type { BuiltPrompt, ChatMessage } from "./prompts.js";
import { RETRY_NUDGE } from "./prompts.js";

export const NEAR_AI_DEFAULT_BASE_URL = "https://cloud-api.near.ai/v1";
export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_MAX_TOKENS = 300;
export const DEFAULT_TEMPERATURE = 0.4;

export class MissingApiKeyError extends Error {
  constructor() {
    super("NEAR_AI_API_KEY is not set; the language-model client is disabled");
    this.name = "MissingApiKeyError";
  }
}

export type NearAiErrorKind = "timeout" | "network" | "http" | "format";

export class NearAiError extends Error {
  constructor(
    readonly kind: NearAiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "NearAiError";
  }
  /** Retry on timeouts, network errors and 5xx/408/429; never on other 4xx (bad key, no credits, bad request). */
  get retryable(): boolean {
    if (this.kind === "http") return this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500;
    return true;
  }
}

export interface ModelReply {
  content: string;
  requestId: string | null;
  /** model id the service reports in the response body (falls back to the configured one) */
  model: string;
  /** completion id (`id` in the body); used for the response-signature lookup */
  chatId: string | null;
  latencyMs: number;
  /** exact bytes sent / received, kept for evidence hashing (attest.ts) */
  requestBody: string;
  responseBody: string;
}

export interface ModelClient {
  complete(messages: ChatMessage[]): Promise<ModelReply>;
}

export interface NearAiClientOptions {
  apiKey: string | undefined;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  /** opt-in, undocumented for chat completions; see header comment */
  responseFormat?: "json_object";
}

function assertSafeBaseUrl(url: string): void {
  const u = new URL(url);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !local) throw new Error("NEAR AI base URL must be https (the API key is sent to it)");
}

export function redact(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

export class NearAiClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: NearAiClientOptions) {
    if (!opts.apiKey || opts.apiKey.trim().length === 0) throw new MissingApiKeyError();
    if (!opts.model || opts.model.trim().length === 0) throw new Error("model is required (set NEAR_AI_MODEL)");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? NEAR_AI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    assertSafeBaseUrl(this.baseUrl);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get model(): string {
    return this.opts.model;
  }

  async complete(messages: ChatMessage[]): Promise<ModelReply> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      temperature: this.opts.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: this.opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: false,
    };
    if (this.opts.responseFormat) body.response_format = { type: this.opts.responseFormat };
    const requestBody = JSON.stringify(body);

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const started = Date.now();
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "x-no-aliasing": "true",
        },
        body: requestBody,
        signal: ctl.signal,
      });
      text = await res.text();
    } catch (e) {
      const aborted = ctl.signal.aborted;
      throw new NearAiError(aborted ? "timeout" : "network", redact(aborted ? "request timed out" : `network error: ${(e as Error).message}`, this.apiKey));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new NearAiError("http", redact(`HTTP ${res.status}: ${text.slice(0, 200)}`, this.apiKey), res.status);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new NearAiError("format", "response body is not JSON");
    }
    const j = json as {
      id?: unknown;
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new NearAiError("format", "response has no choices[0].message.content string");
    return {
      content,
      requestId: res.headers.get("x-request-id"),
      model: typeof j.model === "string" && j.model.length > 0 ? j.model : this.opts.model,
      chatId: typeof j.id === "string" ? j.id : null,
      latencyMs: Date.now() - started,
      requestBody,
      responseBody: text,
    };
  }
}

export interface ProposeContext {
  options: readonly ShipOption[];
  baseline: BaselineDecision;
}

export type ProposeOutcome =
  | {
      ok: true;
      value: ValidatedOutput;
      report: ValidationReport;
      reply: ModelReply;
      attempts: 1 | 2;
      /** true when attempt 1 already produced a valid decision (no retry needed) */
      firstAttemptValid: boolean;
    }
  | { ok: false; attempts: 1 | 2; errors: string[] };

/**
 * One call plus at most one retry ("JSON only") on network error, timeout, 5xx or invalid output.
 * Returns ok:false when both attempts fail; the caller falls back to the baseline (spec 8.6).
 */
export async function proposeDecision(client: ModelClient, prompt: BuiltPrompt, ctx: ProposeContext): Promise<ProposeOutcome> {
  const errors: string[] = [];
  for (const attempt of [1, 2] as const) {
    const messages = attempt === 1 ? prompt.messages : [...prompt.messages, RETRY_NUDGE];
    try {
      const reply = await client.complete(messages);
      const parsed = parseModelJson(reply.content);
      if (!parsed.ok) {
        errors.push(`attempt ${attempt}: ${parsed.error}`);
        continue;
      }
      const checked = validateModelOutput(parsed.value, ctx);
      if (!checked.ok) {
        errors.push(`attempt ${attempt}: ${checked.error}`);
        continue;
      }
      return { ok: true, value: checked.value, report: checked.report, reply, attempts: attempt, firstAttemptValid: attempt === 1 };
    } catch (e) {
      errors.push(`attempt ${attempt}: ${(e as Error).message}`);
      if (e instanceof NearAiError && !e.retryable) return { ok: false, attempts: attempt, errors };
    }
  }
  return { ok: false, attempts: 2, errors };
}
