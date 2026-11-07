import { describe, expect, it } from "vitest";
import { worldFixture, type ErrorCode, type Stall } from "@caravan/shared";
import { ERROR_TEXT } from "./game-meta";
import {
  MAX_OPEN_STALLS, buyProblem, createBlockReason, createHint, feeNote, maxStallBuyQty, myStalls, parseUnitPrice,
  plainDinar, priceVsMerchant, qtyDigits, sellerLabel, sellerProceeds, stallErrorText, stallFee, stallPrice, stallsForSale, validateCreate,
} from "./stall-math";

describe("qtyDigits (quantity box typing)", () => {
  it("keeps digits only, at most four (the old filter stripped the letter D, not non-digits)", () => {
    expect(qtyDigits("abc")).toBe("");
    expect(qtyDigits("1x2")).toBe("12");
    expect(qtyDigits("12345")).toBe("1234");
    expect(qtyDigits("D5")).toBe("5");
  });
});

const stall = (over: Partial<Stall> = {}): Stall => ({
  id: 1, seller: "p1a2b3c4d.relay.testnet", city: "shahr", good: "salt", qty: 12, unit_price: "1700", ...over,
});

describe("stall fee (the seller pays, 2% rounded up, at least 1 fils)", () => {
  it("rounds up and never goes below 1 fils", () => {
    expect(stallFee(24_000n)).toBe(480n); // contract test: 200 bp of 24,000
    expect(stallFee(1_700n)).toBe(34n);
    expect(stallFee(1_701n)).toBe(35n); // 34.02 -> 35
    expect(stallFee(1n)).toBe(1n);
    expect(stallFee(40n)).toBe(1n); // 0.8 -> 1
    expect(stallFee(51n)).toBe(2n); // 1.02 -> 2
    expect(stallFee(0n)).toBe(0n);
  });
  it("the seller keeps price minus fee; the buyer price is qty x unit with no fee on top", () => {
    expect(stallPrice("1700", 2)).toBe(3400n);
    expect(stallPrice(1700n, 12)).toBe(20_400n);
    expect(sellerProceeds(24_000n)).toBe(23_520n);
    expect(sellerProceeds(1n)).toBe(0n);
  });
  it("handles amounts beyond Number precision", () => {
    const unit = "999999999999999999999";
    const price = stallPrice(unit, 40);
    expect(price).toBe(39_999_999_999_999_999_999_960n);
    expect(stallFee(price) * 10000n >= price * 200n).toBe(true);
    expect(stallFee(price) * 10000n < price * 200n + 10000n).toBe(true);
  });
  it("the fee note tells the buyer that the seller pays it, with the exact amount", () => {
    const note = feeNote(24_000n);
    expect(note).toMatch(/seller pays/i);
    expect(note).toMatch(/4\.80 dinars/);
    expect(note).toMatch(/You pay exactly this price/);
  });
});

describe("sellerLabel", () => {
  it("says You for the player's own account", () => {
    expect(sellerLabel("p1a2b3c4d.relay.testnet", "p1a2b3c4d.relay.testnet")).toBe("You");
  });
  it("shortens generated account ids to Trader plus four characters", () => {
    expect(sellerLabel("p1a2b3c4d.relay.testnet", "someone.else")).toBe("Trader 1a2b");
  });
  it("capitalises a plain name and shortens long ones", () => {
    expect(sellerLabel("trader.fixture")).toBe("Trader");
    const long = sellerLabel("averyveryverylongaccountname.near");
    expect(long.length).toBeLessThanOrEqual(12);
    expect(long).toContain("…");
  });
});

