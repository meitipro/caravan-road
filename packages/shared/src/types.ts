// Data contracts. Mirrors spec/API.md section 2.12 exactly.
// Money is always a decimal string at the API boundary; times are unix seconds.

export type CityId = "dasht" | "madan" | "bandar" | "shahr";
export type GoodId = "grain" | "salt" | "iron" | "spice" | "silk";
export type Fils = string; // u128 as decimal string
export type Mode = "PLAY" | "LIVE";

export interface Quote { bid: Fils; mid: Fils; ask: Fils }
export interface Merchant {
  id: CityId; account_id: string; treasury: Fils;
  stock: Record<GoodId, number>;
  policy: { spread_bp: number; bias_bp: number };
  quotes: Record<GoodId, Quote>;
  mood: "calm" | "greedy" | "worried" | "generous";
  last_line: string | null;
  verified: { model: string; request_id: string; attested: boolean; at: number } | null;
}
export interface Journey {
  id: number; from: CityId; to: CityId; cargo: Partial<Record<GoodId, number>>;
  guards: number; started_at: number; arrives_at: number; risk_bp: number;
  status: "IN_TRANSIT" | "ARRIVED" | "CLAIMED"; ambushed?: boolean;
  lost?: Partial<Record<GoodId, number>>;
}
export interface Player {
  account_id: string; display_name: string; fils: Fils; location: CityId;
  inventory: Record<GoodId, number>; journey: Journey | null; net_worth: Fils;
}
export interface Stall { id: number; seller: string; city: CityId; good: GoodId; qty: number; unit_price: Fils }
export interface WorldState { tick: number; now: number; mode: Mode; merchants: Merchant[]; stalls: Stall[] }

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "BAD_REQUEST"
  | "RATE_LIMIT"
  | "MODE_NOT_ALLOWED"
  | "NOT_IN_CITY"
  | "IN_TRANSIT"
  | "NOT_ARRIVED"
  | "INSUFFICIENT_FUNDS"
  | "INSUFFICIENT_STOCK"
  | "MERCHANT_BROKE"
  | "SLIPPAGE"
  | "CARGO_LIMIT"
  | "PAUSED"
  | "INTERNAL";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

// Added in Phase 5 (append only), spec/API.md section 2.12:
export type Mood = "calm" | "greedy" | "worried" | "generous";
export interface Decision {
  merchant: CityId; ts: number; spread_bp: number; bias_bp: number; mood: Mood;
  ship: { to: CityId; good: GoodId; qty: number } | null;
  line: string;                           // <= 120 chars, English
  reason: string;                         // <= 240 chars, English
  source: "llm" | "baseline" | "keep";
  model: string | null; request_id: string | null; attested: boolean; tx_hashes: string[];
}
