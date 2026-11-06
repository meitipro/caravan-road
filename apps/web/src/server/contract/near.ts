// NearContract: ContractClient on a real NEAR network with near-api-js 7.x. It compiles and
// typechecks but cannot be exercised without keys and a deployed contract (see docs/SERVER.md,
// "Going live"); the offline behaviour is covered by FakeContract.
//
// API names verified against the installed near-api-js@7.4.0 type definitions and these docs:
//  - meta-transactions (sign a delegate action, relayer submits it):
//    https://docs.near.org/web3-apps/tutorials/meta-transactions
//      Account.createSignedMetaTransaction({ receiverId, actions, blockHeightTtl }) -> { signedDelegate }
//      relayerAccount.relayMetaTransaction(signedDelegate)
//  - account creation: Account.createAccount({ newAccountId, publicKey, nearToTransfer }) creates a
//    sub-account of the signing account; storage: https://docs.near.org/protocol/storage/storage-staking
//    (1E19 yoctoNEAR per byte, 770 bytes free per account).
//  - view calls: provider.callFunction({ contractId, method, args }).
// NEP-366 delegate actions allow ONE delegate action per transaction; the deposit is always 0.
// Final-status handling for delegated calls (an inner panic shows up in a receipt, not necessarily in
// the top-level status) is written defensively and must be confirmed in the testnet smoke run.

import {
  Account, JsonRpcProvider, PublicKey, Signer, actions, teraToGas, type KeyPairString,
} from "near-api-js";
import type { CityId, GoodId, Mode } from "@caravan/shared";
import { ContractPanic, isContractPanic } from "../errors";
import {
  secToNs,
  type ContractClient, type ContractConfig, type ContractEvent, type ContractJourney, type ContractMerchant,
  type ContractPlayer, type ContractStall, type ContractWithdraw, type ContractWorld, type OperatorArgs,
  type OperatorMethod, type PlayerArgs, type PlayerKey, type PlayerMethod, type TxOutcome,
} from "./types";

export interface NearContractConfig {
  network: "testnet" | "mainnet";
  rpcUrl?: string;
  contractId: string;
  relayerAccountId: string;
  relayerPrivateKey: string;
  operatorAccountId: string;
  operatorPrivateKey: string;
  /** Test seam. */
  provider?: JsonRpcProvider;
}

const TESTNET_RPC = "https://test.rpc.fastnear.com"; // from the docs example above
const CALL_GAS = teraToGas(100);
const META_TX_TTL_BLOCKS = 100;
const ACCOUNT_FUNDING_YOCTO = 10n ** 22n; // 0.01 NEAR, VERIFY on the testnet smoke run
const EVENT_PREFIX = "EVENT_JSON:";
const MAX_EVENTS = 100;

/** Adapts a PlayerKey (in-memory seed) to near-api-js' Signer. */
class PlayerKeySigner extends Signer {
  constructor(private readonly key: PlayerKey) {
    super();
  }
  async getPublicKey(): Promise<PublicKey> {
    return PublicKey.from(this.key.publicKey);
  }
  protected async signBytes(bytes: Uint8Array): Promise<Uint8Array> {
    return this.key.sign(bytes);
  }
}

interface RawReceipt { outcome?: { executor_id?: string; logs?: string[]; status?: unknown } }
export interface RawOutcome {
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  receipts_outcome?: RawReceipt[];
}

function findFailure(res: RawOutcome): unknown | null {
  const top = res.status;
  if (top && typeof top === "object" && top.Failure) return top.Failure;
  for (const r of res.receipts_outcome ?? []) {
    const s = r.outcome?.status as { Failure?: unknown } | undefined;
    if (s && typeof s === "object" && s.Failure) return s.Failure;
  }
  return null;
}

function panicText(failure: unknown): string {
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(failure);
  return strings.find((s) => /panicked/i.test(s)) ?? strings[0] ?? "INTERNAL: transaction failed";
}

type Raw = Record<string, unknown>;

export class NearContract implements ContractClient {
  private readonly provider: JsonRpcProvider;
  private readonly relayer: Account;
  private readonly operator: Account;
  private readonly events: ContractEvent[] = [];
  private nextEventId = 1;

  constructor(private readonly cfg: NearContractConfig) {
    const url = cfg.rpcUrl ?? (cfg.network === "testnet" ? TESTNET_RPC : undefined);
    if (!cfg.provider && !url) throw new Error("NEAR_RPC_URL is required for mainnet");
    this.provider = cfg.provider ?? new JsonRpcProvider({ url: url! });
    this.relayer = new Account(cfg.relayerAccountId, this.provider, cfg.relayerPrivateKey as KeyPairString);
    this.operator = new Account(cfg.operatorAccountId, this.provider, cfg.operatorPrivateKey as KeyPairString);
  }

