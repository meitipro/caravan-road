// The player actions of spec/API.md section 2.13 (except deposit/withdraw, see money.ts). Each one
// validates, relays the call through the player's meta-transaction, then reads the player back.

import {
  JourneyStartRequestSchema, StallBuyRequestSchema, StallCancelRequestSchema, StallCreateRequestSchema, TradeRequestSchema,
  type ClaimData, type JourneyData, type PlayerData, type StallData, type TradeData,
} from "@caravan/shared";
import type { ContractJourney, ContractStall, PlayerArgs, PlayerMethod } from "../contract/types";
import { ApiError } from "../errors";
import type { ActionCtx, PostSpec } from "../http";
import { toApiJourney, toApiPlayer, toApiStall } from "./views";
import type { z } from "zod";

async function readPlayer(ctx: ActionCtx<unknown>) {
  const p = await ctx.svc.contract.getPlayer(ctx.user.near_account_id!);
  if (!p) throw new ApiError("INTERNAL", "Something went wrong. Please try again.");
  return toApiPlayer(p, ctx.user.display_name, ctx.svc.now());
}

async function relay<M extends PlayerMethod>(ctx: ActionCtx<unknown>, method: M, args: PlayerArgs[M]) {
  const out = await ctx.svc.relayer.submit(ctx.user, method, args);
  ctx.noteTx(out);
  return out;
}

const invalidate = (svc: { worldCache: { invalidate(): void }; leaderboardCache: { invalidate(): void } }) => {
  svc.worldCache.invalidate();
  svc.leaderboardCache.invalidate();
};

type Body<S extends z.ZodTypeAny> = z.infer<S>;

export const tradeSpec: PostSpec<Body<typeof TradeRequestSchema>, TradeData> = {
  kind: "trade",
  schema: TradeRequestSchema,
  async run(ctx) {
    const out = await relay(ctx, "trade", {
      merchant: ctx.body.merchant, good: ctx.body.good, side: ctx.body.side, qty: ctx.body.qty, limit_total: ctx.body.limit_total,
    });
    const r = out.returnValue as { total?: unknown; fee?: unknown } | null;
    if (!r || typeof r.total !== "string" || typeof r.fee !== "string") {
      // The trade executed but its result could not be read (see parseOutcome): never invent numbers.
      ctx.svc.log.error("trade result missing from the transaction outcome");
      throw new ApiError("INTERNAL", "Your trade went through, but the receipt is missing. Check your balance.");
    }
    return { player: await readPlayer(ctx), total: r.total, fee: r.fee };
  },
  onSuccess: invalidate,
};

export const journeyStartSpec: PostSpec<Body<typeof JourneyStartRequestSchema>, JourneyData> = {
  kind: "journey_start",
  schema: JourneyStartRequestSchema,
  async run(ctx) {
    const out = await relay(ctx, "start_journey", { to: ctx.body.to, cargo: ctx.body.cargo, guards: ctx.body.guards });
    return { journey: toApiJourney(out.returnValue as ContractJourney, ctx.svc.now()) };
  },
  onSuccess: invalidate,
};

export const journeyClaimSpec: PostSpec<Record<string, never>, ClaimData> = {
  kind: "journey_claim",
  async run(ctx) {
    const out = await relay(ctx, "claim_journey", {});
    return { journey: toApiJourney(out.returnValue as ContractJourney, ctx.svc.now()), player: await readPlayer(ctx) };
  },
  onSuccess: invalidate,
};

export const stallCreateSpec: PostSpec<Body<typeof StallCreateRequestSchema>, StallData> = {
  kind: "stall_create",
  schema: StallCreateRequestSchema,
  async run(ctx) {
    const out = await relay(ctx, "stall_create", { good: ctx.body.good, qty: ctx.body.qty, unit_price: ctx.body.unit_price });
    return { stall: toApiStall(out.returnValue as ContractStall) };
  },
  onSuccess: invalidate,
};

export const stallBuySpec: PostSpec<Body<typeof StallBuyRequestSchema>, PlayerData> = {
  kind: "stall_buy",
  schema: StallBuyRequestSchema,
  async run(ctx) {
    await relay(ctx, "stall_buy", { stall_id: ctx.body.stall_id, qty: ctx.body.qty, limit_total: ctx.body.limit_total });
    return { player: await readPlayer(ctx) };
  },
  onSuccess: invalidate,
};

export const stallCancelSpec: PostSpec<Body<typeof StallCancelRequestSchema>, PlayerData> = {
  kind: "stall_cancel",
  schema: StallCancelRequestSchema,
  async run(ctx) {
    await relay(ctx, "stall_cancel", { stall_id: ctx.body.stall_id });
    return { player: await readPlayer(ctx) };
  },
  onSuccess: invalidate,
};

export const faucetSpec: PostSpec<Record<string, never>, PlayerData> = {
  kind: "faucet",
  mode: "PLAY_ONLY",
  async run(ctx) {
    await relay(ctx, "faucet", {});
    return { player: await readPlayer(ctx) };
  },
  onSuccess: invalidate,
};
