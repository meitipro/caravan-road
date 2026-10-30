// Display metadata for the fixed world (names, colors, portraits). Rules and numbers live in @caravan/shared.

import type { CityId, ErrorCode, GoodId, Mood } from "@caravan/shared";

export interface CityMeta {
  id: CityId;
  name: string;
  role: string;
  merchant: string;
  /** file name (without extension) under public/assets/merchants */
  portrait: string;
}

// ASSUMPTION: the spec lists the portraits (golnar, rostam, nahid, sohrab) but not which city each
// merchant belongs to; assigned in the order dasht, madan, bandar, shahr. Change here if art differs.
export const CITY_META: Record<CityId, CityMeta> = {
  dasht: { id: "dasht", name: "Dasht", role: "Farmland", merchant: "Golnar", portrait: "golnar" },
  madan: { id: "madan", name: "Madan", role: "Mountain mine", merchant: "Rostam", portrait: "rostam" },
  bandar: { id: "bandar", name: "Bandar", role: "Harbour", merchant: "Nahid", portrait: "nahid" },
  shahr: { id: "shahr", name: "Shahr", role: "Capital", merchant: "Sohrab", portrait: "sohrab" },
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

export const MOOD_META: Record<Mood, { label: string; fa: string; hint: string }> = {
  calm: { label: "Calm", fa: "آرام", hint: "Prices are steady." },
  greedy: { label: "Greedy", fa: "حریص", hint: "Wider spread: expect to pay more and get less." },
  worried: { label: "Worried", fa: "نگران", hint: "Short on something and cautious." },
  generous: { label: "Generous", fa: "بخشنده", hint: "Tighter spread: fair deals today." },
};

export const GAME_MODE_TEXT = {
  PLAY: "Practice with free dinars",
  LIVE: "Real USDC, real stakes",
} as const;

/** Friendly message per ErrorCode (spec section 2.12). The server message is only a fallback. */
export const ERROR_TEXT: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please log in to continue.",
  BAD_REQUEST: "That did not look right. Check the numbers and try again.",
  RATE_LIMIT: "Too fast. Wait a moment and try again.",
  MODE_NOT_ALLOWED: "That is not available in this mode.",
  NOT_IN_CITY: "You are not in that city. Travel there first.",
  IN_TRANSIT: "Your caravan is on the road. Wait for it to arrive and claim it.",
  NOT_ARRIVED: "The caravan has not arrived yet.",
  INSUFFICIENT_FUNDS: "Not enough dinars for that.",
  INSUFFICIENT_STOCK: "Not enough goods for that.",
  MERCHANT_BROKE: "This merchant cannot afford it right now. Try another city or a smaller amount.",
  SLIPPAGE: "The price moved while you were deciding. Review the new price and confirm again.",
  CARGO_LIMIT: "Your caravan is full (40 units at most).",
  PAUSED: "The game is paused for a moment. Please try again soon.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};
