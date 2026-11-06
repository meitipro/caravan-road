// Local end-to-end backend: the real route handlers on top of FakeContract (following
// contracts/caravan/DECISIONS.md), a PGlite database persisted under apps/web/.data (git-ignored), an in-process
// world ticker with a deterministic NPC stand-in, and a signed-cookie dev login. No chain, no Postgres server,
// no OAuth. Selected with SERVER_BACKEND=dev; refuses to start in production or outside PLAY mode.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FakeContract } from "./contract/fake";
import { createPgliteDb } from "./db/pglite";
import { migrate } from "./db/migrate";
import { assertDevFlagsSafe } from "./dev/flags";
import { devSessionResolver, getDevSecret } from "./dev/session";
import { startDevTicker } from "./dev/ticker";
import type { SessionResolver } from "./guards/auth";
import { unconfiguredIntents } from "./intents/unconfigured";
import { log as defaultLog, type Logger } from "./log";
import { buildServices, type Services } from "./services";

export interface DevBackendOptions {
  /** Directory for the database, contract snapshot and secrets. undefined: apps/web/.data; null: in memory, nothing persisted. */
  dataDir?: string | null;
  /** Clock in unix seconds (tests). */
  now?: () => number;
  /** World tick length; DEV_TICK_SECONDS, default 60. */
  tickSeconds?: number;
  /** Start the in-process ticker (default true). */
  startTicker?: boolean;
  /** Faucet cooldown in seconds. The contract uses 1 h; the dev default is 60 s so a tester is not stuck. */
  faucetCooldownSeconds?: number;
  log?: Logger;
  /** Overrides the dev-cookie session (tests). */
  session?: SessionResolver;
  env?: Record<string, string | undefined>;
}

export interface DevBackend {
  svc: Services;
  contract: FakeContract;
  /** Flushes the snapshot and stops the ticker. */
  stop(): Promise<void>;
}

export async function createDevBackend(opts: DevBackendOptions = {}): Promise<DevBackend> {
  const env = opts.env ?? process.env;
  assertDevFlagsSafe({ ...env, SERVER_BACKEND: "dev" });
  const log = opts.log ?? defaultLog;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const dataDir = opts.dataDir === undefined ? join(process.cwd(), ".data") : opts.dataDir;

  let snapshotFile: string | null = null;
  let dbDir: string | undefined;
  if (dataDir) {
    mkdirSync(dataDir, { recursive: true });
    // The data directory ignores itself, so it never reaches git whatever the repository's .gitignore says.
    if (!existsSync(join(dataDir, ".gitignore"))) writeFileSync(join(dataDir, ".gitignore"), "*\n");
    snapshotFile = join(dataDir, "dev-contract.json");
    dbDir = join(dataDir, "dev-db");
  }

  if (dataDir && env.DEV_RESET === "1") {
    // DEV_RESET=1: start from a fresh world (database and contract snapshot). Accounts and the dev secrets are kept
    // out of this: they are recreated on demand. Unset DEV_RESET afterwards or every restart wipes the world.
    rmSync(dbDir!, { recursive: true, force: true });
    rmSync(snapshotFile!, { force: true });
    log.warn("DEV_RESET=1: the dev world was reset");
  }

  const db = await createPgliteDb(dbDir);
  await migrate(db);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (snapshotFile) writeFileSync(snapshotFile, contract.snapshot());
  };
  const tickSeconds = opts.tickSeconds ?? (Number(env.DEV_TICK_SECONDS) >= 1 ? Math.floor(Number(env.DEV_TICK_SECONDS)) : 60);
  const contract: FakeContract = new FakeContract({
    mode: "PLAY", now, strict: true, tickSeconds, faucetCooldownSeconds: opts.faucetCooldownSeconds ?? 60,
    onChange: () => {
      if (!snapshotFile || timer) return;
      timer = setTimeout(() => { timer = null; flush(); }, 300);
      timer.unref?.();
    },
  });
  if (snapshotFile && existsSync(snapshotFile)) {
    try {
      contract.restore(readFileSync(snapshotFile, "utf8"));
    } catch {
      log.warn("dev contract snapshot could not be read; starting from a fresh world");
    }
  }

  const secretDir = dataDir ?? undefined;
  const svc = buildServices({
    mode: "PLAY", cronSecret: randomBytes(16).toString("hex"), now, log, db, contract,
    encSecret: loadOrCreateEncSecret(dataDir), intents: unconfiguredIntents,
    session: opts.session ?? devSessionResolver(() => getDevSecret(secretDir)),
    relayerAccountId: "relayer.dev", treasuryAccountId: null,
  });

  const stopTicker = opts.startTicker === false ? () => undefined : startDevTicker(contract, svc, tickSeconds);
  return {
    svc, contract,
    async stop() {
      stopTicker();
      if (timer) clearTimeout(timer);
      flush();
      await db.close();
    },
  };
}

/** The custody key of dev accounts: random, kept in the git-ignored data directory (or per process in memory). */
function loadOrCreateEncSecret(dataDir: string | null): Uint8Array {
  if (!dataDir) return new Uint8Array(randomBytes(32));
  const file = join(dataDir, "dev-enc-secret");
  if (existsSync(file)) return new Uint8Array(Buffer.from(readFileSync(file, "utf8").trim(), "hex"));
  const secret = randomBytes(32);
  writeFileSync(file, secret.toString("hex"), { mode: 0o600 });
  return new Uint8Array(secret);
}

/** Used by getServices() when SERVER_BACKEND=dev. */
export async function createDevServices(): Promise<Services> {
  return (await createDevBackend()).svc;
}
