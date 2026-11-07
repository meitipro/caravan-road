// zod schemas for every request body in spec/API.md section 2.13, plus the entity schemas
// that fixtures and API responses are validated against.

import { z } from "zod";
import { EVENT_TYPES } from "./provisional.js";
import { CITY_IDS, GOOD_IDS, PARAMS } from "./world.js";

export const CityIdSchema = z.enum(CITY_IDS);
export const GoodIdSchema = z.enum(GOOD_IDS);
export const ModeSchema = z.enum(["PLAY", "LIVE"]);

/** Money at the API boundary: non-negative decimal integer string (never a number). */
export const FilsSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, "fils must be a decimal integer string");

const Count = z.number().int().nonnegative();
const goodsRecord = <T extends z.ZodTypeAny>(v: T) =>
  z.object(Object.fromEntries(GOOD_IDS.map((g) => [g, v])) as Record<(typeof GOOD_IDS)[number], T>).strict();
const partialGoods = z.object(Object.fromEntries(GOOD_IDS.map((g) => [g, Count.optional()]))).strict();

export const QuoteSchema = z.object({ bid: FilsSchema, mid: FilsSchema, ask: FilsSchema }).strict();

export const MerchantSchema = z.object({
  id: CityIdSchema,
  account_id: z.string().min(1),
  treasury: FilsSchema,
  stock: goodsRecord(Count),
  policy: z.object({ spread_bp: z.number().int(), bias_bp: z.number().int() }).strict(),
  quotes: goodsRecord(QuoteSchema),
  mood: z.enum(["calm", "greedy", "worried", "generous"]),
  last_line: z.string().nullable(),
  verified: z
    .object({ model: z.string(), request_id: z.string(), attested: z.boolean(), at: z.number().int() })
    .strict()
    .nullable(),
}).strict();

export const JourneySchema = z.object({
  id: z.number().int().nonnegative(),
  from: CityIdSchema,
  to: CityIdSchema,
  cargo: partialGoods,
  guards: z.number().int().min(0).max(PARAMS.MAX_GUARDS),
  started_at: z.number().int(),
  arrives_at: z.number().int(),
  risk_bp: z.number().int().nonnegative(),
  status: z.enum(["IN_TRANSIT", "ARRIVED", "CLAIMED"]),
  ambushed: z.boolean().optional(),
  lost: partialGoods.optional(),
}).strict();

export const PlayerSchema = z.object({
  account_id: z.string().min(1),
  display_name: z.string(),
  fils: FilsSchema,
  location: CityIdSchema,
  inventory: goodsRecord(Count),
  journey: JourneySchema.nullable(),
  net_worth: FilsSchema,
}).strict();

export const StallSchema = z.object({
  id: z.number().int().nonnegative(),
  seller: z.string().min(1),
  city: CityIdSchema,
  good: GoodIdSchema,
  qty: z.number().int().positive(),
  unit_price: FilsSchema,
}).strict();

export const WorldStateSchema = z.object({
  tick: z.number().int().nonnegative(),
  now: z.number().int(),
  mode: ModeSchema,
  merchants: z.array(MerchantSchema).length(4),
  stalls: z.array(StallSchema),
}).strict();

// OPEN_QUESTIONS #1: the Event shape is provisional (see provisional.ts); Decision is spec-v1.
export const EventSchema = z.object({
  id: z.number().int().nonnegative(),
  type: z.enum(EVENT_TYPES),
  at: z.number().int(),
  data: z.record(z.unknown()),
}).strict();

export const DecisionSchema = z.object({
  merchant: CityIdSchema,
  ts: z.number().int(),
  spread_bp: z.number().int().min(PARAMS.SPREAD_MIN_BP).max(PARAMS.SPREAD_MAX_BP),
  bias_bp: z.number().int().min(PARAMS.BIAS_MIN_BP).max(PARAMS.BIAS_MAX_BP),
  mood: MerchantSchema.shape.mood,
  ship: z.object({ to: CityIdSchema, good: GoodIdSchema, qty: z.number().int().positive() }).strict().nullable(),
  line: z.string().max(120),
  reason: z.string().max(240),
  source: z.enum(["llm", "baseline", "keep"]),
  model: z.string().nullable(),
  request_id: z.string().nullable(),
  attested: z.boolean(),
  tx_hashes: z.array(z.string()),
}).strict();

export const LeaderboardRowSchema = z.object({ name: z.string(), net_worth: FilsSchema }).strict();

export const StateResponseSchema = z.object({
  world: WorldStateSchema,
  me: PlayerSchema.nullable(),
  events: z.array(EventSchema),
}).strict();

// ---- request bodies (spec/API.md section 2.13) ----

const Qty = z.number().int().positive();

export const TradeRequestSchema = z.object({
  merchant: CityIdSchema,
  good: GoodIdSchema,
  side: z.enum(["buy", "sell"]),
  qty: Qty.max(PARAMS.MAX_QTY_PER_TRADE),
  limit_total: FilsSchema,
}).strict();

export const JourneyStartRequestSchema = z.object({
  to: CityIdSchema,
  cargo: partialGoods,
  guards: z.number().int().min(0).max(PARAMS.MAX_GUARDS),
}).strict();

export const StallCreateRequestSchema = z.object({
  good: GoodIdSchema,
  qty: Qty,
  unit_price: FilsSchema,
}).strict();

export const StallBuyRequestSchema = z.object({
  stall_id: z.number().int().nonnegative(),
  qty: Qty,
  limit_total: FilsSchema,
}).strict();

export const StallCancelRequestSchema = z.object({
  stall_id: z.number().int().nonnegative(),
}).strict();

export const DepositQuoteRequestSchema = z.object({
  origin_asset: z.string().min(1),
  amount_in: z.string().regex(/^[1-9][0-9]*$/, "amount_in must be a positive decimal integer string"),
  refund_address: z.string().min(1),
}).strict();

export const DepositStatusQuerySchema = z.object({ quote_id: z.string().min(1) }).strict();

export const WithdrawRequestSchema = z.object({
  fils: FilsSchema,
  dest_asset: z.string().min(1),
  dest_address: z.string().min(1),
}).strict();

export const NpcDecisionsQuerySchema = z.object({ merchant: CityIdSchema.optional() }).strict();

export const requestSchemas = {
  trade: TradeRequestSchema,
  journeyStart: JourneyStartRequestSchema,
  stallCreate: StallCreateRequestSchema,
  stallBuy: StallBuyRequestSchema,
  stallCancel: StallCancelRequestSchema,
  depositQuote: DepositQuoteRequestSchema,
  depositStatus: DepositStatusQuerySchema,
  withdraw: WithdrawRequestSchema,
  npcDecisions: NpcDecisionsQuerySchema,
} as const;

export type TradeRequest = z.infer<typeof TradeRequestSchema>;
export type JourneyStartRequest = z.infer<typeof JourneyStartRequestSchema>;
export type StallCreateRequest = z.infer<typeof StallCreateRequestSchema>;
export type StallBuyRequest = z.infer<typeof StallBuyRequestSchema>;
export type StallCancelRequest = z.infer<typeof StallCancelRequestSchema>;
export type DepositQuoteRequest = z.infer<typeof DepositQuoteRequestSchema>;
export type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;