describe("selecting stalls", () => {
  const all: Stall[] = [
    stall({ id: 5, good: "silk", unit_price: "9000", seller: "a" }),
    stall({ id: 2, good: "salt", unit_price: "1900", seller: "b" }),
    stall({ id: 3, good: "salt", unit_price: "1700", seller: "me" }),
    stall({ id: 4, good: "salt", unit_price: "1700", seller: "b", city: "bandar" }),
    stall({ id: 1, good: "grain", unit_price: "5000", seller: "c" }),
    stall({ id: 6, good: "salt", unit_price: "1700", seller: "c" }),
  ];
  it("lists other players' stalls of one city by good, cheapest first, without the player's own", () => {
    expect(stallsForSale(all, "shahr", "me").map((s) => s.id)).toEqual([1, 6, 2, 5]);
    expect(stallsForSale(all, "bandar", "me").map((s) => s.id)).toEqual([4]);
  });
  it("lists the player's own stalls in every city", () => {
    expect(myStalls(all, "me").map((s) => s.id)).toEqual([3]);
    expect(myStalls(all, null)).toEqual([]);
  });
});

describe("buying limits", () => {
  it("max is the smallest of stall quantity, caravan room and what the purse pays", () => {
    expect(maxStallBuyQty(stall(), 1_000_000n, 0)).toBe(12);
    expect(maxStallBuyQty(stall(), 1_000_000n, 35)).toBe(5);
    expect(maxStallBuyQty(stall(), 5_000n, 0)).toBe(2); // 5,000 / 1,700
    expect(maxStallBuyQty(stall(), 1_699n, 0)).toBe(0);
    expect(maxStallBuyQty(stall({ qty: 90 }), 99_999_999n, 0)).toBe(40);
    expect(maxStallBuyQty(stall(), 1_000_000n, 40)).toBe(0);
  });
  it("explains why a purchase cannot go ahead", () => {
    expect(buyProblem(stall(), 2, 5_000n, 0)).toBeNull();
    expect(buyProblem(stall(), 0, 5_000n, 0)).toMatch(/at least 1/);
    expect(buyProblem(stall(), 13, 999_999n, 0)).toMatch(/only has 12/);
    expect(buyProblem(stall(), 5, 999_999n, 38)).toMatch(/room for 2/);
    expect(buyProblem(stall(), 3, 5_000n, 0)).toMatch(/Not enough dinars/);
  });
  it("compares a stall price with the merchant ask", () => {
    expect(priceVsMerchant("1700", { ask: "1800" })).toBe("below");
    expect(priceVsMerchant("1800", { ask: "1800" })).toBe("same");
    expect(priceVsMerchant("1900", { ask: "1800" })).toBe("above");
  });
});

describe("unit price input", () => {
  it("parses dinars to fils with at most two decimals", () => {
    expect(parseUnitPrice("17")).toEqual({ ok: true, fils: 1700n });
    expect(parseUnitPrice("17.5")).toEqual({ ok: true, fils: 1750n });
    expect(parseUnitPrice(" 0.01 ")).toEqual({ ok: true, fils: 1n });
    expect(parseUnitPrice("17,25")).toEqual({ ok: true, fils: 1725n });
    expect(parseUnitPrice("10000000")).toEqual({ ok: true, fils: 1_000_000_000n });
  });
  it("rejects empty, malformed, zero and out of range values with a reason", () => {
    for (const bad of ["", "  ", "abc", "1.234", "-3", "1e3", "1,000.00"]) {
      const r = parseUnitPrice(bad);
      expect(r.ok, bad).toBe(false);
    }
    const zero = parseUnitPrice("0");
    expect(zero.ok).toBe(false);
    expect(!zero.ok && zero.reason).toMatch(/lowest price is 0\.01/);
    const huge = parseUnitPrice("10000000.01");
    expect(!huge.ok && huge.reason).toMatch(/highest price is 10,000,000\.00/);
  });
  it("plainDinar has no thousands separators so it can go back into the box", () => {
    expect(plainDinar("1700")).toBe("17.00");
    expect(plainDinar(123_456_789n)).toBe("1234567.89");
    expect(parseUnitPrice(plainDinar(123_456_789n))).toEqual({ ok: true, fils: 123_456_789n });
  });
});

