// API client. Function signatures mirror spec/API.md section 2.13 one to one.
// With NEXT_PUBLIC_MOCK=1 (or createApiClient({ mock: true })) it serves fixtures and a
// simulated world instead of calling the server, so the UI can be built before the backend exists.

import { createMockApiClient, type MockOptions } from "./mock.js";
import type { Proof, Event } from "./provisional.js";
import type {
  DepositQuoteRequest, JourneyStartRequest, StallBuyRequest, StallCancelRequest, StallCreateRequest,
  TradeRequest, WithdrawRequest,
} from "./schemas.js";
import type { ApiResult, CityId, Decision, Fils, Journey, Player, Stall, WorldState } from "./types.js";

export interface StateData { world: WorldState; me: Player | null; events: Event[] }
export interface TradeData { player: Player; total: Fils; fee: Fils }
export interface JourneyData { journey: Journey }
export interface ClaimData { journey: Journey; player: Player }
export interface StallData { stall: Stall }
export interface PlayerData { player: Player }
export interface DepositQuoteData {
  quote_id: string; deposit_address: string; amount_in: string; expected_fils: Fils; deadline: number;
}
export interface DepositStatusData { status: string; fils_credited?: Fils }
export interface WithdrawData { request_id: string; status: string }
/** One asset 1Click supports (LIVE only). `id` is what deposit `origin_asset` and withdraw `dest_asset` take. */
export interface TokenInfo { id: string; symbol: string; chain: string; decimals: number }
export interface TokensData { assets: TokenInfo[] }
export interface LeaderboardData { rows: Array<{ name: string; net_worth: Fils }> }
export interface DecisionsData { rows: Decision[] }

export interface ApiClient {
  getState(): Promise<ApiResult<StateData>>;
  trade(body: TradeRequest): Promise<ApiResult<TradeData>>;
  journeyStart(body: JourneyStartRequest): Promise<ApiResult<JourneyData>>;
  journeyClaim(): Promise<ApiResult<ClaimData>>;
  stallCreate(body: StallCreateRequest): Promise<ApiResult<StallData>>;
  stallBuy(body: StallBuyRequest): Promise<ApiResult<PlayerData>>;
  stallCancel(body: StallCancelRequest): Promise<ApiResult<PlayerData>>;
  /** PLAY only */
  faucet(): Promise<ApiResult<PlayerData>>;
  /** LIVE only (PLAY answers MODE_NOT_ALLOWED): the assets a deposit can come from or a withdrawal can go to. */
  tokens(): Promise<ApiResult<TokensData>>;
  depositQuote(body: DepositQuoteRequest): Promise<ApiResult<DepositQuoteData>>;
  depositStatus(quoteId: string): Promise<ApiResult<DepositStatusData>>;
  withdraw(body: WithdrawRequest): Promise<ApiResult<WithdrawData>>;
  leaderboard(): Promise<ApiResult<LeaderboardData>>;
  npcDecisions(merchant?: CityId): Promise<ApiResult<DecisionsData>>;
  proof(merchant: CityId): Promise<ApiResult<Proof>>;
}

export interface ApiClientOptions extends MockOptions {
  /** Force mock on or off; default reads NEXT_PUBLIC_MOCK === "1". */
  mock?: boolean;
  /** Prefix for real calls, e.g. "" (same origin) or "https://host". */
  baseUrl?: string;
  fetch?: typeof fetch;
  idempotencyKey?: () => string;
}

function mockFlag(): boolean {
  try {
    return process.env.NEXT_PUBLIC_MOCK === "1";
  } catch {
    return false;
  }
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  if (options.mock ?? mockFlag()) return createMockApiClient(options);
  return createHttpApiClient(options);
}

function createHttpApiClient(options: ApiClientOptions): ApiClient {
  const base = options.baseUrl ?? "";
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const newKey = options.idempotencyKey ?? (() => crypto.randomUUID());

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (method === "POST") {
      headers["content-type"] = "application/json";
      headers["idempotency-key"] = newKey();
    }
    try {
      const res = await doFetch(`${base}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return (await res.json()) as ApiResult<T>;
    } catch (e) {
      return { ok: false, error: { code: "INTERNAL", message: e instanceof Error ? e.message : "network error" } };
    }
  }

  const q = (params: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined));
    const str = s.toString();
    return str ? `?${str}` : "";
  };

  return {
    getState: () => call("GET", "/api/state"),
    trade: (b) => call("POST", "/api/trade", b),
    journeyStart: (b) => call("POST", "/api/journey/start", b),
    journeyClaim: () => call("POST", "/api/journey/claim"),
    stallCreate: (b) => call("POST", "/api/stall/create", b),
    stallBuy: (b) => call("POST", "/api/stall/buy", b),
    stallCancel: (b) => call("POST", "/api/stall/cancel", b),
    faucet: () => call("POST", "/api/faucet"),
    tokens: () => call("GET", "/api/tokens"),
    depositQuote: (b) => call("POST", "/api/deposit/quote", b),
    depositStatus: (quoteId) => call("GET", `/api/deposit/status${q({ quote_id: quoteId })}`),
    withdraw: (b) => call("POST", "/api/withdraw", b),
    leaderboard: () => call("GET", "/api/leaderboard"),
    npcDecisions: (merchant) => call("GET", `/api/npc/decisions${q({ merchant })}`),
    proof: (merchant) => call("GET", `/api/proof/${merchant}`),
  };
}
