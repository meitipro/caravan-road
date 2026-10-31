// Meta-transaction relayer logic (master plan 6.4b). Every player action goes through submit():
//   allowlisted method, zero deposit -> relayer daily budget -> per-account lock ->
//   decrypt the player's key in memory only -> ContractClient.playerCall (NEP-366 delegate action,
//   relayer pays gas) -> map panic text to ErrorCode.
// The signing and submission details live in contract/near.ts (NearContract) or contract/fake.ts.

import { ApiError, ContractPanic, mapPanic } from "../errors";
import { PLAYER_METHODS, type ContractClient, type PlayerArgs, type PlayerMethod, type TxOutcome } from "../contract/types";
import type { Repo, UserRow } from "../db/repo";
import { LIMITS, type RateLimiter } from "../guards/rateLimit";
import type { Logger } from "../log";
import type { Custody } from "./custody";

/** Serialises async work per key (a player's key has one nonce lane). */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export interface Relayer {
  submit<M extends PlayerMethod>(user: UserRow, method: M, args: PlayerArgs[M], opts?: { deposit?: bigint }): Promise<TxOutcome>;
}

export function createRelayer(deps: {
  repo: Repo;
  contract: ContractClient;
  custody: Custody;
  limiter: RateLimiter;
  log: Logger;
}): Relayer {
  const lock = new KeyedMutex();
  return {
    async submit(user, method, args, opts) {
      if (!(PLAYER_METHODS as readonly string[]).includes(method)) {
        throw new ApiError("BAD_REQUEST", "method is not relayable");
      }
      if (opts?.deposit !== undefined && opts.deposit !== 0n) {
        throw new ApiError("BAD_REQUEST", "attaching a deposit is not allowed");
      }
      if (!user.near_account_id) throw new ApiError("INTERNAL", "player has no account");
      const account = user.near_account_id;

      const budget = await deps.limiter.hit("relayer:day", LIMITS.RELAYER_ACTIONS_PER_DAY, 86400);
      if (!budget.allowed) {
        deps.log.error("relayer daily budget exhausted");
        throw new ApiError("RATE_LIMIT", "The server is busy right now. Please try again later.");
      }

      const row = await deps.repo.getCustody(user.id);
      if (!row) {
        deps.log.error("custody record missing for a user with an account");
        throw new ApiError("INTERNAL", "Something went wrong. Please try again.");
      }
      try {
        return await lock.run(account, () =>
          deps.custody.withKey(user.id, row.public_key, row, (key) => deps.contract.playerCall(account, method, args, key)),
        );
      } catch (e) {
        if (e instanceof ApiError) throw e;
        if (e instanceof ContractPanic) {
          const m = mapPanic(e.message);
          if (m.code === "INTERNAL") deps.log.error("unmapped contract panic:", e.message);
          throw new ApiError(m.code, m.message);
        }
        deps.log.error("relayer failure:", e);
        throw new ApiError("INTERNAL", "Something went wrong. Please try again.");
      }
    },
  };
}
