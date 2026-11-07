// Worker-local interfaces. The worker depends on these small ports only, never on the server's or
// the contract's code. Real adapters (chain-near.ts, db.ts) and in-memory fakes (sim-world.ts,
// memory-store.ts) implement them.

import type { CityId, Decision, GoodId } from "@caravan/shared";

export interface MerchantSnapshot {
  id: CityId;
  treasury: bigint; // fils
  stock: Record<GoodId, number>;
  policy: { spread_bp: number; bias_bp: number };
  /**
   * What this merchant has already paid for incoming `ship` calls in the CURRENT tick (contract
   * `ship_in_paid`; the per-tick budget is 25% of treasury + this). Absent means 0 / unknown.
   */
  ship_in_paid?: bigint;
  /** Goods this merchant has already shipped out in the CURRENT tick (contract `last_ship_tick`). Absent means none. */
  shipped_this_tick?: GoodId[];
}

export interface WorldSnapshot {
  tick: number;
  now: number; // unix seconds
  merchants: Record<CityId, MerchantSnapshot>;
}

export interface TxResult {
  /** null when the adapter has no hash (in-memory fakes return a synthetic label, never a fake hash). */
  txHash: string | null;
}

/** What the worker needs from the chain. AI output never reaches anything else than these calls. */
export interface ChainPort {
  readSnapshot(): Promise<WorldSnapshot>;
  /** Signed by the merchant's own function-call key. Contract re-checks the ranges. */
  setPolicy(city: CityId, spreadBp: number, biasBp: number): Promise<TxResult>;
  /** Signed by the merchant's own key. Moves goods FROM `city` TO `to`. */
  ship(city: CityId, to: CityId, good: GoodId, qty: number): Promise<TxResult>;
  /** Anyone may call; the contract rejects calls closer than 55 s. Returns skipped=true if too early. */
  worldTick(): Promise<TxResult & { skipped?: boolean }>;
}

/** Inference evidence kept for /api/proof/{merchant}. See attest.ts. */
export interface EvidenceRecord {
  merchant: CityId;
  at: number;
  model: string | null;
  request_id: string | null;
  chat_id: string | null;
  request_sha256: string;
  response_sha256: string;
  signature: { text: string; signature: string; signing_address: string; signing_algo: string; signature_kind?: string } | null;
  /** Each check states what happened. Anything not performed says so. */
  checks: {
    signature: "not_attempted" | "unavailable" | "ok" | "failed";
    tee_quote: "not_verified" | "ok" | "failed";
  };
  attested: boolean;
  note: string;
}

export interface DecisionRecord {
  decision: Decision;
  input_hash: string;
  evidence: EvidenceRecord | null;
}

export interface DecisionStore {
  insertDecision(rec: DecisionRecord): Promise<void>;
  heartbeat(at: number): Promise<void>;
}

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export function consoleLogger(): Logger {
  const w = (level: string) => (msg: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
  return { info: w("info"), warn: w("warn"), error: w("error") };
}
