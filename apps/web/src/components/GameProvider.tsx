"use client";

// Data provider: polls the api-client's getState() every 3 s (SWR), keeps a server-synced clock,
// price trends versus the previous tick, and exposes the player actions with toasts and refetch.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import useSWR from "swr";
import {
  CITY_IDS, GOOD_IDS,
  type ApiClient, type ApiResult, type CityId, type ErrorCode, type Event, type GoodId, type Journey,
  type Mode, type Player, type Side, type Stall, type StateData, type WorldState,
} from "@caravan/shared";
import { ApiError, IS_MOCK, getApi, unwrap } from "../ui/api";
import { addBuy, basisCost, loadBasis, persistBasis, removeUnits, type Basis } from "../ui/basis";
import { stallErrorText } from "../ui/stall-math";
import { faucetRefusalText } from "../ui/faucet-rules";
import { type Cargo } from "../ui/trade-math";
import { useToast } from "./Toast";

export type Trend = "up" | "down" | "flat";
export type GameStatus = "loading" | "ready" | "error" | "unauth";

interface Game {
  status: GameStatus;
  world: WorldState | null;
  me: Player | null;
  events: Event[];
  mode: Mode | null;
  error: { code: ErrorCode; message: string } | null;
  api: ApiClient;
  refresh: () => Promise<void>;
  /** mid price change versus the previous tick */
  trend: (city: CityId, good: GoodId) => Trend;
  basis: Basis;
  updateBasis: (fn: (b: Basis) => Basis) => void;
  /** Put a fresh player (from an action response) into the cache and refetch. */
  applyPlayer: (p: Player) => void;
}

const GameCtx = createContext<Game | null>(null);
const NowCtx = createContext<number>(0);

export function useGame(): Game {
  const v = useContext(GameCtx);
  if (!v) throw new Error("useGame outside GameProvider");
  return v;
}

/** Server-synchronised unix seconds (float), updated every 250 ms. */
export const useNow = () => useContext(NowCtx);

type MidSnap = Record<CityId, Record<GoodId, bigint>>;

function snapshot(world: WorldState): MidSnap {
  const out = {} as MidSnap;
  for (const c of CITY_IDS) {
    out[c] = {} as Record<GoodId, bigint>;
    const m = world.merchants.find((x) => x.id === c);
    for (const g of GOOD_IDS) out[c][g] = m ? BigInt(m.quotes[g].mid) : 0n;
  }
  return out;
}

class TrendTracker {
  private tick = -1;
  private cur: MidSnap | null = null;
  private prev: MidSnap | null = null;
  update(world: WorldState): void {
    const snap = snapshot(world);
    if (world.tick !== this.tick) {
      this.prev = this.cur;
      this.tick = world.tick;
    }
    this.cur = snap;
  }
  trend(city: CityId, good: GoodId): Trend {
    if (!this.cur || !this.prev) return "flat";
    const a = this.cur[city][good];
    const b = this.prev[city][good];
    return a > b ? "up" : a < b ? "down" : "flat";
  }
}

const fetchState = async (): Promise<StateData> => unwrap(await getApi().getState());

export function GameProvider({ children }: { children: ReactNode }) {
  const api = getApi();
  const tracker = useRef(new TrendTracker());
  const [basis, setBasis] = useState<Basis>({});
  useEffect(() => setBasis(loadBasis()), []);

  const { data, error, mutate } = useSWR<StateData, ApiError>("state", fetchState, {
    refreshInterval: 3000,
    dedupingInterval: 1000,
    revalidateOnFocus: true,
    shouldRetryOnError: true,
    errorRetryInterval: 3000,
    keepPreviousData: true,
  });

  // Trend bookkeeping and the clock offset are derived from the latest successful state.
  const offset = useRef(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (!data) return;
    tracker.current.update(data.world);
    offset.current = data.world.now - Date.now() / 1000;
    force((n) => n + 1);
  }, [data]);

  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (data) setNow(Date.now() / 1000 + offset.current);
    }, 250);
    if (data) setNow(Date.now() / 1000 + offset.current);
    return () => window.clearInterval(id);
  }, [data]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const updateBasis = useCallback((fn: (b: Basis) => Basis) => {
    setBasis((prev) => {
      const next = fn(prev);
      if (next !== prev) persistBasis(next);
      return next;
    });
  }, []);

  const applyPlayer = useCallback(
    (player: Player) => {
      void mutate((cur) => (cur ? { ...cur, me: player } : cur), { revalidate: true });
    },
    [mutate],
  );

  const status: GameStatus = data
    ? "ready"
    : error
      ? error instanceof ApiError && error.code === "UNAUTHENTICATED"
        ? "unauth"
        : "error"
      : "loading";

  const value = useMemo<Game>(
    () => ({
      status,
      world: data?.world ?? null,
      me: data?.me ?? null,
      events: data?.events ?? [],
      mode: data?.world.mode ?? null,
      error: error ? { code: error instanceof ApiError ? error.code : "INTERNAL", message: error.message } : null,
      api,
      refresh,
      trend: (c, g) => tracker.current.trend(c, g),
      basis,
      updateBasis,
      applyPlayer,
    }),
    // tracker is a ref; `data` changes whenever it updates.
    [status, data, error, api, refresh, basis, updateBasis, applyPlayer],
  );

  return (
    <GameCtx.Provider value={value}>
      <NowCtx.Provider value={now}>{children}</NowCtx.Provider>
    </GameCtx.Provider>
  );
}

