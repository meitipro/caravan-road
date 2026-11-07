// Free-coin (faucet) rules as the contract enforces them (contracts/caravan/src/game.rs try_faucet), so the UI only offers
// Claim to a player who can actually get it. The mock keeps its own simpler rule (60 s wait, no wealth limit).

import { GOODS, GOOD_IDS, netWorthFils, type GoodId, type Player, type Stall } from "@caravan/shared";
import { ERROR_TEXT } from "./game-meta";

/** Real contract: faucet_cooldown_seconds. */
export const FAUCET_COOLDOWN_REAL_SEC = 3600;
/** Mock world (packages/shared MOCK_FAUCET_COOLDOWN_SECONDS). */
export const FAUCET_COOLDOWN_MOCK_SEC = 60;
/** Real contract: faucet_max_balance_fils. The faucet is refused when faucet_worth is at least this. */
export const FAUCET_MAX_WORTH_FILS = 5000n;

export const faucetCooldownSec = (mock: boolean): number => (mock ? FAUCET_COOLDOWN_MOCK_SEC : FAUCET_COOLDOWN_REAL_SEC);

type Goods = Partial<Record<GoodId, number>>;

function baseValue(goods: Goods | null | undefined): bigint {
  let t = 0n;
  for (const g of GOOD_IDS) {
    const q = goods?.[g];
    if (typeof q === "number" && q > 0) t += GOODS[g].baseFils * BigInt(Math.trunc(q));
  }
  return t;
}

/**
 * The contract's faucet_worth: coins + base value of the inventory + goods in the player's open stalls (escrow)
 * + the cargo of a journey that is still IN_TRANSIT (an ARRIVED, unclaimed journey is not counted by the contract).
 * `stalls` is the world's stall list; only the player's own are counted.
 */
export function faucetWorthFils(me: Pick<Player, "account_id" | "fils" | "inventory" | "journey">, stalls: readonly Stall[]): bigint {
  let w = netWorthFils(BigInt(me.fils), me.inventory);
  for (const s of stalls) if (s.seller === me.account_id && s.qty > 0) w += GOODS[s.good].baseFils * BigInt(s.qty);
  if (me.journey && me.journey.status === "IN_TRANSIT") w += baseValue(me.journey.cargo);
  return w;
}

export function faucetEligible(worth: bigint): boolean {
  return worth < FAUCET_MAX_WORTH_FILS;
}

/** "about an hour", "about 25 minutes", "42 seconds" for a wait in seconds. */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s <= 90) return `${s} second${s === 1 ? "" : "s"}`;
  const min = Math.ceil(s / 60);
  if (min >= 55) return "about an hour";
  return `about ${min} minutes`;
}

export const FAUCET_TOO_RICH_TEXT =
  "You still own too much to claim. Free coins are for players with less than 50 coins in total, goods and open stalls included.";

/** Honest message after a refused claim, or null to fall back to the standard error toast. */
export function faucetRefusalText(code: string, mock: boolean): string | null {
  if (code === "RATE_LIMIT") return `Available again in ${formatWait(faucetCooldownSec(mock))}.`;
  if (code === "BAD_REQUEST") return FAUCET_TOO_RICH_TEXT;
  if (code === "MODE_NOT_ALLOWED") return ERROR_TEXT.MODE_NOT_ALLOWED;
  return null;
}

/** Why the Claim button is off right now, or null when Claim is on. Owning too much beats the wait: the wait would not help. */
export function faucetBlockReason(args: { eligible: boolean; waitLeftSec: number }): string | null {
  if (!args.eligible) return FAUCET_TOO_RICH_TEXT;
  if (args.waitLeftSec > 0) return `Available again in ${formatWait(args.waitLeftSec)}.`;
  return null;
}
