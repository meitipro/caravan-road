import { describe, expect, it } from "vitest";
import { MOCK_TOKENS, type TokenInfo } from "@caravan/shared";
import {
  addressHint, assetById, assetsFromTokens, cashStatusText, defaultAssetId, isFinalCashStatus, isValidAddress, mapCashStatus,
  type CashStatus,
} from "./cash-assets";

const real: TokenInfo[] = [
  { id: "nep141:eth.omft.near", symbol: "ETH", chain: "eth", decimals: 18 },
  { id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", chain: "near", decimals: 6 },
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", chain: "base", decimals: 6 },
  { id: "nep141:zzz.omft.near", symbol: "ZZZ", chain: "newchain", decimals: 9 },
];

describe("assetsFromTokens", () => {
  it("keeps the real id and shows symbol + chain", () => {
    const a = assetsFromTokens(real);
    expect(a.map((x) => x.id)).toEqual(real.map((t) => t.id));
    expect(a[1]).toMatchObject({ label: "USDC on NEAR", symbol: "USDC", chain: "near", decimals: 6, kind: "near" });
    expect(a[2]).toMatchObject({ label: "USDC on Base", kind: "evm" });
    expect(a[3]).toMatchObject({ label: "ZZZ on Newchain", kind: "other" });
  });
  it("drops unusable entries and duplicates", () => {
    const bad = [
      ...real,
      { id: "", symbol: "X", chain: "near", decimals: 6 },
      { id: "dup", symbol: "X", chain: "near", decimals: 6 },
      { id: "dup", symbol: "X", chain: "near", decimals: 6 },
      { id: "nodec", symbol: "X", chain: "near", decimals: 1.5 },
    ] as TokenInfo[];
    expect(assetsFromTokens(bad).map((x) => x.id)).toEqual([...real.map((t) => t.id), "dup"]);
    expect(assetsFromTokens(null)).toEqual([]);
  });
  it("prefers USDC on NEAR, then any USDC, then the first", () => {
    expect(defaultAssetId(assetsFromTokens(real))).toBe(real[1]!.id);
    expect(defaultAssetId(assetsFromTokens([real[0]!, real[2]!]))).toBe(real[2]!.id);
    expect(defaultAssetId(assetsFromTokens([real[0]!]))).toBe(real[0]!.id);
    expect(defaultAssetId([])).toBe("");
  });
  it("works on the mock sample list and assetById finds by real id", () => {
    const a = assetsFromTokens(MOCK_TOKENS);
    expect(a.length).toBe(MOCK_TOKENS.length);
    expect(assetById(a, "usdc-near")?.label).toBe("USDC on NEAR");
    expect(assetById(a, "near")?.label).toBe("NEAR");
    expect(assetById(a, "nope")).toBeUndefined();
  });
});

describe("addresses", () => {
  it("checks per kind; unknown chains only need a sane string", () => {
    expect(isValidAddress("evm", "0x" + "a".repeat(40))).toBe(true);
    expect(isValidAddress("evm", "0x12")).toBe(false);
    expect(isValidAddress("near", "alice.near")).toBe(true);
    expect(isValidAddress("other", "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh")).toBe(true);
    expect(isValidAddress("other", "abc")).toBe(false);
    expect(isValidAddress("other", "has space inside")).toBe(false);
    expect(addressHint("other").length).toBeGreaterThan(10);
  });
});

describe("mapCashStatus covers every status the server stores", () => {
  const deposits: Record<string, CashStatus> = {
    PENDING: "waiting", CREDITING: "processing", CREDITED: "credited", EXPIRED: "expired", FAILED: "failed",
  };
  const withdrawals: Record<string, CashStatus> = {
    RESERVED: "processing", REQUESTED: "processing", SENDING: "processing", SENT: "processing", FINALIZING: "processing",
    DONE: "credited", REFUNDED: "refunded", FAILED: "failed", CANCELLED: "cancelled",
  };
  for (const [raw, want] of Object.entries({ ...deposits, ...withdrawals })) {
    it(`${raw} -> ${want}`, () => expect(mapCashStatus(raw)).toBe(want));
  }
  it("SENT is not complete (a refund is still possible)", () => {
    expect(isFinalCashStatus(mapCashStatus("SENT"))).toBe(false);
  });
  it("unknown words stay unknown and are not final", () => {
    expect(mapCashStatus("weird")).toBe("unknown");
    expect(isFinalCashStatus("unknown")).toBe(false);
  });
});

describe("cashStatusText is honest", () => {
  it("a FAILED deposit does not say nothing happened to the money", () => {
    const t = cashStatusText("deposit", "failed");
    expect(t.title).not.toMatch(/Nothing was credited/);
    expect(t.detail).toMatch(/No dinars were added/);
    expect(t.detail).toMatch(/refund|returned/i);
    expect(t.detail).toMatch(/not lost/);
  });
  it("has text for every final state of both kinds", () => {
    for (const kind of ["deposit", "withdraw"] as const) {
      for (const s of ["credited", "expired", "refunded", "cancelled", "failed", "unknown"] as const) {
        const t = cashStatusText(kind, s);
        expect(t.title.length, `${kind}/${s}`).toBeGreaterThan(0);
      }
    }
  });
  it("a refunded withdrawal says the dinars came back", () => {
    expect(cashStatusText("withdraw", "refunded").detail).toMatch(/returned/);
  });
});
