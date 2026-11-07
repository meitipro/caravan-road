// Formatting helpers. Money is a decimal string (or bigint) of fils and is never converted to Number.

const FILS_PER_COIN = 100n;

function toBig(v: string | bigint): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(v)) {
    throw new TypeError("money must be a bigint or a decimal integer string of fils");
  }
  return BigInt(v);
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 12345 fils -> "123.45". Always two decimals, thousands separated. Accepts bigint or integer strings only. */
export function formatCoins(fils: string | bigint): string {
  const n = toBig(fils);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / FILS_PER_COIN;
  const frac = (abs % FILS_PER_COIN).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${group(whole.toString())}.${frac}`;
}

/** Like formatCoins but with an explicit sign: "+1.20", "-0.50", "0.00". */
export function formatCoinsDelta(fils: string | bigint): string {
  const n = toBig(fils);
  const s = formatCoins(n);
  return n > 0n ? `+${s}` : s;
}

/** Parse a user-typed coin amount ("12", "12.5", "12.50") to fils, string based. Returns null if invalid. */
export function parseCoins(input: string): bigint | null {
  const m = /^\s*(\d{1,12})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return whole * FILS_PER_COIN + frac;
}

/** Remaining seconds -> "m:ss" (or "h:mm:ss"). Negative or NaN clamps to "0:00". */
export function formatEta(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = sec.toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Basis points -> "5.2%" (trailing zero trimmed). bp is a small integer, not money. */
export function formatBp(bp: number): string {
  const neg = bp < 0;
  const abs = Math.abs(Math.round(bp));
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const f = frac === 0 ? "" : `.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
  return `${neg ? "-" : ""}${whole}${f}%`;
}

/** Truncated integer share of a bigint: v * bp / 10000. */
export function bpOf(v: bigint, bp: number | bigint): bigint {
  return (v * BigInt(bp)) / 10000n;
}

/** Shorten an id for display: "abcdef123456" -> "abcd…3456". */
export function shortId(id: string, head = 6, tail = 4): string {
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** "5s ago", "3m ago", "2h ago". */
export function formatAgo(nowSec: number, thenSec: number): string {
  const d = Math.max(0, Math.floor(nowSec - thenSec));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Parse a decimal string ("12.5") into integer base units for an asset with `decimals`. Null if invalid or too precise. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const m = /^\s*(\d{1,30})(?:\.(\d+))?\s*$/.exec(input);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1]! + frac.padEnd(decimals, "0"));
}

/** Integer base units to a decimal string without trailing zeros: (1500000n, 6) -> "1.5". */
export function formatUnits(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
