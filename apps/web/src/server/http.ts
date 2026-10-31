// Route wrappers. Every handler returns ApiResult<T> as JSON.
//
// POST pipeline (master plan 6.4b), in this order:
//   same-origin -> session (UNAUTHENTICATED) -> Idempotency-Key present -> zod body (BAD_REQUEST)
//   -> PAUSE_ALL + mode gate -> rate limit (30/min/user) -> idempotency (stored response replay)
//   -> custodial account -> action -> store response.

import { createHash } from "node:crypto";
import type { ApiResult, ErrorCode } from "@caravan/shared";
import type { ZodType } from "zod";
import type { UserRow } from "./db/repo";
import { ApiError, fail, HTTP_STATUS, ok } from "./errors";
import { resolveUser } from "./guards/auth";
import { LIMITS } from "./guards/rateLimit";
import { assertContractMode, checkMode, checkNotPaused, type ModeRule } from "./guards/mode";
import { log } from "./log";
import { isSameOrigin } from "./guards/origin";
import { cronAuthorized } from "./guards/cron";
import { getServices, type Services } from "./services";
import type { TxOutcome } from "./contract/types";

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function respond<T>(result: ApiResult<T>, extra: Record<string, string> = {}): Response {
  const status = result.ok ? 200 : HTTP_STATUS[result.error.code];
  const headers: Record<string, string> = { ...HEADERS, ...extra };
  if (!result.ok && result.error.code === "RATE_LIMIT") headers["retry-after"] = "30";
  return Response.json(result, { status, headers });
}

function toResult(e: unknown, svc?: Services): ApiResult<never> {
  if (e instanceof ApiError) return fail(e.code, e.message);
  (svc?.log ?? log).error("unhandled route error:", e instanceof Error ? e : "unknown"); // redacted by the logger
  return fail("INTERNAL", "Something went wrong. Please try again.");
}

const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("BAD_REQUEST", "Body must be valid JSON.");
  }
}

function parseWith<B>(schema: ZodType<B> | undefined, raw: unknown): B {
  if (!schema) return {} as B;
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new ApiError("BAD_REQUEST", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ").slice(0, 300));
  }
  return r.data;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export interface ActionCtx<B> {
  svc: Services;
  user: UserRow;
  body: B;
  /** Records the transaction hash of the action for the actions table. */
  noteTx(outcome: TxOutcome): void;
}

export interface PostSpec<B, T> {
  kind: string;
  schema?: ZodType<B>;
  mode?: ModeRule;
  /** Skip the custodial account creation (never needed for game actions). */
  run(ctx: ActionCtx<B>): Promise<T>;
  /** Called after a successful run (cache invalidation). */
  onSuccess?(svc: Services): void;
}

export function postRoute<B, T>(spec: PostSpec<B, T>): (req: Request) => Promise<Response> {
  return async (req) => {
    let svc: Services | undefined;
    let actionId: number | null = null;
    let txHash: string | null = null;
    try {
      svc = await getServices();
      if (!isSameOrigin(req)) throw new ApiError("BAD_REQUEST", "Cross-origin requests are not allowed.");
      const session = await svc.session(req);
      if (!session) throw new ApiError("UNAUTHENTICATED", "Please sign in.");
      const key = req.headers.get("idempotency-key");
      if (!key || !KEY_RE.test(key)) throw new ApiError("BAD_REQUEST", "A valid Idempotency-Key header is required.");
      const body = parseWith(spec.schema, await readBody(req));

      const now = svc.now();
      let user = await resolveUser(svc.repo, session, now);
      await checkNotPaused(svc.repo, svc.mode);
      checkMode(svc.mode, spec.mode ?? "ANY");
      if (spec.mode && spec.mode !== "ANY") await assertContractMode(svc); // GAME_MODE must match the contract

      const rate = await svc.limiter.hit(`user:${user.id}:actions`, LIMITS.USER_ACTIONS_PER_MINUTE, 60);
      if (!rate.allowed) throw new ApiError("RATE_LIMIT", "Too many actions. Slow down a little.");

      const requestJson = canonical(body);
      const requestHash = sha(`${spec.kind}\n${requestJson}`);
      const begun = await svc.repo.beginAction({ userId: user.id, kind: spec.kind, key, requestJson, requestHash, now });
      if (begun.state === "existing") {
        const row = begun.row;
        if (row.request_hash !== requestHash) {
          throw new ApiError("BAD_REQUEST", "This Idempotency-Key was already used for a different request.");
        }
        if (row.status === "PENDING" || !row.response_json) {
          throw new ApiError("RATE_LIMIT", "This request is still being processed. Try again in a moment.");
        }
        return respond(JSON.parse(row.response_json) as ApiResult<T>, { "idempotent-replay": "true" });
      }
      actionId = begun.id;

      let result: ApiResult<T>;
      let errorCode: ErrorCode | null = null;
      try {
        user = await svc.accounts.ensure(user);
        const data = await spec.run({ svc, user, body, noteTx: (o) => { txHash = o.txHash; } });
        result = ok(data);
        spec.onSuccess?.(svc);
      } catch (e) {
        const r = toResult(e, svc);
        result = r;
        errorCode = r.ok ? null : r.error.code;
      }
      await svc.repo.finishAction(actionId, {
        status: result.ok ? "OK" : "FAILED", txHash, errorCode, responseJson: JSON.stringify(result), now: svc.now(),
      });
      return respond(result);
    } catch (e) {
      const r = toResult(e, svc);
      if (actionId !== null && svc) {
        await svc.repo
          .finishAction(actionId, { status: "FAILED", txHash, errorCode: r.ok ? null : r.error.code, responseJson: JSON.stringify(r), now: svc.now() })
          .catch(() => undefined);
      }
      return respond(r);
    }
  };
}

export interface GetCtx {
  svc: Services;
  req: Request;
  /** null when signed out or when auth is not required. */
  user: UserRow | null;
}

export interface GetSpec<T> {
  /** "required": 401 when signed out. "optional": user may be null. "none": session is not read. */
  auth: "required" | "optional" | "none";
  /** Create the custodial account on first use when signed in. */
  provision?: boolean;
  run(ctx: GetCtx): Promise<T>;
}

/**
 * Client identity for unauthenticated rate limiting. Never the left-most X-Forwarded-For entry (the client
 * controls it): use the platform-set header when present, else the right-most hop, which the nearest trusted
 * proxy appended. Deploy behind exactly one trusted proxy (Vercel sets x-vercel-forwarded-for).
 */
export function trustedClientIp(req: Request): string {
  const platform = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (platform) return platform;
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean) ?? [];
  return hops[hops.length - 1] ?? "unknown";
}

