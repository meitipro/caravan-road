// Real chain adapter: views through the JSON-RPC provider, writes signed with each merchant's own
// function-call key. near-api-js 7.4.0 (same version as apps/web):
//   https://docs.near.org/tools/near-api  (Account, JsonRpcProvider, provider.callFunction for views,
//   account.callFunction / callFunctionRaw for calls).
//
// UNVERIFIED AGAINST A DEPLOYED CONTRACT. The contract is built in parallel; method and field names
// follow spec 2.14 and the contract's MerchantView (id, treasury U128 string, stock{grain..silk},
// policy{spread_bp, bias_bp}). `get_world` is assumed to return { tick, now_ns, merchants: MerchantView[] }.
// If the deployed contract differs, fix this file (and its mapping test); nothing else depends on it.
// The contract re-checks every range, so a wrong call is rejected on-chain, never accepted silently.

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";
import { z } from "zod";
import type { CityId, GoodId } from "@caravan/shared";
import { CITY_IDS, GOOD_IDS } from "@caravan/shared";
import type { WorkerConfig } from "./config.js";
import type { ChainPort, TxResult, WorldSnapshot } from "./types.js";

const Goods = z.object({ grain: z.number(), salt: z.number(), iron: z.number(), spice: z.number(), silk: z.number() });
const MerchantView = z.object({
  id: z.enum(CITY_IDS),
  treasury: z.string().regex(/^[0-9]+$/),
  stock: Goods,
  policy: z.object({ spread_bp: z.number().int(), bias_bp: z.number().int() }),
});
const WorldView = z.object({
  tick: z.coerce.number().int().nonnegative(),
  now_ns: z.union([z.string(), z.number()]).optional(),
  merchants: z.array(MerchantView).length(4),
});

export function parseWorldView(raw: unknown, nowSeconds: () => number): WorldSnapshot {
  const w = WorldView.parse(raw);
  const merchants = {} as WorldSnapshot["merchants"];
  for (const m of w.merchants) {
    const stock = {} as Record<GoodId, number>;
    for (const g of GOOD_IDS) stock[g] = m.stock[g];
    merchants[m.id] = { id: m.id, treasury: BigInt(m.treasury), stock, policy: { ...m.policy } };
  }
  for (const c of CITY_IDS) if (!merchants[c]) throw new Error(`get_world is missing merchant ${c}`);
  const nowNs = w.now_ns !== undefined ? BigInt(w.now_ns) : null;
  return { tick: w.tick, now: nowNs !== null ? Number(nowNs / 1_000_000_000n) : nowSeconds(), merchants };
}

// The contract answers an early tick with { ticks: 0 } (no panic); the text match is only a fallback.
const TICK_TOO_EARLY = /too early|too soon|min.*interval/i;

function decodeReturn(status: unknown): unknown {
  const v = status && typeof status === "object" ? (status as { SuccessValue?: string }).SuccessValue : undefined;
  if (!v) return undefined;
  try { return JSON.parse(Buffer.from(v, "base64").toString("utf8")); } catch { return undefined; }
}

export class NearChain implements ChainPort {
  private readonly provider: JsonRpcProvider;
  private readonly accounts = new Map<CityId, Account>();

  constructor(
    private readonly cfg: WorkerConfig,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.provider = new JsonRpcProvider({ url: cfg.rpcUrl });
    for (const c of CITY_IDS) {
      this.accounts.set(c, new Account(cfg.merchantAccounts[c], this.provider, cfg.merchantKeys[c] as KeyPairString));
    }
  }

  async readSnapshot(): Promise<WorldSnapshot> {
    const raw = await this.provider.callFunction({ contractId: this.cfg.contractId, method: "get_world", args: {} });
    return parseWorldView(raw, this.nowSeconds);
  }

  private async call(city: CityId, methodName: string, args: Record<string, unknown>): Promise<TxResult & { returned?: unknown }> {
    const account = this.accounts.get(city);
    if (!account) throw new Error(`no account for ${city}`);
    const out = (await account.callFunctionRaw({
      contractId: this.cfg.contractId,
      methodName,
      args,
      gas: teraToGas("30"),
      deposit: 0n,
      waitUntil: "EXECUTED_OPTIMISTIC",
    })) as unknown as {
      status?: unknown;
      transaction_outcome?: { id?: string };
      transaction?: { hash?: string };
    };
    const status = out.status;
    if (status && typeof status === "object" && "Failure" in (status as object)) {
      throw new Error(`${methodName} failed on chain: ${JSON.stringify((status as { Failure: unknown }).Failure).slice(0, 200)}`);
    }
    return { txHash: out.transaction_outcome?.id ?? out.transaction?.hash ?? null, returned: decodeReturn(status) };
  }

  setPolicy(city: CityId, spreadBp: number, biasBp: number): Promise<TxResult> {
    return this.call(city, "set_policy", { spread_bp: spreadBp, bias_bp: biasBp });
  }

  ship(city: CityId, to: CityId, good: GoodId, qty: number): Promise<TxResult> {
    return this.call(city, "ship", { to, good, qty });
  }

  async worldTick(): Promise<TxResult & { skipped?: boolean }> {
    try {
      const r = await this.call("shahr", "world_tick", {});
      if (r.returned && typeof r.returned === "object" && (r.returned as { ticks?: number }).ticks === 0) return { txHash: null, skipped: true };
      return { txHash: r.txHash };
    } catch (e) {
      // the contract rejects ticks closer than 55 s; that is expected, not an error
      if (TICK_TOO_EARLY.test((e as Error).message)) return { txHash: null, skipped: true };
      throw e;
    }
  }
}
