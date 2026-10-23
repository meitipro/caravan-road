// ASSUMPTION(A1): spec/API.md references `Event` and `Decision` but never defines them
// (spec/OPEN_QUESTIONS.md #1). Minimal shapes so the rest of the API type-checks;
// replace when the owner supplies the real ones.

import type { CityId, Merchant } from "./types.js";

export const EVENT_TYPES = [
  "trade", "policy", "journey_started", "journey_claimed",
  "stall_create", "stall_buy", "stall_cancel",
  "tick", "ship", "deposit", "withdraw_requested", "withdraw_marked", "faucet",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface Event {
  id: number;
  type: EventType;
  at: number; // unix seconds
  data: Record<string, unknown>;
}

export interface Decision {
  id: number;
  merchant: CityId;
  at: number; // unix seconds
  policy: { spread_bp: number; bias_bp: number };
  mood: Merchant["mood"];
  line: { en: string; fa: string } | null;
  verified: Merchant["verified"];
}

// ASSUMPTION(A18): /api/proof/{merchant} has no defined shape; the latest verification record.
export type Proof = Merchant["verified"];
