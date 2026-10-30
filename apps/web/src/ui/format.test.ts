import { describe, expect, it } from "vitest";
import { bpOf, formatAgo, formatBp, formatDinar, formatDinarDelta, formatEta, formatUnits, parseDinar, parseUnits, shortId } from "./format";

describe("formatDinar", () => {
  it("always shows two decimals", () => {
    expect(formatDinar("0")).toBe("0.00");
    expect(formatDinar("5")).toBe("0.05");
    expect(formatDinar("50")).toBe("0.50");
    expect(formatDinar("100")).toBe("1.00");
    expect(formatDinar("1000")).toBe("10.00");
    expect(formatDinar("50000")).toBe("500.00");
    expect(formatDinar("12345")).toBe("123.45");
  });
  it("groups thousands", () => {
    expect(formatDinar("123456789")).toBe("1,234,567.89");
    expect(formatDinar("100000")).toBe("1,000.00");
  });
  it("accepts bigint and handles negatives", () => {
    expect(formatDinar(1296n)).toBe("12.96");
    expect(formatDinar("-250")).toBe("-2.50");
    expect(formatDinar(-5n)).toBe("-0.05");
  });
  it("does not lose precision above 2^53", () => {
    expect(formatDinar("9007199254740993")).toBe("90,071,992,547,409.93");
    expect(formatDinar("340282366920938463463374607431768211455")).toBe(
      "3,402,823,669,209,384,634,633,746,074,317,682,114.55",
    );
  });
  it("rejects numbers and non-integer strings", () => {
    // @ts-expect-error numbers are not allowed for money
    expect(() => formatDinar(100)).toThrow(TypeError);
    expect(() => formatDinar("1.5")).toThrow(TypeError);
    expect(() => formatDinar("")).toThrow(TypeError);
    expect(() => formatDinar("01")).toThrow(TypeError);
    expect(() => formatDinar("1e3")).toThrow(TypeError);
  });
});

describe("formatDinarDelta", () => {
  it("prefixes + for gains", () => {
    expect(formatDinarDelta("120")).toBe("+1.20");
    expect(formatDinarDelta("-50")).toBe("-0.50");
    expect(formatDinarDelta("0")).toBe("0.00");
  });
});

describe("parseDinar", () => {
  it("parses whole and fractional dinars to fils", () => {
    expect(parseDinar("12")).toBe(1200n);
    expect(parseDinar("12.5")).toBe(1250n);
    expect(parseDinar("12.05")).toBe(1205n);
    expect(parseDinar("0,5")).toBe(50n);
  });
  it("rejects junk", () => {
    expect(parseDinar("")).toBeNull();
    expect(parseDinar("abc")).toBeNull();
    expect(parseDinar("1.234")).toBeNull();
    expect(parseDinar("-1")).toBeNull();
  });
});

describe("formatEta", () => {
  it("formats m:ss", () => {
    expect(formatEta(0)).toBe("0:00");
    expect(formatEta(9)).toBe("0:09");
    expect(formatEta(180)).toBe("3:00");
    expect(formatEta(270)).toBe("4:30");
    expect(formatEta(360)).toBe("6:00");
    expect(formatEta(599)).toBe("9:59");
  });
  it("rounds partial seconds up so the clock never shows 0:00 early", () => {
    expect(formatEta(0.2)).toBe("0:01");
    expect(formatEta(59.01)).toBe("1:00");
  });
  it("uses h:mm:ss from one hour", () => {
    expect(formatEta(3600)).toBe("1:00:00");
    expect(formatEta(3725)).toBe("1:02:05");
  });
  it("clamps negatives and non-finite values", () => {
    expect(formatEta(-5)).toBe("0:00");
    expect(formatEta(Number.NaN)).toBe("0:00");
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("small helpers", () => {
  it("formatBp", () => {
    expect(formatBp(800)).toBe("8%");
    expect(formatBp(520)).toBe("5.2%");
    expect(formatBp(338)).toBe("3.38%");
    expect(formatBp(0)).toBe("0%");
  });
  it("bpOf truncates toward zero", () => {
    expect(bpOf(1999n, 100)).toBe(19n);
    expect(bpOf(-1999n, 100)).toBe(-19n);
    expect(bpOf(20000n, 6500)).toBe(13000n);
  });
  it("shortId", () => {
    expect(shortId("abcdef0123456789")).toBe("abcdef…6789");
    expect(shortId("short")).toBe("short");
  });
  it("formatAgo", () => {
    expect(formatAgo(100, 95)).toBe("5s ago");
    expect(formatAgo(1000, 700)).toBe("5m ago");
    expect(formatAgo(10000, 0)).toBe("2h ago");
  });
});

describe("units", () => {
  it("parseUnits converts decimals to base units", () => {
    expect(parseUnits("1.5", 6)).toBe(1500000n);
    expect(parseUnits("20", 6)).toBe(20000000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("1", 24)).toBe(10n ** 24n);
  });
  it("parseUnits rejects too much precision and junk", () => {
    expect(parseUnits("0.0000001", 6)).toBeNull();
    expect(parseUnits("", 6)).toBeNull();
    expect(parseUnits("-1", 6)).toBeNull();
    expect(parseUnits("1e3", 6)).toBeNull();
  });
  it("formatUnits is the inverse", () => {
    expect(formatUnits(1500000n, 6)).toBe("1.5");
    expect(formatUnits(1n, 6)).toBe("0.000001");
    expect(formatUnits(20000000n, 6)).toBe("20");
    expect(formatUnits(0n, 6)).toBe("0");
  });
});