  // ------------------------------------------------------------------ views

  private async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.provider.callFunction({ contractId: this.cfg.contractId, method, args })) as T;
  }

  async getWorld(): Promise<ContractWorld> {
    const [w, stalls] = await Promise.all([this.view<Raw>("get_world"), this.getStalls()]);
    return {
      tick: Number(w.tick), now_ns: String(w.now_ns), mode: w.mode as Mode, paused: Boolean(w.paused), house: String(w.house),
      merchants: (w.merchants as Raw[]).map(normMerchant), stalls,
    };
  }
  async getPlayer(accountId: string): Promise<ContractPlayer | null> {
    const p = await this.view<Raw | null>("get_player", { account_id: accountId });
    return p ? normPlayer(p) : null;
  }
  async getPlayers(fromIndex: number, limit: number): Promise<ContractPlayer[]> {
    return (await this.view<Raw[]>("get_players", { from_index: fromIndex, limit })).map(normPlayer);
  }
  async getMerchant(city: CityId): Promise<ContractMerchant> {
    return normMerchant(await this.view<Raw>("get_merchant", { city }));
  }
  async getStalls(city?: CityId): Promise<ContractStall[]> {
    return (await this.view<Raw[]>("get_stalls", city ? { city } : {})).map((s) => ({
      id: Number(s.id), seller: String(s.seller), city: s.city as CityId, good: s.good as GoodId, qty: Number(s.qty), unit_price: String(s.unit_price),
    }));
  }
  async getJourney(accountId: string): Promise<ContractJourney | null> {
    const j = await this.view<Raw | null>("get_journey", { account_id: accountId });
    return j ? normJourney(j) : null;
  }
  async getWithdraw(id: number): Promise<ContractWithdraw | null> {
    const w = await this.view<Raw | null>("get_withdraw", { id });
    return w ? normWithdraw(w) : null;
  }
  /** Assumed view `get_withdrawals({from_id, limit})`, ascending ids (SHARED_ISSUES.md). */
  async getWithdrawals(fromId: number, limit: number): Promise<ContractWithdraw[]> {
    return (await this.view<Raw[]>("get_withdrawals", { from_id: fromId, limit })).map(normWithdraw);
  }
  async getConfig(): Promise<ContractConfig> {
    const c = await this.view<Raw>("get_config");
    return { mode: c.mode as Mode, paused: Boolean(c.paused), operator: String(c.operator) };
  }
  /**
   * Events seen in the outcomes of transactions this server instance submitted (NEP-297 log lines).
   * Other instances' and the worker's events are not visible here; see SHARED_ISSUES.md (events view).
   */
  async recentEvents(limit: number): Promise<ContractEvent[]> {
    return this.events.slice(-limit);
  }
  async accountBalance(accountId: string): Promise<string> {
    return (await new Account(accountId, this.provider).getBalance()).toString();
  }

  // ------------------------------------------------------------------ transactions

  async createPlayerAccount(accountId: string, publicKey: string): Promise<{ txHash: string }> {
    try {
      await this.provider.viewAccount({ accountId });
      return { txHash: "" }; // already exists: idempotent
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/does not exist|UNKNOWN_ACCOUNT/i.test(msg)) throw e;
    }
    const res = await this.relayer.createAccount({ newAccountId: accountId, publicKey, nearToTransfer: ACCOUNT_FUNDING_YOCTO });
    return { txHash: this.extract(res as unknown as RawOutcome).txHash };
  }

  async playerCall<M extends PlayerMethod>(accountId: string, method: M, args: PlayerArgs[M], key: PlayerKey): Promise<TxOutcome> {
    const player = new Account(accountId, this.provider, new PlayerKeySigner(key));
    const attempt = async (): Promise<TxOutcome> => {
      // Zero deposit, one function call per delegate action (NEP-366), expires after META_TX_TTL_BLOCKS.
      const { signedDelegate } = await player.createSignedMetaTransaction({
        receiverId: this.cfg.contractId,
        actions: [actions.functionCall(method, args as object, CALL_GAS, 0n)],
        blockHeightTtl: META_TX_TTL_BLOCKS,
      });
      return this.extract((await this.relayer.relayMetaTransaction(signedDelegate)) as unknown as RawOutcome);
    };
    try {
      return await attempt();
    } catch (e) {
      if (isContractPanic(e)) throw e;
      if (/nonce/i.test(e instanceof Error ? e.message : "")) return attempt(); // one retry on a stale nonce
      throw e;
    }
  }

  async operatorCall<M extends OperatorMethod>(method: M, args: OperatorArgs[M]): Promise<TxOutcome> {
    const res = await this.operator.callFunctionRaw({ contractId: this.cfg.contractId, methodName: method, args: args as Record<string, unknown>, deposit: 0n, gas: CALL_GAS });
    return this.extract(res as unknown as RawOutcome);
  }

  async worldTick(): Promise<TxOutcome> {
    const res = await this.relayer.callFunctionRaw({ contractId: this.cfg.contractId, methodName: "world_tick", args: {}, deposit: 0n, gas: CALL_GAS });
    return this.extract(res as unknown as RawOutcome);
  }

  // ------------------------------------------------------------------ outcome parsing

  private extract(res: RawOutcome): TxOutcome {
    const out = parseOutcome(res, this.cfg.contractId, () => this.nextEventId++);
    this.events.push(...out.events);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    return out;
  }
}

