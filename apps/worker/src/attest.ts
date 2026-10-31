// Inference evidence and attestation (spec 8.9 task 7). HONESTY RULE: `attested` is true only when
// EVERY check below actually passed. By default (no quote verifier configured) it is always false.
//
// What NEAR AI documents (read 2026-10-31):
//   Verification overview:  https://docs.near.ai/cloud/verification/model/
//   Response signature:     GET /v1/signature/<chat id>?signing_algo=ecdsa|ed25519  ->
//                           { text, signature, signing_address, signing_algo, signature_kind }
//                           https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md
//                           text must equal "<MODEL_ID>:<request_hash>:<response_hash>" (provider_tee)
//                           or "<request_hash>:<response_hash>" (gateway); ed25519 verifies UTF-8 text
//                           with signing_address as the public key; ecdsa is EIP-191 recovery.
//   Model attestation:      GET /v1/attestation/report?model=..&nonce=..&signing_algo=..
//                           https://docs.near.ai/cloud/verification/cloud-api/model-attestations.md
//                           (Intel TDX quote via an Intel DCAP verifier, report_data binds nonce+signer,
//                           RTMR3 event-log replay, MRCONFIGID check, NVIDIA GPU evidence.)
//
// What this module does:
//   - ALWAYS: record request/response SHA-256 (of the exact bytes) next to the request id and model.
//   - Best effort: fetch the response signature and verify it locally (ed25519 only, via node:crypto).
//   - NOT implemented: the Intel TDX quote / NVIDIA GPU / RTMR3 verification. It is behind the
//     `QuoteVerifier` interface; with none configured `checks.tee_quote` stays "not_verified" and
//     `attested` stays false. A verified signature alone does not prove the signer is a TEE.
//
// Assumptions that are NOT confirmed against live data (any mismatch makes the check FAIL, i.e. fail safe):
//   - hashes are lowercase hex SHA-256; the signature and the ed25519 public key are hex (optional 0x).

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { CityId } from "@caravan/shared";
import { NEAR_AI_DEFAULT_BASE_URL, type ModelReply } from "./brain.js";
import type { EvidenceRecord } from "./types.js";

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const stripHex = (h: string): string => (h.startsWith("0x") ? h.slice(2) : h);

/** Verify an ed25519 signature over the UTF-8 bytes of `text`. Any malformed input returns false. */
export function verifyEd25519Text(text: string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const pub = Buffer.from(stripHex(publicKeyHex), "hex");
    const sig = Buffer.from(stripHex(signatureHex), "hex");
    if (pub.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pub]), format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(text, "utf8"), key, sig);
  } catch {
    return false;
  }
}

/** Plug-in point for real TEE verification (Intel TDX quote, NVIDIA payload, RTMR3). Not implemented here. */
export interface QuoteVerifier {
  verify(input: { model: string; signing_address: string; signing_algo: string }): Promise<{ ok: boolean; detail: string }>;
}

export interface Attestor {
  capture(input: { merchant: CityId; at: number; reply: ModelReply }): Promise<EvidenceRecord>;
}

export interface EvidenceAttestorOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  quoteVerifier?: QuoteVerifier;
  timeoutMs?: number;
}

interface SignatureBody {
  text?: unknown;
  signature?: unknown;
  signing_address?: unknown;
  signing_algo?: unknown;
  signature_kind?: unknown;
}

export class EvidenceAttestor implements Attestor {
  private readonly base: string;
  constructor(private readonly o: EvidenceAttestorOptions) {
    if (!o.apiKey) throw new Error("EvidenceAttestor needs the API key");
    this.base = (o.baseUrl ?? NEAR_AI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async capture({ merchant, at, reply }: { merchant: CityId; at: number; reply: ModelReply }): Promise<EvidenceRecord> {
    const requestHash = sha256Hex(reply.requestBody);
    const responseHash = sha256Hex(reply.responseBody);
    const rec: EvidenceRecord = {
      merchant,
      at,
      model: reply.model,
      request_id: reply.requestId,
      chat_id: reply.chatId,
      request_sha256: requestHash,
      response_sha256: responseHash,
      signature: null,
      checks: { signature: "not_attempted", tee_quote: "not_verified" },
      attested: false,
      note: "evidence recorded; TEE quote not verified",
    };
    if (!reply.chatId) return rec;

    const sig = await this.fetchSignature(reply.chatId);
    if (!sig) {
      rec.checks.signature = "unavailable";
      return rec;
    }
    rec.signature = sig;
    const kind = sig.signature_kind;
    const expected = kind === "gateway" ? `${requestHash}:${responseHash}` : `${reply.model}:${requestHash}:${responseHash}`;
    const signatureOk =
      sig.signing_algo === "ed25519" && sig.text === expected && verifyEd25519Text(sig.text, sig.signature, sig.signing_address);
    rec.checks.signature = signatureOk ? "ok" : "failed";

    if (this.o.quoteVerifier && signatureOk) {
      try {
        const q = await this.o.quoteVerifier.verify({ model: reply.model, signing_address: sig.signing_address, signing_algo: sig.signing_algo });
        rec.checks.tee_quote = q.ok ? "ok" : "failed";
        rec.note = q.detail.slice(0, 200);
      } catch (e) {
        rec.checks.tee_quote = "failed";
        rec.note = `quote verifier error: ${(e as Error).message}`.slice(0, 200);
      }
    }
    rec.attested = rec.checks.signature === "ok" && rec.checks.tee_quote === "ok" && kind === "provider_tee";
    if (!rec.attested && rec.checks.tee_quote === "not_verified") {
      rec.note = `response signature ${rec.checks.signature}; TEE quote not verified`;
    }
    return rec;
  }

  private async fetchSignature(chatId: string): Promise<NonNullable<EvidenceRecord["signature"]> | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 8000);
    try {
      const res = await (this.o.fetchImpl ?? fetch)(`${this.base}/signature/${encodeURIComponent(chatId)}?signing_algo=ed25519`, {
        headers: { accept: "application/json", authorization: `Bearer ${this.o.apiKey}` },
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      const b = (await res.json()) as SignatureBody;
      if (typeof b.text !== "string" || typeof b.signature !== "string" || typeof b.signing_address !== "string" || typeof b.signing_algo !== "string") {
        return null;
      }
      return {
        text: b.text,
        signature: b.signature,
        signing_address: b.signing_address,
        signing_algo: b.signing_algo,
        ...(typeof b.signature_kind === "string" ? { signature_kind: b.signature_kind } : {}),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
