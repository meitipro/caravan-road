// Shared test harness: PGlite database, FakeContract, FakeIntents, a stubbed session (the
// `x-test-user` header names the signed-in user) and a manual clock. The encryption secret is
// generated inside each kit; no real key or secret exists anywhere in the tests.

import { randomBytes } from "node:crypto";
import type { Mode } from "@caravan/shared";
import { FakeContract, type FakeContractOptions } from "../contract/fake";
import { createPgliteDb } from "../db/pglite";
import { migrate } from "../db/migrate";
import type { Db } from "../db/types";
import type { SessionUser } from "../guards/auth";
import { FakeIntents } from "../intents/fake";
import { silentLog } from "../log";
import { buildServices, setServices, type Services } from "../services";

export const CRON_SECRET_FOR_TESTS = "test-cron-secret-not-real";
export const START_TIME = 1_800_000_000; // a Friday in 2027; arbitrary and fixed

export interface Kit {
  svc: Services;
  db: Db;
  contract: FakeContract;
  intents: FakeIntents;
  clock: { now: number; advance(seconds: number): void };
  encSecret: Uint8Array;
  close(): Promise<void>;
}

export async function makeKit(opts: { mode?: Mode; contract?: FakeContractOptions } = {}): Promise<Kit> {
  const clock = { now: START_TIME, advance(s: number) { this.now += s; } };
  const now = () => clock.now;
  const db = await createPgliteDb();
  await migrate(db);
  const contract = new FakeContract({ mode: opts.mode ?? "PLAY", now, ...opts.contract });
  const intents = new FakeIntents(now);
  const encSecret = new Uint8Array(randomBytes(32));
  const session = async (req: Request): Promise<SessionUser | null> => {
    const who = req.headers.get("x-test-user");
    if (!who) return null;
    return { provider: "test", subject: who, email: null, name: who[0]!.toUpperCase() + who.slice(1) };
  };
  const svc = buildServices({
    mode: opts.mode ?? "PLAY", cronSecret: CRON_SECRET_FOR_TESTS, now, log: silentLog, db, contract, encSecret, intents, session,
    relayerAccountId: "relayer.fake", treasuryAccountId: "treasury.fake",
  });
  setServices(svc);
  return {
    svc, db, contract, intents, clock, encSecret,
    async close() {
      setServices(null);
      await db.close();
    },
  };
}

let keyCounter = 0;
export const newKey = (): string => `test-key-${++keyCounter}-${Math.random().toString(36).slice(2, 10)}`;

type Handler = (req: Request) => Promise<Response>;

export interface CallOpts {
  user?: string | null;
  key?: string | null;
  headers?: Record<string, string>;
  query?: string;
}

export async function call(handler: Handler, method: "GET" | "POST", path: string, body?: unknown, o: CallOpts = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(o.headers ?? {}) };
  if (o.user !== null && o.user !== undefined) headers["x-test-user"] = o.user;
  if (method === "POST") {
    headers["content-type"] = "application/json";
    if (o.key !== null) headers["idempotency-key"] = o.key ?? newKey();
  }
  const req = new Request(`http://localhost${path}${o.query ?? ""}`, {
    method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await handler(req);
  const json = (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string } };
  return { status: res.status, json, headers: res.headers };
}

export const post = (h: Handler, path: string, body: unknown, o: CallOpts = {}) => call(h, "POST", path, body, o);
export const get = (h: Handler, path: string, o: CallOpts = {}) => call(h, "GET", path, undefined, o);

/** Signs `user` in (creates the custodial account via /api/state) and returns the account id. */
export async function signIn(kit: Kit, stateHandler: Handler, user: string): Promise<string> {
  const r = await get(stateHandler, "/api/state", { user });
  if (!r.json.ok || !r.json.data.me) throw new Error("sign-in failed in test harness");
  return r.json.data.me.account_id as string;
}