function decodeJson(b64: string | undefined): unknown {
  if (!b64) return undefined;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Turns a transaction response into a TxOutcome. A relayed NEP-366 call has an EMPTY top-level
 * SuccessValue (it belongs to the delegate receipt at the player account), so the contract's return
 * value is read from the function-call receipt executed by the contract account. A missing value stays
 * `null`: callers must treat null as "unknown", never as 0.
 */
export function parseOutcome(res: RawOutcome, contractId: string, nextId: () => number): TxOutcome {
  const failure = findFailure(res);
  if (failure) throw new ContractPanic(panicText(failure));
  const txHash = res.transaction?.hash ?? res.transaction_outcome?.id ?? "";
  let returnValue: unknown = null;
  const top = res.status;
  if (top && typeof top === "object" && top.SuccessValue) returnValue = decodeJson(top.SuccessValue) ?? null;
  if (returnValue === null) {
    for (const r of [...(res.receipts_outcome ?? [])].reverse()) {
      const st = r.outcome?.status as { SuccessValue?: string } | undefined;
      if (r.outcome?.executor_id === contractId && st && typeof st === "object" && st.SuccessValue) {
        const v = decodeJson(st.SuccessValue);
        if (v !== undefined) {
          returnValue = v;
          break;
        }
      }
    }
  }
  const events: ContractEvent[] = [];
  for (const r of res.receipts_outcome ?? []) {
    for (const line of r.outcome?.logs ?? []) {
      if (!line.startsWith(EVENT_PREFIX)) continue;
      try {
        const j = JSON.parse(line.slice(EVENT_PREFIX.length)) as { event?: string; data?: unknown };
        const d = (Array.isArray(j.data) ? j.data[0] : j.data) as Record<string, unknown> | undefined;
        if (typeof j.event !== "string" || !d) continue;
        const ts = typeof d.ts === "number" ? d.ts : Math.floor(Date.now() / 1000);
        events.push({ id: nextId(), event: j.event, data: { ...d, tx_hash: txHash || undefined }, at_ns: secToNs(ts) });
      } catch {
        /* ignore a malformed log line */
      }
    }
  }
  return { txHash, returnValue, events };
}

// ---------------------------------------------------------------------- JSON normalisers
// contracts/caravan/src/types.rs (views): merchants carry `policy`, journeys carry a status string,
// money is a decimal string, `_ns` fields are decimal strings.

function normMerchant(m: Raw): ContractMerchant {
  const policy = (m.policy ?? {}) as { spread_bp?: number; bias_bp?: number };
  return {
    id: m.id as CityId, account_id: String(m.account_id), treasury: String(m.treasury), stock: m.stock as Record<GoodId, number>,
    spread_bp: Number(policy.spread_bp ?? m.spread_bp), bias_bp: Number(policy.bias_bp ?? m.bias_bp),
  };
}

function normJourney(j: Raw): ContractJourney {
  return {
    id: Number(j.id), from: j.from as CityId, to: j.to as CityId, cargo: (j.cargo ?? {}) as ContractJourney["cargo"],
    guards: Number(j.guards), started_at_ns: String(j.started_at_ns), arrives_at_ns: String(j.arrives_at_ns),
    risk_bp: Number(j.risk_bp), claimed: j.status === "CLAIMED" || j.claimed === true,
    ambushed: Boolean(j.ambushed), lost: (j.lost ?? {}) as ContractJourney["lost"],
  };
}

function normPlayer(p: Raw): ContractPlayer {
  return {
    account_id: String(p.account_id), fils: String(p.fils), location: p.location as CityId, inventory: p.inventory as Record<GoodId, number>,
    journey: p.journey ? normJourney(p.journey as Raw) : null, total_deposited: String(p.total_deposited ?? "0"),
  };
}

function normWithdraw(w: Raw): ContractWithdraw {
  return {
    id: Number(w.id), account_id: String(w.account_id), fils: String(w.fils), dest_asset: String(w.dest_asset ?? ""),
    dest_address: String(w.dest_address ?? ""), status: w.status as ContractWithdraw["status"],
  };
}
