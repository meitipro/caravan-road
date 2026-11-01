// The treasury hot wallet on NEAR mainnet: reads its USDC balance and sends the USDC for a withdrawal.
// Kept behind a tiny interface so the 1Click client is tested without a chain.
//
// NEP-141 methods: https://nomicon.io/Standards/Tokens/FungibleToken/Core
//   ft_balance_of({ account_id }) -> string (view)
//   ft_transfer({ receiver_id, amount, memo? }) requires an attached deposit of exactly 1 yoctoNEAR.
// near-api-js 7.4.0 (installed): provider.callFunction({ contractId, method, args }) for views and
//   account.callFunctionRaw({ contractId, methodName, args, deposit, gas }) for the signed call, as used in
//   ../contract/near.ts (docs: https://docs.near.org/tools/near-api).
//
// Outcome policy (money safety):
//   - The transaction was executed and a receipt FAILED (for example the receiver is not registered with the
//     token): NEP-141 transfers are atomic, nothing moved -> { ok: false } (the caller may refund the player).
//   - Anything that throws (network, timeout, nonce, RPC error): the outcome is UNKNOWN -> the error is
//     rethrown and the caller must NOT retry or refund blindly.

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";
import { OneClickError } from "./http";

export type TransferResult = { ok: true; txHash: string } | { ok: false; reason: string };

export interface TreasuryChain {
  /** USDC (smallest unit) held by the treasury account in `tokenContract`. */
  ftBalance(tokenContract: string): Promise<bigint>;
  /** Sends `amount` (smallest unit) of `tokenContract` from the treasury to `receiver`. */
  ftTransfer(a: { tokenContract: string; receiver: string; amount: bigint }): Promise<TransferResult>;
}

export interface NearTreasuryConfig {
  accountId: string;
  privateKey: string;
  rpcUrl: string;
  /** Test seam. */
  provider?: JsonRpcProvider;
}

const TRANSFER_GAS = teraToGas(30);
const ONE_YOCTO = 1n;

interface RawReceipt { outcome?: { status?: unknown } }
interface RawOutcome {
  status?: { SuccessValue?: string; Failure?: unknown } | string;
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  receipts_outcome?: RawReceipt[];
}

function hasFailure(res: RawOutcome): boolean {
  const top = res.status;
  if (top && typeof top === "object" && top.Failure) return true;
  for (const r of res.receipts_outcome ?? []) {
    const s = r.outcome?.status as { Failure?: unknown } | undefined;
    if (s && typeof s === "object" && s.Failure) return true;
  }
  return false;
}

export class NearTreasury implements TreasuryChain {
  private readonly provider: JsonRpcProvider;
  private readonly account: Account;

  constructor(private readonly cfg: NearTreasuryConfig) {
    this.provider = cfg.provider ?? new JsonRpcProvider({ url: cfg.rpcUrl });
    this.account = new Account(cfg.accountId, this.provider, cfg.privateKey as KeyPairString);
  }

  async ftBalance(tokenContract: string): Promise<bigint> {
    const v = await this.provider.callFunction({ contractId: tokenContract, method: "ft_balance_of", args: { account_id: this.cfg.accountId } });
    if (typeof v !== "string" || !/^[0-9]{1,78}$/.test(v)) throw new OneClickError("schema", "Unexpected treasury balance answer");
    return BigInt(v);
  }

  async ftTransfer(a: { tokenContract: string; receiver: string; amount: bigint }): Promise<TransferResult> {
    if (a.amount <= 0n) return { ok: false, reason: "invalid amount" };
    const res = (await this.account.callFunctionRaw({
      contractId: a.tokenContract, methodName: "ft_transfer",
      args: { receiver_id: a.receiver, amount: a.amount.toString() },
      deposit: ONE_YOCTO, gas: TRANSFER_GAS,
    })) as unknown as RawOutcome;
    if (hasFailure(res)) return { ok: false, reason: "token transfer failed" };
    const txHash = res.transaction?.hash ?? res.transaction_outcome?.id;
    if (typeof txHash !== "string" || txHash.length === 0) {
      // Executed without failure but no hash to follow: treat as unknown, never as "not sent".
      throw new OneClickError("schema", "Treasury transfer returned no transaction hash");
    }
    return { ok: true, txHash };
  }
}