describe("validateCreate", () => {
  const base = { good: "salt" as const, qty: 3, held: 5, priceInput: "17", openStalls: 0 };
  it("accepts a valid listing and returns the unit price", () => {
    expect(validateCreate(base)).toEqual({ problem: null, unit: 1700n });
  });
  it("refuses more than the player holds, nothing held, zero quantity", () => {
    expect(validateCreate({ ...base, qty: 6 }).problem).toMatch(/hold only 5/);
    expect(validateCreate({ ...base, held: 0 }).problem).toMatch(/do not hold/);
    expect(validateCreate({ ...base, qty: 0 }).problem).toMatch(/at least 1/);
  });
  it("refuses a bad price but still reports the parse state", () => {
    const r = validateCreate({ ...base, priceInput: "0" });
    expect(r.problem).toMatch(/lowest price/);
    expect(r.unit).toBeNull();
  });
  it(`refuses a ${MAX_OPEN_STALLS + 1}th open stall`, () => {
    expect(validateCreate({ ...base, openStalls: MAX_OPEN_STALLS - 1 }).problem).toBeNull();
    expect(validateCreate({ ...base, openStalls: MAX_OPEN_STALLS }).problem).toMatch(/5 open stalls/);
  });
});

describe("createHint", () => {
  const q = { bid: "900", ask: "1100" };
  it("warns below the bid and above the ask, and approves a price between", () => {
    expect(createHint(800n, q).tone).toBe("warn");
    expect(createHint(800n, q).text).toMatch(/selling to the merchant/);
    expect(createHint(1200n, q).tone).toBe("warn");
    expect(createHint(1200n, q).text).toMatch(/prefer the merchant/);
    expect(createHint(1000n, q).tone).toBe("good");
    expect(createHint(900n, q).tone).toBe("good");
    expect(createHint(1100n, q).tone).toBe("good");
  });
});

describe("createBlockReason", () => {
  const ok = { travelling: false, here: true, hereName: "Bandar", hasGoods: true, openStalls: 0 };
  it("is null when the player can open a stall", () => {
    expect(createBlockReason(ok)).toBeNull();
  });
  it("explains travelling, another city, no goods and the stall limit, in that order of priority", () => {
    expect(createBlockReason({ ...ok, travelling: true, here: false })).toMatch(/on the road/);
    expect(createBlockReason({ ...ok, here: false })).toMatch(/Go to the stalls of Bandar/);
    expect(createBlockReason({ ...ok, openStalls: MAX_OPEN_STALLS })).toMatch(/most allowed/);
    expect(createBlockReason({ ...ok, hasGoods: false })).toMatch(/hold no goods/);
  });
});

describe("stallErrorText", () => {
  it("has a friendly text for every ErrorCode and every action", () => {
    for (const action of ["buy", "create", "cancel"] as const) {
      for (const code of Object.keys(ERROR_TEXT) as ErrorCode[]) {
        const t = stallErrorText(action, code);
        expect(t.length, `${action} ${code}`).toBeGreaterThan(10);
      }
    }
  });
  it("uses stall wording where it helps and the shared text otherwise", () => {
    expect(stallErrorText("buy", "NOT_IN_CITY")).toMatch(/seller is away/);
    expect(stallErrorText("buy", "BAD_REQUEST")).toMatch(/gone/);
    expect(stallErrorText("create", "RATE_LIMIT")).toMatch(/5 open stalls/);
    expect(stallErrorText("cancel", "NOT_IN_CITY")).toMatch(/stall's city/);
    expect(stallErrorText("buy", "IN_TRANSIT")).toBe(ERROR_TEXT.IN_TRANSIT);
    expect(stallErrorText("buy", "INSUFFICIENT_FUNDS")).toBe(ERROR_TEXT.INSUFFICIENT_FUNDS);
  });
});

describe("the mock world's fixture stall", () => {
  it("is one salt stall in shahr, priced 17.00", () => {
    expect(worldFixture.stalls).toHaveLength(1);
    const s = worldFixture.stalls[0]!;
    expect([s.city, s.good, s.qty, s.unit_price]).toEqual(["shahr", "salt", 12, "1700"]);
    expect(stallsForSale(worldFixture.stalls, "shahr", "mock.player")).toHaveLength(1);
    expect(stallsForSale(worldFixture.stalls, "bandar", "mock.player")).toHaveLength(0);
  });
});
