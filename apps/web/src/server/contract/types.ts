// Typed client interface for the Caravan contract (contracts/caravan), mirroring spec/CONTRACT.md
// (section 2.14): method names, argument names, views, events and the panic convention.
//
// Conventions used by the server (to be reconciled with the Rust contract; see docs/SERVER.md):
//  - JSON arguments use snake_case names; u128 money is a decimal string; u64 nanosecond
//    timestamps arrive as decimal strings (or numbers) and are converted to unix seconds here.
//  - A panic message starts with an ErrorCode token ("SLIPPAGE: price moved"), see errors.ts mapPanic.

import type { CityId, Fils, GoodId, Mode } from "@caravan/shared";

export type Ns = string | number;

// ---- views ----

export interface ContractMerchant {
  id: CityId;
  account_id: string;
  treasury: Fils;
  stock: Record<GoodId, number>;
  spread_bp: number;
  bias_bp: number;
}

export interface ContractStall {
  id: number;
  seller: string;
  city: CityId;
  good: GoodId;
  qty: number;
  unit_price: Fils;
}

export interface ContractWorld {
  tick: number;
  now_ns: Ns;
  mode: Mode;
  paused: boolean;
  house: Fils;
  merchants: ContractMerchant[];
  stalls: ContractStall[];
}

export interface ContractJourney {
  id: number;
  from: CityId;
  to: CityId;
  cargo: Partial<Record<GoodId, number>>;
  guards: number;
  started_at_ns: Ns;
  arrives_at_ns: Ns;
  risk_bp: number;
  claimed: boolean;
  ambushed: boolean;
  lost: Partial<Record<GoodId, number>>;
}

export interface ContractPlayer {
  account_id: string;
  fils: Fils;
  location: CityId;
  inventory: Record<GoodId, number>;
  journey: ContractJourney | null;
  total_deposited: Fils;
}

export interface ContractWithdraw {
  id: number;
  account_id: string;
  fils: Fils;
  dest_asset: string;
  dest_address: string;
  status: "PENDING" | "SENT" | "DONE" | "REFUNDED";
}

export interface ContractConfig {
  mode: Mode;
  paused: boolean;
  operator: string;
}

/** NEP-297 event as seen in the transaction logs ("EVENT_JSON:{...}"). */
export interface ContractEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
  at_ns: Ns;
}

// ---- calls ----

/** Methods a player signs (meta-transaction). Spec 2.14: caller = player. */
export const PLAYER_METHODS = [
  "register", "faucet", "trade", "start_journey", "claim_journey",
  "stall_create", "stall_buy", "stall_cancel", "request_withdraw",
] as const;
export type PlayerMethod = (typeof PLAYER_METHODS)[number];

/** Methods only the operator key may call (spec 2.14: caller = operator). */
export const OPERATOR_METHODS = ["credit_deposit", "mark_withdraw", "refund_withdraw", "set_paused"] as const;
export type OperatorMethod = (typeof OPERATOR_METHODS)[number];

export interface PlayerArgs {
  register: Record<string, never>;
  faucet: Record<string, never>;
  trade: { merchant: CityId; good: GoodId; side: "buy" | "sell"; qty: number; limit_total: Fils };
  start_journey: { to: CityId; cargo: Partial<Record<GoodId, number>>; guards: number };
  claim_journey: Record<string, never>;
  stall_create: { good: GoodId; qty: number; unit_price: Fils };
  stall_buy: { stall_id: number; qty: number; limit_total: Fils };
  stall_cancel: { stall_id: number };
  request_withdraw: { fils: Fils; dest_asset: string; dest_address: string };
}

export interface OperatorArgs {
  credit_deposit: { account_id: string; fils: Fils; reference: string };
  mark_withdraw: { id: number; reference: string };
  refund_withdraw: { id: number };
  set_paused: { paused: boolean };
}

/** Return values (JSON) of the calls the server reads. */
export interface PlayerReturns {
  trade: { total: Fils; fee: Fils };
  claim_journey: ContractJourney;
  start_journey: ContractJourney;
  stall_create: ContractStall;
  request_withdraw: number;
}

export interface TxOutcome<T = unknown> {
  txHash: string;
  returnValue: T;
  events: ContractEvent[];
}

/**
 * The key a player's meta-transaction is signed with. Lives in memory only for one call and is
 * zeroed afterwards by the relayer (near/relayer.ts).
 */
export interface PlayerKey {
  publicKey: string; // "ed25519:<base58>"
  sign(message: Uint8Array): Uint8Array;
}

export interface ContractClient {
  // ---- views (anyone) ----
  getWorld(): Promise<ContractWorld>;
  getPlayer(accountId: string): Promise<ContractPlayer | null>;
  getPlayers(fromIndex: number, limit: number): Promise<ContractPlayer[]>;
  getMerchant(city: CityId): Promise<ContractMerchant>;
  getStalls(city?: CityId): Promise<ContractStall[]>;
  getJourney(accountId: string): Promise<ContractJourney | null>;
  getWithdraw(id: number): Promise<ContractWithdraw | null>;
  /** Withdrawals with id >= fromId in ascending id order (used to reconcile debits that have no DB row). */
  getWithdrawals(fromId: number, limit: number): Promise<ContractWithdraw[]>;
  getConfig(): Promise<ContractConfig>;
  /** Most recent events, oldest first. */
  recentEvents(limit: number): Promise<ContractEvent[]>;

  // ---- transactions ----
  /** Creates `accountId` (CreateAccount + Transfer + AddKey). Idempotent: an existing account is not an error. */
  createPlayerAccount(accountId: string, publicKey: string): Promise<{ txHash: string }>;
  /** Runs `method` as the player through a NEP-366 meta-transaction paid by the relayer. Zero deposit only. */
  playerCall<M extends PlayerMethod>(accountId: string, method: M, args: PlayerArgs[M], key: PlayerKey): Promise<TxOutcome>;
  /** Operator-key call. */
  operatorCall<M extends OperatorMethod>(method: M, args: OperatorArgs[M]): Promise<TxOutcome>;
  /** Anyone may call world_tick(); sent with the relayer key. */
  worldTick(): Promise<TxOutcome>;

  // ---- health ----
  /** Native balance of an account in yoctoNEAR (decimal string). */
  accountBalance(accountId: string): Promise<string>;
}

export const NS_PER_SECOND = 1_000_000_000n;
export const nsToSec = (ns: Ns): number => Number(BigInt(ns) / NS_PER_SECOND);
export const secToNs = (sec: number): string => (BigInt(sec) * NS_PER_SECOND).toString();
