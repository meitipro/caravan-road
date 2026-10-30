// ASSUMPTION(A1): spec/API.md references `Event` but never defines it (spec/OPEN_QUESTIONS.md #1). Minimal shapes so the rest of the API type-checks;
// replace when the owner supplies the real ones.

import type { Merchant } from "./types.js";

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

// ASSUMPTION(A18): /api/proof/{merchant} has no defined shape; the latest verification record.
export type Proof = Merchant["verified"];
