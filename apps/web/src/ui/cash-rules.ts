// Cash rules the screen must follow and the wording for server refusals. Pure functions, tested in cash-rules.test.ts.

import { PARAMS, type ErrorCode } from "@caravan/shared";
import { formatCoins } from "./format";
import { ERROR_TEXT } from "./game-meta";

export const MIN_WITHDRAW = BigInt(PARAMS.MIN_WITHDRAW_FILS);
export const DAILY_WITHDRAW_CAP = BigInt(PARAMS.DAILY_WITHDRAW_CAP_FILS);

/**
 * Why a withdrawal amount cannot be sent, or null when it can. `fils` is null when the text is not a number
 * (the caller words that case itself). Order matters: the first rule that fails is the one shown.
 */
export function withdrawProblem(fils: bigint | null, balance: bigint): string | null {
  if (fils === null) return null;
  if (fils <= 0n) return "Enter an amount above zero.";
  if (fils < MIN_WITHDRAW) return `The minimum withdrawal is ${formatCoins(MIN_WITHDRAW)} coins.`;
  if (fils > balance) return "That is more than your balance.";
  if (fils > DAILY_WITHDRAW_CAP) return `The daily limit is ${formatCoins(DAILY_WITHDRAW_CAP)} coins (per UTC day, refunded withdrawals included).`;
  return null;
}

// Messages the server writes for the player (apps/web/src/server/game/money.ts). Matched loosely so a small rewording
// on the server still gets through; anything else falls back to the generic text for the error code.
const SERVER_MESSAGE_PATTERNS: RegExp[] = [
  /withdrawal in progress/i,
  /daily withdrawal limit/i,
  /minimum withdrawal/i,
  /asset is not supported/i,
  /deposit limit/i,
  /not available right now/i,
];

/**
 * Friendly text for a refused deposit or withdrawal. BAD_REQUEST would otherwise read the same for every rule
 * ("That did not look right"), hiding the reason the server gave (a withdrawal already open, the UTC-day cap...).
 */
export function cashErrorText(err: { code: ErrorCode; message?: string }): string {
  const m = err.message?.trim();
  if ((err.code === "BAD_REQUEST" || err.code === "PAUSED") && m && SERVER_MESSAGE_PATTERNS.some((re) => re.test(m))) return m;
  return ERROR_TEXT[err.code] ?? m ?? ERROR_TEXT.INTERNAL;
}
