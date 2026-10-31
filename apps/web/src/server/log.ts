// Logger with redaction: keys, tokens, bearer secrets, e-mail addresses and NEAR account ids never
// reach the log output. Only console.warn / console.error are used (lint rule).

const PATTERNS: Array<[RegExp, string]> = [
  [/ed25519:[1-9A-HJ-NP-Za-km-z]{20,}/g, "[key]"],
  [/secp256k1:[1-9A-HJ-NP-Za-km-z]{20,}/g, "[key]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:testnet|near)\b/g, "[account]"],
  [/\b[0-9a-f]{64}\b/gi, "[hex]"],
];

export function redact(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

function fmt(parts: unknown[]): string {
  return redact(
    parts
      .map((p) => (p instanceof Error ? `${p.name}: ${p.message}` : typeof p === "string" ? p : safeJson(p)))
      .join(" "),
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  } catch {
    return "[unserializable]";
  }
}

export interface Logger {
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
}

export const log: Logger = {
  warn: (...p) => console.warn(fmt(p)),
  error: (...p) => console.error(fmt(p)),
};

export const silentLog: Logger = { warn: () => undefined, error: () => undefined };
