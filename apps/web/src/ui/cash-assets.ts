// Assets offered on the Cash screen (LIVE mode) and address checks.
// ASSUMPTION: the spec has no "list assets" endpoint (spec/API.md 2.13), only `origin_asset` and
// `dest_asset` strings. Until the server phase defines the real identifiers, this is a static list.
// Recorded in apps/web/src/ui/SHARED_ISSUES.md.

export type AddressKind = "near" | "evm" | "solana" | "bitcoin";

export interface CashAsset {
  id: string;
  label: string;
  symbol: string;
  decimals: number;
  kind: AddressKind;
}

export const CASH_ASSETS: readonly CashAsset[] = [
  { id: "usdc-near", label: "USDC on NEAR", symbol: "USDC", decimals: 6, kind: "near" },
  { id: "usdc-base", label: "USDC on Base", symbol: "USDC", decimals: 6, kind: "evm" },
  { id: "usdc-eth", label: "USDC on Ethereum", symbol: "USDC", decimals: 6, kind: "evm" },
  { id: "usdc-sol", label: "USDC on Solana", symbol: "USDC", decimals: 6, kind: "solana" },
  { id: "near", label: "NEAR", symbol: "NEAR", decimals: 24, kind: "near" },
  { id: "eth", label: "ETH on Ethereum", symbol: "ETH", decimals: 18, kind: "evm" },
  { id: "btc", label: "Bitcoin", symbol: "BTC", decimals: 8, kind: "bitcoin" },
];

const CHECKS: Record<AddressKind, RegExp> = {
  near: /^(?:[a-z0-9]+(?:[-_.][a-z0-9]+)*|[0-9a-f]{64})$/,
  evm: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  bitcoin: /^(?:bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
};

export function addressHint(kind: AddressKind): string {
  switch (kind) {
    case "near": return "A NEAR account such as name.near";
    case "evm": return "An address starting with 0x (42 characters)";
    case "solana": return "A Solana address (32 to 44 characters)";
    case "bitcoin": return "A Bitcoin address (starts with bc1, 1 or 3)";
  }
}

export function isValidAddress(kind: AddressKind, value: string): boolean {
  const v = value.trim();
  if (kind === "near" && (v.length < 2 || v.length > 64)) return false;
  return CHECKS[kind].test(v);
}

export function assetById(id: string): CashAsset | undefined {
  return CASH_ASSETS.find((a) => a.id === id);
}

/** Deposit/withdraw status words (case-insensitive) mapped to the three-step UI. */
export type CashStatus = "waiting" | "processing" | "credited" | "expired" | "refunded" | "failed" | "unknown";

export function mapCashStatus(raw: string): CashStatus {
  const s = raw.toLowerCase();
  if (["waiting", "pending", "pending_deposit", "created"].includes(s)) return "waiting";
  if (["processing", "known_deposit_tx", "incomplete_deposit", "pending_credit", "submitted"].includes(s)) return "processing";
  if (["credited", "success", "done", "completed", "sent"].includes(s)) return "credited";
  if (s === "expired") return "expired";
  if (s === "refunded") return "refunded";
  if (["failed", "rejected", "error"].includes(s)) return "failed";
  return "unknown";
}
