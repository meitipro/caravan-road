import { describe, expect, it } from "vitest";
import { PARAMS } from "@caravan/shared";
import { cashErrorText, withdrawProblem } from "./cash-rules";
import { ERROR_TEXT } from "./game-meta";

describe("withdrawProblem", () => {
  const bal = 500_000n;
  it("is null for a blank or non-numeric entry (the caller words that)", () => {
    expect(withdrawProblem(null, bal)).toBeNull();
  });
  it("blocks anything below PARAMS.MIN_WITHDRAW_FILS with a clear message", () => {
    expect(PARAMS.MIN_WITHDRAW_FILS).toBe(1000);
    expect(withdrawProblem(999n, bal)).toBe("The minimum withdrawal is 10.00 coins.");
    expect(withdrawProblem(1n, bal)).toMatch(/minimum/);
    expect(withdrawProblem(1000n, bal)).toBeNull();
  });
  it("zero, over balance and over the daily cap", () => {
    expect(withdrawProblem(0n, bal)).toBe("Enter an amount above zero.");
    expect(withdrawProblem(bal + 1n, bal)).toBe("That is more than your balance.");
    expect(withdrawProblem(100_001n, 10_000_000n)).toMatch(/daily limit is 1,000.00 coins/);
    expect(withdrawProblem(100_000n, 10_000_000n)).toBeNull();
  });
  it("the minimum is checked before the balance, so a poor player learns the real rule", () => {
    expect(withdrawProblem(500n, 100n)).toMatch(/minimum/);
  });
});

describe("cashErrorText", () => {
  it("shows the server's reason for the new withdraw rules instead of the generic text", () => {
    const open = "You already have a withdrawal in progress. Wait until it finishes before requesting another.";
    const cap = "Daily withdrawal limit reached (10 USDC per UTC day, refunded withdrawals included). It resets at 00:00 UTC.";
    const min = "The minimum withdrawal is 10 coins.";
    expect(cashErrorText({ code: "BAD_REQUEST", message: open })).toBe(open);
    expect(cashErrorText({ code: "BAD_REQUEST", message: cap })).toBe(cap);
    expect(cashErrorText({ code: "BAD_REQUEST", message: min })).toBe(min);
    expect(cashErrorText({ code: "BAD_REQUEST", message: "That asset is not supported" })).toBe("That asset is not supported");
    expect(cashErrorText({ code: "PAUSED", message: "Deposits and withdrawals are not available right now." })).toBe("Deposits and withdrawals are not available right now.");
  });
  it("falls back to the friendly generic text for unknown messages and other codes", () => {
    expect(cashErrorText({ code: "BAD_REQUEST", message: "That action is not allowed right now." })).toBe(ERROR_TEXT.BAD_REQUEST);
    expect(cashErrorText({ code: "BAD_REQUEST", message: "body: Required" })).toBe(ERROR_TEXT.BAD_REQUEST);
    expect(cashErrorText({ code: "INTERNAL" })).toBe(ERROR_TEXT.INTERNAL);
    expect(cashErrorText({ code: "PAUSED", message: "The game is paused for maintenance." })).toBe(ERROR_TEXT.PAUSED);
    expect(cashErrorText({ code: "RATE_LIMIT", message: "x" })).toBe(ERROR_TEXT.RATE_LIMIT);
  });
});
