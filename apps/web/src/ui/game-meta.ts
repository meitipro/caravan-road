// Display metadata for the fixed world (names, colors, portraits). Rules and numbers live in @caravan/shared.

import { CITY_NAMES, type CityId, type ErrorCode, type GoodId, type Mood } from "@caravan/shared";

export interface CityMeta {
  id: CityId;
  name: string;
  role: string;
  merchant: string;
  /** file name (without extension) under public/assets/merchants */
  portrait: string;
}

// City display names come from CITY_NAMES in @caravan/shared (the single map; ids are internal keys). The portrait
// file names are internal too and kept; each portrait belongs to the merchant of that city.
export const CITY_META: Record<CityId, CityMeta> = {
  dasht: { id: "dasht", name: CITY_NAMES.dasht, role: "Farmland", merchant: "Hazel", portrait: "golnar" },
  madan: { id: "madan", name: CITY_NAMES.madan, role: "Mountain mine", merchant: "Bram", portrait: "rostam" },
  bandar: { id: "bandar", name: CITY_NAMES.bandar, role: "Port town", merchant: "Mara", portrait: "nahid" },
  shahr: { id: "shahr", name: CITY_NAMES.shahr, role: "Capital city", merchant: "Victor", portrait: "sohrab" },
};

export interface GoodMeta {
  id: GoodId;
  name: string;
  /** CSS variable used for flat placeholder art and stock bars */
  color: string;
}

export const GOOD_META: Record<GoodId, GoodMeta> = {
  grain: { id: "grain", name: "Grain", color: "var(--leaf)" },
  salt: { id: "salt", name: "Salt", color: "var(--cloth)" },
  iron: { id: "iron", name: "Iron", color: "var(--stone)" },
  spice: { id: "spice", name: "Spice", color: "var(--terracotta)" },
  silk: { id: "silk", name: "Silk", color: "var(--sky)" },
};

export const MOOD_META: Record<Mood, { label: string; hint: string }> = {
  calm: { label: "Calm", hint: "Prices are steady." },
  greedy: { label: "Greedy", hint: "Wider spread: expect to pay more and get less." },
  worried: { label: "Worried", hint: "Short on something and cautious." },
  generous: { label: "Generous", hint: "Tighter spread: fair deals today." },
};

export const GAME_MODE_TEXT = {
  PLAY: "Practice with free coins",
  LIVE: "Real USDC, real stakes",
} as const;

/**
 * Badge label and tooltip text for the game mode. In the browser-only demo (NEXT_PUBLIC_MOCK=1) the world is
 * simulated, so the badge says DEMO instead of claiming a PLAY or LIVE server game.
 */
export function modeBadge(mode: keyof typeof GAME_MODE_TEXT, mock: boolean): { label: string; text: string } {
  if (mock) return { label: "DEMO", text: "Simulated world in your browser, no real money. Reloading the page resets it." };
  return { label: mode, text: GAME_MODE_TEXT[mode] };
}

/** Friendly message per ErrorCode (spec section 2.12). The server message is only a fallback. */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please log in to continue.",
  BAD_REQUEST: "That did not look right. Check the numbers and try again.",
  RATE_LIMIT: "Too fast. Wait a moment and try again.",
  MODE_NOT_ALLOWED: "That is not available in this mode.",
  NOT_IN_CITY: "You are not in that city. Travel there first.",
  IN_TRANSIT: "Your caravan is on the road. Wait for it to arrive and claim it.",
  NOT_ARRIVED: "The caravan has not arrived yet.",
  INSUFFICIENT_FUNDS: "Not enough coins for that.",
  INSUFFICIENT_STOCK: "Not enough goods for that.",
  MERCHANT_BROKE: "This merchant cannot afford it right now. Try another city or a smaller amount.",
  SLIPPAGE: "The price moved while you were deciding. Review the new price and confirm again.",
  CARGO_LIMIT: "Your caravan is full (40 units at most).",
  PAUSED: "The game is paused for a moment. Please try again soon.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};
