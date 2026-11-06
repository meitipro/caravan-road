// ApiError, ApiResult helpers and the contract-panic -> ErrorCode mapping.

import type { ApiResult, ErrorCode } from "@caravan/shared";

// Errors are recognised by a brand (Symbol.for is shared by every copy of this module in the process), not by
// `instanceof`: `next dev` bundles this file once per route, so a container created by one route holds a different
// ApiError class than the http.ts of another route and `instanceof` silently fails (every mapped rejection then
// became HTTP 500 INTERNAL).
const API_ERROR = Symbol.for("caravan.ApiError");
const CONTRACT_PANIC = Symbol.for("caravan.ContractPanic");

export class ApiError extends Error {
  readonly [API_ERROR] = true;
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === "object" && e !== null && (e as Record<symbol, unknown>)[API_ERROR] === true
    && typeof (e as { code?: unknown }).code === "string" && (ERROR_CODES as string[]).includes((e as { code: string }).code);
}

export const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
export const fail = (code: ErrorCode, message: string): ApiResult<never> => ({ ok: false, error: { code, message } });

export const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  BAD_REQUEST: 400,
  RATE_LIMIT: 429,
  MODE_NOT_ALLOWED: 403,
  NOT_IN_CITY: 409,
  IN_TRANSIT: 409,
  NOT_ARRIVED: 409,
  INSUFFICIENT_FUNDS: 409,
  INSUFFICIENT_STOCK: 409,
  MERCHANT_BROKE: 409,
  SLIPPAGE: 409,
  CARGO_LIMIT: 409,
  PAUSED: 503,
  INTERNAL: 500,
};

export const ERROR_CODES = Object.keys(HTTP_STATUS) as ErrorCode[];

/** Thrown by a ContractClient when the contract call failed; `message` is the panic text. */
export class ContractPanic extends Error {
  readonly [CONTRACT_PANIC] = true;
  constructor(message: string) {
    super(message);
    this.name = "ContractPanic";
  }
}

export function isContractPanic(e: unknown): e is ContractPanic {
  return typeof e === "object" && e !== null && (e as Record<symbol, unknown>)[CONTRACT_PANIC] === true;
}

// Convention (to be reconciled with the Rust contract, see SERVER.md): a panic message starts with
// the ErrorCode token, e.g. "SLIPPAGE: price moved". We also recognise a few natural-language
// messages from spec/ECONOMY.md ("warehouse full"). Anything else is INTERNAL and is never shown
// to the player verbatim.
const ALIASES: Array<[RegExp, ErrorCode]> = [
  [/warehouse full/i, "BAD_REQUEST"],
  [/\bpaused\b/i, "PAUSED"],
  [/faucet.*cooldown|cooldown/i, "RATE_LIMIT"],
  [/not in (that |the )?city/i, "NOT_IN_CITY"],
  [/merchant (is )?broke|cannot afford/i, "MERCHANT_BROKE"],
  [/slippage|price moved/i, "SLIPPAGE"],
  [/not arrived/i, "NOT_ARRIVED"],
  [/in transit|travelling|traveling/i, "IN_TRANSIT"],
  [/insufficient (funds|balance)/i, "INSUFFICIENT_FUNDS"],
  [/insufficient stock/i, "INSUFFICIENT_STOCK"],
  [/cargo (limit|full)|caravan is full/i, "CARGO_LIMIT"],
];

/** Fixed, player-safe text per code. Raw panic text never reaches a client (it is logged redacted). */
export const PUBLIC_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in.",
  BAD_REQUEST: "That action is not allowed right now.",
  RATE_LIMIT: "Too many requests. Please slow down.",
  MODE_NOT_ALLOWED: "That is not available in this game mode.",
  NOT_IN_CITY: "You are not in that city.",
  IN_TRANSIT: "Your caravan is on the road.",
  NOT_ARRIVED: "The caravan has not arrived yet.",
  INSUFFICIENT_FUNDS: "Not enough dinar.",
  INSUFFICIENT_STOCK: "Not enough goods.",
  MERCHANT_BROKE: "The merchant cannot afford that.",
  SLIPPAGE: "The price moved. Please try again.",
  CARGO_LIMIT: "The caravan cannot carry that much.",
  PAUSED: "The game is paused for maintenance.",
  INTERNAL: "Something went wrong. Please try again.",
};

/** Returns the code and the fixed public message; `raw` is the cleaned panic text for redacted logging. */
export function mapPanic(panic: string): { code: ErrorCode; message: string; raw: string } {
  const text = panic.replace(/^.*?(Smart contract panicked|ExecutionError):\s*/i, "").trim();
  const token = /^([A-Z_]+)\b[:\s-]*(.*)$/s.exec(text);
  if (token && token[1] && (ERROR_CODES as string[]).includes(token[1])) {
    // A contract UNAUTHENTICATED ("not your stall", unregistered caller) is never a session problem: only the server
    // issues UNAUTHENTICATED for a missing session, so telling the player to log in again would be wrong. 4xx, not 500.
    const code = token[1] === "UNAUTHENTICATED" ? "BAD_REQUEST" : (token[1] as ErrorCode);
    return { code, message: PUBLIC_MESSAGES[code], raw: text };
  }
  for (const [re, code] of ALIASES) if (re.test(text)) return { code, message: PUBLIC_MESSAGES[code], raw: text };
  return { code: "INTERNAL", message: PUBLIC_MESSAGES.INTERNAL, raw: text };
}
