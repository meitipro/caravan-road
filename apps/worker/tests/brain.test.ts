import { describe, expect, it, vi } from "vitest";
import { MissingApiKeyError, NearAiClient, NearAiError, proposeDecision, type ModelClient, type ModelReply } from "../src/brain.js";
import { listModels, resolveModel, ModelSelectionError } from "../src/models.js";
import { ctxFor, GLUT } from "./helpers.js";

const TEST_KEY = "test-key-not-a-real-secret-123";

const completion = (content: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "chatcmpl-abc", model: "actual/model-id", choices: [{ message: { role: "assistant", content } }], usage: {}, ...extra });

const resp = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "x-request-id": "req-123" }, ...init });

const goodJson = JSON.stringify({ spread_bp: 900, bias_bp: -300, mood: "worried", ship_choice: null, line: { en: "Hello there.", fa: "سلام دوست من." }, reason: "ok" });

function client(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return new NearAiClient({ apiKey: TEST_KEY, model: "configured/model", fetchImpl, timeoutMs: 50, ...extra });
}

describe("NearAiClient", () => {
  it("never runs without an API key", () => {
    for (const k of [undefined, "", "   "]) {
      expect(() => new NearAiClient({ apiKey: k, model: "m", fetchImpl: vi.fn() as never })).toThrow(MissingApiKeyError);
    }
  });

  it("requires a model and an https base URL (the key is sent there)", () => {
    expect(() => new NearAiClient({ apiKey: TEST_KEY, model: "", fetchImpl: vi.fn() as never })).toThrow(/model/);
    expect(() => new NearAiClient({ apiKey: TEST_KEY, model: "m", baseUrl: "http://example.com/v1", fetchImpl: vi.fn() as never })).toThrow(/https/);
    expect(() => new NearAiClient({ apiKey: TEST_KEY, model: "m", baseUrl: "http://localhost:8080/v1", fetchImpl: vi.fn() as never })).not.toThrow();
  });

  it("sends an OpenAI-style request: path, bearer auth, temperature 0.4, max_tokens 300, no stream", async () => {
    const f = vi.fn(async () => resp(completion(goodJson)));
    const c = client(f as never);
    const reply = await c.complete([{ role: "user", content: "hi" }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cloud-api.near.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(headers["x-no-aliasing"]).toBe("true");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "configured/model", temperature: 0.4, max_tokens: 300, stream: false });
    expect(body.response_format).toBeUndefined(); // undocumented for this API: opt-in only
    expect(reply.requestId).toBe("req-123");
    expect(reply.model).toBe("actual/model-id");
    expect(reply.chatId).toBe("chatcmpl-abc");
    expect(reply.content).toBe(goodJson);
    expect(reply.requestBody).toBe(init.body);
    expect(reply.responseBody).toBe(completion(goodJson));
  });

  it("response_format is only sent when explicitly enabled", async () => {
    const f = vi.fn(async () => resp(completion(goodJson)));
    await client(f as never, { responseFormat: "json_object" }).complete([{ role: "user", content: "hi" }]);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).response_format).toEqual({ type: "json_object" });
  });

  it("falls back to the configured model and null request id when the service omits them", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), { status: 200 }));
    const r = await client(f as never).complete([]);
    expect(r.model).toBe("configured/model");
    expect(r.requestId).toBeNull();
    expect(r.chatId).toBeNull();
  });

  it("times out via AbortController", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted")))));
    const err = await client(f as never, { timeoutMs: 20 }).complete([]).catch((e) => e);
    expect(err).toBeInstanceOf(NearAiError);
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(true);
  });

  it("HTTP errors: 5xx retryable, 401/402 not; the key never appears in error text even if echoed", async () => {
    const echo = vi.fn(async () => new Response(`bad key ${TEST_KEY}`, { status: 401 }));
    const e401 = await client(echo as never).complete([]).catch((e) => e);
    expect(e401.kind).toBe("http");
    expect(e401.retryable).toBe(false);
    expect(e401.message).not.toContain(TEST_KEY);
    expect(e401.message).toContain("[redacted]");
    const e500 = await client((async () => new Response("oops", { status: 503 })) as never).complete([]).catch((e) => e);
    expect(e500.retryable).toBe(true);
    const e402 = await client((async () => new Response("no credits", { status: 402 })) as never).complete([]).catch((e) => e);
    expect(e402.retryable).toBe(false);
  });

  it("network errors do not leak the key and are retryable", async () => {
    const f = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED while sending ${TEST_KEY}`);
    });
    const e = await client(f as never).complete([]).catch((x) => x);
    expect(e.kind).toBe("network");
    expect(e.message).not.toContain(TEST_KEY);
  });

  it("rejects malformed bodies", async () => {
    expect((await client((async () => resp("not json")) as never).complete([]).catch((e) => e)).kind).toBe("format");
    expect((await client((async () => resp(JSON.stringify({ choices: [] }))) as never).complete([]).catch((e) => e)).kind).toBe("format");
  });
});

// ---------------------------------------------------------------------------------------------
describe("proposeDecision (one retry, then give up)", () => {
  const ctx = ctxFor("dasht", GLUT);
  const reply = (content: string): ModelReply => ({ content, requestId: "r1", model: "m", chatId: "c1", latencyMs: 1, requestBody: "{}", responseBody: "{}" });
  const scripted = (...steps: Array<string | Error>): ModelClient & { calls: number } => {
    const o = {
      calls: 0,
      async complete() {
        const s = steps[o.calls++];
        if (s === undefined) throw new Error("unexpected extra call");
        if (s instanceof Error) throw s;
        return reply(s);
      },
    };
    return o;
  };

  it("valid on the first attempt", async () => {
    const m = scripted(goodJson);
    const r = await proposeDecision(m, ctx.prompt, ctx);
    expect(r.ok && r.firstAttemptValid).toBe(true);
    expect(m.calls).toBe(1);
  });

  it("retries once on invalid JSON, with the JSON-only nudge", async () => {
    const seen: number[] = [];
    const m: ModelClient = {
      async complete(messages) {
        seen.push(messages.length);
        return reply(seen.length === 1 ? "Sure, here is my answer" : goodJson);
      },
    };
    const r = await proposeDecision(m, ctx.prompt, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.attempts).toBe(2);
      expect(r.firstAttemptValid).toBe(false);
    }
    expect(seen[1]).toBe(seen[0]! + 1);
  });

  it("retries once on a schema failure (wrong type)", async () => {
    const bad = JSON.stringify({ spread_bp: "900", bias_bp: 0 });
    const r = await proposeDecision(scripted(bad, goodJson), ctx.prompt, ctx);
    expect(r.ok && r.attempts).toBe(2);
  });

  it("retries once on network error / timeout", async () => {
    const r = await proposeDecision(scripted(new NearAiError("network", "down"), goodJson), ctx.prompt, ctx);
    expect(r.ok && r.attempts).toBe(2);
  });

  it("gives up after one retry (2 calls max) and reports the errors", async () => {
    const m = scripted("nope", "still nope");
    const r = await proposeDecision(m, ctx.prompt, ctx);
    expect(r.ok).toBe(false);
    expect(m.calls).toBe(2);
    if (!r.ok) expect(r.errors).toHaveLength(2);
  });

  it("does not retry a 401 (bad key): fails fast so the baseline takes over", async () => {
    const m = scripted(new NearAiError("http", "HTTP 401", 401));
    const r = await proposeDecision(m, ctx.prompt, ctx);
    expect(r.ok).toBe(false);
    expect(m.calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("models", () => {
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });

  it("reads /model/list (documented shape)", async () => {
    const f = vi.fn(async () =>
      json({
        models: [
          { modelId: "a/one", metadata: { supportedFeatures: ["structured_outputs"], attestationSupported: true } },
          { modelId: "b/two", metadata: { attestationSupported: false } },
        ],
        limit: 200,
        offset: 0,
        total: 2,
      }),
    );
    const list = await listModels({ fetchImpl: f as never });
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain("https://cloud-api.near.ai/v1/model/list");
    expect(list).toEqual([
      { id: "a/one", structuredOutputs: true, attestationSupported: true },
      { id: "b/two", structuredOutputs: null, attestationSupported: false },
    ]);
  });

  it("falls back to /models (OpenAI shape)", async () => {
    const f = vi.fn(async (url: string) => (url.includes("/model/list") ? new Response("nope", { status: 404 }) : json({ object: "list", data: [{ id: "c/three", supported_features: ["tools"] }] })));
    const list = await listModels({ fetchImpl: f as never });
    expect(list).toEqual([{ id: "c/three", structuredOutputs: false, attestationSupported: null }]);
  });

  it("fails clearly when neither endpoint works", async () => {
    await expect(listModels({ fetchImpl: (async () => new Response("x", { status: 500 })) as never })).rejects.toThrow(ModelSelectionError);
  });

  it("resolveModel fails clearly when NEAR_AI_MODEL is missing or unknown, never picks a default", () => {
    const avail = [{ id: "a/one", structuredOutputs: null, attestationSupported: null }];
    expect(() => resolveModel(undefined, avail)).toThrow(/NEAR_AI_MODEL is not set/);
    expect(() => resolveModel("  ", avail)).toThrow(/NEAR_AI_MODEL is not set/);
    expect(() => resolveModel("zzz", avail)).toThrow(/not in the service's model list/);
    expect(resolveModel("a/one", avail).id).toBe("a/one");
  });
});
