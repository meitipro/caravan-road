// Minimal HTTP layer for the 1Click API: timeouts, bounded bodies, retries on safe GETs only, and a
// credential that can never leak (it lives in a #private field and is stripped from every message).
//
// Auth header: https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md
//   "send it as `X-API-Key` on API requests. `Authorization: Bearer` is also accepted for the same partner JWT."
// (The OpenAPI document marks X-API-Key as recommended and the Bearer scheme as legacy.)

import { redact } from "../log";
import { ErrorBodySchema } from "./schemas";

export type OneClickErrorKind =
  | "config" // our configuration is unusable (fail closed)
  | "network" // could not reach the provider
  | "timeout"
  | "http" // non-2xx answer
  | "parse" // not JSON
  | "schema" // JSON that does not match the documented shape
  | "too_large"
  | "rejected"; // answer is valid but fails one of our own safety checks

export class OneClickError extends Error {
  constructor(
    public readonly kind: OneClickErrorKind,
    message: string,
    /** HTTP status when the provider answered. */
    public readonly status: number | null = null,
    /** Sanitised `message` field of the provider's error body (<= 200 chars). */
    public readonly providerMessage: string | null = null,
  ) {
    super(message);
    this.name = "OneClickError";
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpOptions {
  baseUrl: string;
  jwt: string;
  authHeader: "x-api-key" | "bearer";
  fetchImpl: FetchLike;
  timeoutMs: number;
  /** Extra attempts for GET requests only. POST is never retried. */
  maxRetries: number;
  retryBaseMs: number;
  sleep: (ms: number) => Promise<void>;
  maxBodyBytes: number;
}

export const DEFAULT_BASE_URL = "https://1click.chaindefuser.com"; // OpenAPI `servers[0].url`

const RETRYABLE_STATUS = (s: number): boolean => s === 429 || (s >= 500 && s <= 599);

export class OneClickHttp {
  readonly #jwt: string;
  readonly #base: string;

  private readonly o: Omit<HttpOptions, "jwt">; // the credential is deliberately not kept here

  constructor(opts: HttpOptions) {
    const { jwt, ...o } = opts;
    this.o = o;
    if (!jwt) throw new OneClickError("config", "1Click credential is missing");
    let u: URL;
    try {
      u = new URL(o.baseUrl);
    } catch {
      throw new OneClickError("config", "1Click base URL is invalid");
    }
    if (u.protocol !== "https:" || u.username || u.password) throw new OneClickError("config", "1Click base URL must be plain https");
    this.#jwt = jwt;
    this.#base = u.origin;
  }

  // Printing the client (console.log, JSON.stringify, util.inspect) must not reveal anything.
  toJSON(): string {
    return "[OneClickHttp]";
  }

  /** Strips the credential (even if the provider echoes it), control characters and secrets patterns. */
  scrub(text: string): string {
    let t = text;
    if (this.#jwt.length >= 8) t = t.split(this.#jwt).join("[token]");
    t = t.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return redact(t).slice(0, 200);
  }

  async get(path: string, query: Record<string, string> = {}, allowStatus: number[] = []): Promise<{ status: number; body: unknown }> {
    const qs = new URLSearchParams(query).toString();
    return this.request("GET", qs ? `${path}?${qs}` : path, undefined, allowStatus, this.o.maxRetries);
  }

  async post(path: string, body: unknown, allowStatus: number[] = []): Promise<{ status: number; body: unknown }> {
    return this.request("POST", path, JSON.stringify(body), allowStatus, 0);
  }

  private headers(hasBody: boolean): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    if (hasBody) h["content-type"] = "application/json";
    if (this.o.authHeader === "bearer") h.authorization = `Bearer ${this.#jwt}`;
    else h["x-api-key"] = this.#jwt;
    return h;
  }

  private async request(
    method: "GET" | "POST", pathAndQuery: string, body: string | undefined, allowStatus: number[], retries: number,
  ): Promise<{ status: number; body: unknown }> {
    let lastErr: OneClickError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await this.o.sleep(this.o.retryBaseMs * 2 ** (attempt - 1));
      try {
        return await this.once(method, pathAndQuery, body, allowStatus);
      } catch (e) {
        if (!(e instanceof OneClickError)) throw e;
        lastErr = e;
        const retryable = e.kind === "network" || e.kind === "timeout" || (e.kind === "http" && e.status !== null && RETRYABLE_STATUS(e.status));
        if (!retryable) throw e;
      }
    }
    throw lastErr ?? new OneClickError("network", "1Click request failed");
  }

  private async once(method: "GET" | "POST", pathAndQuery: string, body: string | undefined, allowStatus: number[]): Promise<{ status: number; body: unknown }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
    let res: Response;
    let text: string;
    try {
      try {
        res = await this.o.fetchImpl(`${this.#base}${pathAndQuery}`, {
          method, headers: this.headers(body !== undefined), body, signal: ctl.signal,
          redirect: "error", // never forward the credential to another host
          cache: "no-store",
        });
        const len = Number(res.headers.get("content-length") ?? "0");
        if (Number.isFinite(len) && len > this.o.maxBodyBytes) throw new OneClickError("too_large", "1Click answer is too large", res.status);
        text = await res.text();
      } catch (e) {
        if (e instanceof OneClickError) throw e;
        if (ctl.signal.aborted) throw new OneClickError("timeout", "1Click request timed out");
        throw new OneClickError("network", "1Click is unreachable");
      }
    } finally {
      clearTimeout(timer);
    }
    if (text.length > this.o.maxBodyBytes) throw new OneClickError("too_large", "1Click answer is too large", res.status);

    let json: unknown = undefined;
    let parsed = true;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        parsed = false;
      }
    }

    if (res.status >= 200 && res.status < 300) {
      if (!parsed || text.length === 0) throw new OneClickError("parse", "1Click answer is not JSON", res.status);
      return { status: res.status, body: json };
    }
    if (allowStatus.includes(res.status)) return { status: res.status, body: json };

    // Error body: { message } (BadRequestResponse); anything else is ignored.
    let providerMessage: string | null = null;
    const eb = ErrorBodySchema.safeParse(json);
    if (eb.success) providerMessage = this.scrub(eb.data.message) || null;
    throw new OneClickError("http", `1Click answered HTTP ${res.status}`, res.status, providerMessage);
  }
}
