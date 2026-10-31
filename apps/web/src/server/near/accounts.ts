// Custodial account creation (master plan 6.4b), idempotent and resumable:
//   NONE -> (claim id + encrypted key in the DB) PENDING -> (on-chain CreateAccount+Transfer+AddKey) CREATED
//        -> (register() through the relayer) REGISTERED
// A second login, a concurrent request, or a crash half way never creates a second account.
//
// Account ids are `p<8hex>.<ROOT>` where ROOT is RELAYER_ACCOUNT_ID: only the parent account can
// create a sub-account, and the relayer key is the one this server holds (see docs/SERVER.md).

import { randomBytes } from "node:crypto";
import type { Mode } from "@caravan/shared";
import { ApiError } from "../errors";
import { LIMITS, type RateLimiter } from "../guards/rateLimit";
import { isPaused } from "../guards/mode";
import type { ContractClient } from "../contract/types";
import type { Repo, UserRow } from "../db/repo";
import type { Logger } from "../log";
import { generateKey, type Custody } from "./custody";
import { KeyedMutex, type Relayer } from "./relayer";

export interface AccountService {
  /** Returns the user with a registered on-chain account, creating it if needed. */
  ensure(user: UserRow): Promise<UserRow>;
}

export function playerAccountId(root: string, rand: Uint8Array = randomBytes(4)): string {
  return `p${Buffer.from(rand).toString("hex")}.${root}`;
}

export function createAccountService(deps: {
  repo: Repo;
  contract: ContractClient;
  custody: Custody;
  relayer: Relayer;
  rootAccountId: string;
  log: Logger;
  limiter: RateLimiter;
  mode: Mode;
}): AccountService {
  const lock = new KeyedMutex();

  async function run(user: UserRow): Promise<UserRow> {
    let u = (await deps.repo.getUser(user.id)) ?? user;
    if (u.account_status === "REGISTERED" && u.near_account_id) return u;

    // Provisioning spends relayer funds, so it obeys the same switches as a game action.
    if (await isPaused(deps.repo, deps.mode)) throw new ApiError("PAUSED", "The game is paused for maintenance.");
    if (!u.near_account_id) {
      const global = await deps.limiter.hit("accounts:day", LIMITS.ACCOUNTS_PER_DAY, 86400);
      if (!global.allowed) throw new ApiError("RATE_LIMIT", "New accounts are busy right now. Please try again later.");
    }
    // Back-off: a user stuck half way (e.g. in CREATED) is retried a few times a minute, not on every poll.
    const attempt = await deps.limiter.hit(`prov:${u.id}`, LIMITS.PROVISION_ATTEMPTS_PER_MINUTE, 60);
    if (!attempt.allowed) throw new ApiError("RATE_LIMIT", "Your account is still being prepared. Please wait a moment.");

    if (!u.near_account_id) {
      const key = generateKey();
      try {
        const enc = deps.custody.encrypt(u.id, key.seed);
        u = await deps.repo.claimAccount(u.id, playerAccountId(deps.rootAccountId), {
          public_key: key.publicKey, enc_private_key: enc.enc_private_key, nonce: enc.nonce, key_version: enc.key_version,
        });
      } finally {
        key.seed.fill(0);
      }
    }
    const row = await deps.repo.getCustody(u.id);
    if (!u.near_account_id || !row) throw new ApiError("INTERNAL", "Something went wrong. Please try again.");

    try {
      if (u.account_status === "PENDING" || u.account_status === "NONE") {
        await deps.contract.createPlayerAccount(u.near_account_id, row.public_key);
        await deps.repo.setAccountStatus(u.id, "CREATED");
        u = { ...u, account_status: "CREATED" };
      }
      if (u.account_status === "CREATED") {
        await deps.relayer.submit(u, "register", {});
        await deps.repo.setAccountStatus(u.id, "REGISTERED");
        u = { ...u, account_status: "REGISTERED" };
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      deps.log.error("account provisioning failed:", e);
      throw new ApiError("INTERNAL", "Something went wrong. Please try again.");
    }
    return u;
  }

  return { ensure: (user) => lock.run(user.id, () => run(user)) };
}