/** Player actions: each calls the api-client, updates the cached player, refetches and reports errors as toasts. */
export function useActions() {
  const game = useGame();
  const toast = useToast();
  const { applyPlayer, refresh, updateBasis } = game;

  const fail = useCallback(
    (r: Extract<ApiResult<unknown>, { ok: false }>, text?: string) => {
      if (text) toast.push("error", text);
      else toast.error(r.error);
      void refresh();
    },
    [toast, refresh],
  );

  return useMemo(
    () => ({
      async trade(args: {
        merchant: CityId; good: GoodId; side: Side; qty: number; limit_total: string;
      }): Promise<ApiResult<{ total: string; fee: string; player: Player }>> {
        const r = await game.api.trade(args);
        if (!r.ok) {
          fail(r);
          return r;
        }
        applyPlayer(r.data.player);
        const total = BigInt(r.data.total);
        const fee = BigInt(r.data.fee);
        if (args.side === "buy") updateBasis((b) => addBuy(b, args.good, args.qty, total + fee));
        else updateBasis((b) => removeUnits(b, args.good, args.qty));
        return r;
      },
      async startJourney(args: { to: CityId; cargo: Cargo; guards: number }): Promise<ApiResult<{ journey: Journey }>> {
        const r = await game.api.journeyStart(args);
        if (!r.ok) {
          fail(r);
          return r;
        }
        void refresh();
        return r;
      },
      async claim(): Promise<ApiResult<{ journey: Journey; player: Player }>> {
        const r = await game.api.journeyClaim();
        if (!r.ok) {
          fail(r);
          return r;
        }
        applyPlayer(r.data.player);
        // Goods lost in an ambush leave the cost basis as well.
        const lost = Object.entries(r.data.journey.lost ?? {}) as Array<[GoodId, number]>;
        if (lost.length > 0) updateBasis((b) => lost.reduce((acc, [g, n]) => removeUnits(acc, g, n), b));
        return r;
      },
      async faucet(): Promise<ApiResult<{ player: Player }>> {
        const r = await game.api.faucet();
        if (!r.ok) {
          // RATE_LIMIT and BAD_REQUEST mean "wait about an hour" and "you own too much": say so, not the generic text.
          fail(r, faucetRefusalText(r.error.code, IS_MOCK) ?? undefined);
          return r;
        }
        applyPlayer(r.data.player);
        return r;
      },
      /** Open a stall in the player's city with goods they hold (they leave the inventory until sold or closed). */
      async stallCreate(args: { good: GoodId; qty: number; unit_price: string }): Promise<ApiResult<{ stall: Stall }>> {
        const r = await game.api.stallCreate(args);
        if (!r.ok) {
          fail(r, stallErrorText("create", r.error.code));
          return r;
        }
        await refresh(); // the response carries the stall only; the new list and inventory come from the state
        return r;
      },
      /** Buy from a stall. The price is fixed, so the limit is the exact price (the buyer never pays a fee). */
      async stallBuy(args: { stall_id: number; qty: number; good: GoodId; price: bigint }): Promise<ApiResult<{ player: Player }>> {
        const r = await game.api.stallBuy({ stall_id: args.stall_id, qty: args.qty, limit_total: args.price.toString() });
        if (!r.ok) {
          fail(r, stallErrorText("buy", r.error.code));
          return r;
        }
        applyPlayer(r.data.player);
        updateBasis((b) => addBuy(b, args.good, args.qty, args.price));
        return r;
      },
      /** Close a stall: the goods return to the inventory. The cost basis is left alone (creating a stall never changed it). */
      async stallCancel(args: { stall_id: number }): Promise<ApiResult<{ player: Player }>> {
        const r = await game.api.stallCancel(args);
        if (!r.ok) {
          fail(r, stallErrorText("cancel", r.error.code));
          return r;
        }
        applyPlayer(r.data.player);
        return r;
      },
      basisCost: (g: GoodId, qty: number) => basisCost(game.basis, g, qty),
    }),
    [game.api, game.basis, applyPlayer, fail, refresh, updateBasis],
  );
}