function clientKey(req: Request): string {
  return `ip:${sha(trustedClientIp(req)).slice(0, 16)}`;
}

export function getRoute<T>(spec: GetSpec<T>): (req: Request) => Promise<Response> {
  return async (req) => {
    let svc: Services | undefined;
    try {
      svc = await getServices();
      let user: UserRow | null = null;
      if (spec.auth !== "none") {
        const session = await svc.session(req);
        if (!session && spec.auth === "required") throw new ApiError("UNAUTHENTICATED", "Please sign in.");
        if (session) user = await resolveUser(svc.repo, session, svc.now());
      }
      if (!user) {
        // One shared bucket for all anonymous clients bounds the number of rate_limits rows an attacker can create.
        const all = await svc.limiter.hit("anon:reads", LIMITS.ANON_READS_PER_MINUTE_GLOBAL, 60);
        if (!all.allowed) throw new ApiError("RATE_LIMIT", "Too many requests.");
      }
      const rate = await svc.limiter.hit(user ? `user:${user.id}:reads` : `${clientKey(req)}:reads`, LIMITS.READS_PER_MINUTE, 60);
      if (!rate.allowed) throw new ApiError("RATE_LIMIT", "Too many requests.");
      if (user && spec.provision) {
        try {
          user = await svc.accounts.ensure(user);
        } catch (e) {
          // Paused, busy or backing off: still serve the world, just without a player view yet.
          if (!(e instanceof ApiError && (e.code === "PAUSED" || e.code === "RATE_LIMIT"))) throw e;
        }
      }
      return respond(ok(await spec.run({ svc, req, user })));
    } catch (e) {
      return respond(toResult(e, svc));
    }
  };
}

/** Cron routes: bearer CRON_SECRET only; GET and POST both accepted. */
export function cronRoute<T>(run: (svc: Services) => Promise<T>): (req: Request) => Promise<Response> {
  return async (req) => {
    let svc: Services | undefined;
    try {
      svc = await getServices();
      if (!cronAuthorized(req, svc.cronSecret)) throw new ApiError("UNAUTHENTICATED", "Unauthorized.");
      return respond(ok(await run(svc)));
    } catch (e) {
      return respond(toResult(e, svc));
    }
  };
}
