// Service container. Route handlers call getServices(); tests call setServices() with a container
// built from FakeContract, FakeIntents, PGlite and a stub session (see __tests__/testkit.ts).
// Nothing is created at import time, so `next build` needs no environment.

import type { Mode } from "@caravan/shared";
import type { ContractClient } from "./contract/types";
import type { Db } from "./db/types";
import { createRepo, type Repo } from "./db/repo";
import { createRateLimiter, type RateLimiter } from "./guards/rateLimit";
import type { SessionResolver } from "./guards/auth";
import type { IntentsClient } from "./intents/types";
import { log, type Logger } from "./log";
import { assertDevFlagsSafe, isDevBackend } from "./dev/flags";
import { createAccountService, type AccountService } from "./near/accounts";
import { Custody } from "./near/custody";
import { createRelayer, type Relayer } from "./near/relayer";

export class TtlCache<T> {
  private entry: { at: number; value: T } | null = null;
  private inflight: Promise<T> | null = null;
  constructor(private readonly ttlSeconds: number, private readonly now: () => number) {}
  async get(load: () => Promise<T>): Promise<T> {
    const t = this.now();
    if (this.entry && t - this.entry.at < this.ttlSeconds) return this.entry.value;
    if (this.inflight) return this.inflight;
    this.inflight = load()
      .then((value) => {
        this.entry = { at: this.now(), value };
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
  invalidate(): void {
    this.entry = null;
  }
}

export interface Services {
  mode: Mode;
  cronSecret: string | null;
  /** Unix seconds. */
  now: () => number;
  log: Logger;
  repo: Repo;
  contract: ContractClient;
  custody: Custody;
  relayer: Relayer;
  accounts: AccountService;
  limiter: RateLimiter;
  intents: IntentsClient;
  session: SessionResolver;
  relayerAccountId: string;
  treasuryAccountId: string | null;
  worldCache: TtlCache<unknown>;
  leaderboardCache: TtlCache<unknown>;
  configCache: TtlCache<unknown>;
}

export interface ServiceDeps {
  mode: Mode;
  cronSecret: string | null;
  now?: () => number;
  log?: Logger;
  db: Db;
  contract: ContractClient;
  encSecret: Uint8Array;
  intents: IntentsClient;
  session: SessionResolver;
  relayerAccountId: string;
  treasuryAccountId?: string | null;
}

/** Wires the container from its parts (used by production and by tests). */
export function buildServices(d: ServiceDeps): Services {
  const now = d.now ?? (() => Math.floor(Date.now() / 1000));
  const lg = d.log ?? log;
  const repo = createRepo(d.db);
  const custody = Custody.fromSecret(d.encSecret);
  const limiter = createRateLimiter(repo, now);
  const relayer = createRelayer({ repo, contract: d.contract, custody, limiter, log: lg });
  const accounts = createAccountService({
    repo, contract: d.contract, custody, relayer, rootAccountId: d.relayerAccountId, log: lg, limiter, mode: d.mode,
  });
  return {
    mode: d.mode, cronSecret: d.cronSecret, now, log: lg, repo, contract: d.contract, custody, relayer, accounts, limiter,
    intents: d.intents, session: d.session, relayerAccountId: d.relayerAccountId,
    treasuryAccountId: d.treasuryAccountId ?? null,
    worldCache: new TtlCache(1, now), leaderboardCache: new TtlCache(5, now), configCache: new TtlCache(30, now),
  };
}

// The container lives on globalThis: in `next dev` every route bundle has its own copy of this module, and the dev
// backend (database file, ticker) must exist exactly once.
interface Holder { __caravanServices?: Services | null; __caravanCreating?: Promise<Services> | null }
const G = globalThis as Holder;

export function setServices(s: Services | null): void {
  G.__caravanServices = s;
  G.__caravanCreating = null;
}

export async function getServices(): Promise<Services> {
  if (G.__caravanServices) return G.__caravanServices;
  if (!G.__caravanCreating) {
    assertDevFlagsSafe(process.env); // startup refusal: DEV_LOGIN / SERVER_BACKEND=dev in production or outside PLAY
    const make = isDevBackend(process.env)
      ? import("./services.dev").then((m) => m.createDevServices())
      : import("./services.prod").then((m) => m.createProductionServices());
    G.__caravanCreating = make.then((s) => {
      G.__caravanServices = s;
      return s;
    });
    G.__caravanCreating.catch(() => {
      G.__caravanCreating = null;
    });
  }
  return G.__caravanCreating;
}
