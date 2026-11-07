// Assets offered on the Cash screen (LIVE mode), address checks and deposit/withdraw status words.
// The list itself is NOT defined here: it comes from GET /api/tokens (the assets 1Click supports), so the
// ids we send as `origin_asset` / `dest_asset` are the real ones. In the mock the shared client returns a
// static sample list (MOCK_TOKENS) with made-up ids, which only the browser demo uses.

import type { TokenInfo } from "@caravan/shared";

export type AddressKind = "near" | "evm" | "solana" | "bitcoin" | "other";

export interface CashAsset {
  /** What the API takes as `origin_asset` / `dest_asset`. */
  id: string;
  /** "USDC on NEAR" */
  label: string;
  symbol: string;
  /** Chain as the provider names it ("near", "eth", "base"...). */
  chain: string;
  chainLabel: string;
  decimals: number;
  kind: AddressKind;
}

// 1Click names chains with short ids; the enum grows over time, so unknown chains fall back to "other".
const CHAIN_INFO: Record<string, { label: string; kind: AddressKind }> = {
  near: { label: "NEAR", kind: "near" },
  eth: { label: "Ethereum", kind: "evm" },
  base: { label: "Base", kind: "evm" },
  arb: { label: "Arbitrum", kind: "evm" },
  op: { label: "Optimism", kind: "evm" },
  pol: { label: "Polygon", kind: "evm" },
  bsc: { label: "BNB Chain", kind: "evm" },
  avax: { label: "Avalanche", kind: "evm" },
  gnosis: { label: "Gnosis", kind: "evm" },
  bera: { label: "Berachain", kind: "evm" },
  sol: { label: "Solana", kind: "solana" },
  btc: { label: "Bitcoin", kind: "bitcoin" },
};

export function chainLabel(chain: string): string {
  return CHAIN_INFO[chain]?.label ?? (chain.length <= 5 ? chain.toUpperCase() : chain.charAt(0).toUpperCase() + chain.slice(1));
}

export function toCashAsset(t: TokenInfo): CashAsset {
  const label = chainLabel(t.chain);
  return {
    id: t.id,
    label: t.symbol.toLowerCase() === label.toLowerCase() ? t.symbol : `${t.symbol} on ${label}`,
    symbol: t.symbol,
    chain: t.chain,
    chainLabel: label,
    decimals: t.decimals,
    kind: CHAIN_INFO[t.chain]?.kind ?? "other",
  };
}

/** Server answers are data, not trusted structure: keep only entries we can actually use. */
export function assetsFromTokens(tokens: readonly TokenInfo[] | null | undefined): CashAsset[] {
  const seen = new Set<string>();
  const out: CashAsset[] = [];
  for (const t of tokens ?? []) {
    if (!t || typeof t.id !== "string" || t.id === "" || seen.has(t.id)) continue;
    if (typeof t.symbol !== "string" || t.symbol === "" || typeof t.chain !== "string" || t.chain === "") continue;
    if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) continue;
    seen.add(t.id);
    out.push(toCashAsset(t));
  }
  return out;
}

/** USDC on NEAR if offered (the cheapest path), otherwise any USDC, otherwise the first asset. */
export function defaultAssetId(assets: readonly CashAsset[]): string {
  return (
    assets.find((a) => a.symbol.toUpperCase() === "USDC" && a.kind === "near")?.id
    ?? assets.find((a) => a.symbol.toUpperCase() === "USDC")?.id
    ?? assets[0]?.id
    ?? ""
  );
}

export function assetById(assets: readonly CashAsset[], id: string): CashAsset | undefined {
  return assets.find((a) => a.id === id);
}

const CHECKS: Record<Exclude<AddressKind, "other">, RegExp> = {
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
    case "other": return "The address for that network, exactly as the receiving app shows it";
  }
}

export function isValidAddress(kind: AddressKind, value: string): boolean {
  const v = value.trim();
  if (kind === "other") return v.length >= 6 && v.length <= 128 && !/\s/.test(v);
  if (kind === "near" && (v.length < 2 || v.length > 64)) return false;
  return CHECKS[kind].test(v);
}

/**
 * Deposit/withdraw status words (case-insensitive) mapped to the UI's states. Every status the server stores:
 *  - deposits (db DepositStatus): PENDING, CREDITING, CREDITED, EXPIRED, FAILED
 *  - withdrawals (db WithdrawalStatus; POST /api/withdraw answers REQUESTED): RESERVED, REQUESTED, SENDING, SENT,
 *    FINALIZING, DONE, REFUNDED, FAILED, CANCELLED
 * SENT is NOT final: the provider has the money but the contract keeps a refund possible until it reports the outcome.
 */
export type CashStatus = "waiting" | "processing" | "credited" | "expired" | "refunded" | "cancelled" | "failed" | "unknown";

export function mapCashStatus(raw: string): CashStatus {
  const s = raw.trim().toLowerCase();
  if (["waiting", "pending", "pending_deposit", "created"].includes(s)) return "waiting";
  if (["processing", "known_deposit_tx", "incomplete_deposit", "pending_credit", "submitted",
    "crediting", "reserved", "requested", "sending", "sent", "finalizing"].includes(s)) return "processing";
  if (["credited", "success", "done", "completed"].includes(s)) return "credited";
  if (s === "expired") return "expired";
  if (s === "refunded") return "refunded";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (["failed", "rejected", "error"].includes(s)) return "failed";
  return "unknown";
}

export type CashKind = "deposit" | "withdraw";

/** A status after which nothing more will change on its own. */
export function isFinalCashStatus(s: CashStatus): boolean {
  return s === "credited" || s === "expired" || s === "refunded" || s === "cancelled" || s === "failed";
}

/**
 * Honest one-line explanation per final or unknown status. A FAILED deposit is also how a provider refund is stored
 * (cron: provider state REFUNDED/FAILED -> FAILED) and how a deposit that could not be credited waits for a manual
 * refund, so it must not claim the money is gone or that nothing happened to it.
 */
export function cashStatusText(kind: CashKind, s: CashStatus): { title: string; detail: string } {
  if (kind === "deposit") {
    switch (s) {
      case "credited": return { title: "Credited", detail: "Your coins are in." };
      case "expired": return { title: "This quote expired.", detail: "If you already sent money, it will be refunded to your refund address." };
      case "refunded": return { title: "Refunded.", detail: "Your money went back to your refund address." };
      case "failed":
        return {
          title: "This deposit could not be completed.",
          detail: "No coins were added. If you sent money, it is being returned: the payment service refunds it to your refund address, or we return it by hand if we could not credit it. It is not lost.",
        };
      case "cancelled": return { title: "This deposit was cancelled.", detail: "No coins were added." };
      case "unknown": return { title: "Checking the status", detail: "We do not recognise this status yet. Nothing has changed on your balance; we keep checking." };
      default: return { title: "", detail: "" };
    }
  }
  switch (s) {
    case "credited": return { title: "Sent.", detail: "The withdrawal is complete." };
    case "refunded": return { title: "Refunded.", detail: "The withdrawal did not go through and your coins were returned." };
    case "cancelled": return { title: "Cancelled.", detail: "The withdrawal never started and no coins were taken." };
    case "failed":
      return {
        title: "The withdrawal needs a manual check.",
        detail: "Your coins are not lost: we review it and either send the money or return the coins.",
      };
    case "expired": return { title: "This withdrawal expired.", detail: "Check your balance. If coins were taken, they are returned." };
    case "unknown": return { title: "Checking the status", detail: "We do not recognise this status yet. Check your balance in a few minutes." };
    default: return { title: "", detail: "" };
  }
}
