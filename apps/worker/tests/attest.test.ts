import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EvidenceAttestor, sha256Hex, verifyEd25519Text, type QuoteVerifier } from "../src/attest.js";
import type { ModelReply } from "../src/brain.js";

// Throw-away test keys generated in memory for this test run; not secrets and never written anywhere.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubHex = (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32).toString("hex");
const signHex = (text: string) => sign(null, Buffer.from(text, "utf8"), privateKey).toString("hex");

const reply: ModelReply = {
  content: "{}",
  requestId: "req-1",
  model: "org/model",
  chatId: "chat-1",
  latencyMs: 5,
  requestBody: '{"model":"org/model"}',
  responseBody: '{"id":"chat-1"}',
};
const reqHash = sha256Hex(reply.requestBody);
const resHash = sha256Hex(reply.responseBody);

const sigResponse = (over: Record<string, unknown> = {}) => {
  const text = (over.text as string | undefined) ?? `org/model:${reqHash}:${resHash}`;
  return new Response(
    JSON.stringify({ text, signature: signHex(text), signing_address: pubHex, signing_algo: "ed25519", signature_kind: "provider_tee", ...over }),
    { status: 200 },
  );
};

const okQuote: QuoteVerifier = { verify: async () => ({ ok: true, detail: "quote verified by test double" }) };
const badQuote: QuoteVerifier = { verify: async () => ({ ok: false, detail: "quote invalid" }) };

describe("verifyEd25519Text", () => {
  it("accepts a valid signature, rejects tampering and malformed input", () => {
    expect(verifyEd25519Text("hello", signHex("hello"), pubHex)).toBe(true);
    expect(verifyEd25519Text("hello!", signHex("hello"), pubHex)).toBe(false);
    expect(verifyEd25519Text("hello", "00".repeat(64), pubHex)).toBe(false);
    expect(verifyEd25519Text("hello", "zz", pubHex)).toBe(false);
    expect(verifyEd25519Text("hello", signHex("hello"), "abcd")).toBe(false);
    expect(verifyEd25519Text("hello", `0x${signHex("hello")}`, `0x${pubHex}`)).toBe(true);
  });
});

describe("EvidenceAttestor: attested is true ONLY when every check passed", () => {
  const make = (fetchImpl: unknown, quoteVerifier?: QuoteVerifier) =>
    new EvidenceAttestor({ apiKey: "test-key", fetchImpl: fetchImpl as never, ...(quoteVerifier ? { quoteVerifier } : {}) });

  it("always records hashes, request id, model", async () => {
    const e = await make(async () => new Response("", { status: 404 })).capture({ merchant: "dasht", at: 1, reply });
    expect(e).toMatchObject({ merchant: "dasht", request_id: "req-1", model: "org/model", request_sha256: reqHash, response_sha256: resHash });
  });

  it("valid signature but NO quote verifier -> attested false (signature alone proves nothing about a TEE)", async () => {
    const e = await make(async () => sigResponse()).capture({ merchant: "dasht", at: 1, reply });
    expect(e.checks).toEqual({ signature: "ok", tee_quote: "not_verified" });
    expect(e.attested).toBe(false);
    expect(e.note).toMatch(/not verified/);
  });

  it("valid signature + passing quote verifier + provider_tee -> attested true", async () => {
    const e = await make(async () => sigResponse(), okQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(e.checks).toEqual({ signature: "ok", tee_quote: "ok" });
    expect(e.attested).toBe(true);
  });

  it("failing quote verifier -> false", async () => {
    const e = await make(async () => sigResponse(), badQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(e.checks.tee_quote).toBe("failed");
    expect(e.attested).toBe(false);
  });

  it("throwing quote verifier -> false, no exception", async () => {
    const e = await make(async () => sigResponse(), { verify: async () => { throw new Error("boom"); } }).capture({ merchant: "dasht", at: 1, reply });
    expect(e.attested).toBe(false);
  });

  it("signature text that does not match the hashes -> failed -> false even with a passing quote", async () => {
    const e = await make(async () => sigResponse({ text: `org/model:${reqHash}:${"0".repeat(64)}` }), okQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(e.checks.signature).toBe("failed");
    expect(e.attested).toBe(false);
  });

  it("a signature made with a different key -> failed", async () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const text = `org/model:${reqHash}:${resHash}`;
    const bad = sign(null, Buffer.from(text), other).toString("hex");
    const e = await make(async () => sigResponse({ signature: bad }), okQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(e.checks.signature).toBe("failed");
    expect(e.attested).toBe(false);
  });

  it("ecdsa signatures are not verified here -> failed -> false", async () => {
    const e = await make(async () => sigResponse({ signing_algo: "ecdsa" }), okQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(e.attested).toBe(false);
  });

  it("gateway-signed responses never count as model attestation", async () => {
    const text = `${reqHash}:${resHash}`;
    const e = await make(async () => sigResponse({ text, signature_kind: "gateway" }), okQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(e.checks.signature).toBe("ok");
    expect(e.attested).toBe(false);
  });

  it("signature endpoint down / malformed -> unavailable, attested false", async () => {
    const down = await make(async () => { throw new Error("net"); }, okQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(down.checks.signature).toBe("unavailable");
    expect(down.attested).toBe(false);
    const junk = await make(async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 }), okQuote).capture({ merchant: "dasht", at: 1, reply });
    expect(junk.checks.signature).toBe("unavailable");
    expect(junk.attested).toBe(false);
  });

  it("no chat id -> nothing fetched, attested false", async () => {
    const f = vi.fn();
    const e = await make(f, okQuote).capture({ merchant: "dasht", at: 1, reply: { ...reply, chatId: null } });
    expect(f).not.toHaveBeenCalled();
    expect(e.attested).toBe(false);
    expect(e.checks.signature).toBe("not_attempted");
  });

  it("needs the API key", () => {
    expect(() => new EvidenceAttestor({ apiKey: "" })).toThrow();
  });
});
