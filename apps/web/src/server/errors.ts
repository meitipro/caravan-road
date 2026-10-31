// ApiError, ApiResult helpers and the contract-panic -> ErrorCode mapping.

import type { ApiResult, ErrorCode } from "@caravan/shared";

export class ApiError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
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
  constructor(message: string) {
    super(message);
    this.name = "ContractPanic";
  }
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

const PUBLIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  INTERNAL: "Something went wrong. Please try again.",
};

export function mapPanic(panic: string): { code: ErrorCode; message: string } {
  const text = panic.replace(/^.*?(Smart contract panicked|ExecutionError):\s*/i, "").trim();
  const token = /^([A-Z_]+)\b[:\s-]*(.*)$/s.exec(text);
  if (token && token[1] && (ERROR_CODES as string[]).includes(token[1]) && token[1] !== "UNAUTHENTICATED") {
    const code = token[1] as ErrorCode;
    return { code, message: token[2]?.trim() || defaultMessage(code) };
  }
  for (const [re, code] of ALIASES) if (re.test(text)) return { code, message: text.slice(0, 200) };
  return { code: "INTERNAL", message: PUBLIC_MESSAGES.INTERNAL! };
}

function defaultMessage(code: ErrorCode): string {
  return PUBLIC_MESSAGES[code] ?? code.toLowerCase().replace(/_/g, " ");
}
