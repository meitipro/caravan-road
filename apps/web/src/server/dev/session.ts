// Signed-cookie session for the dev backend (no OAuth). The cookie holds only the chosen display name and an
// HMAC; the secret is a random value kept in apps/web/.data (git-ignored) and never leaves the machine.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionResolver } from "../guards/auth";

export const DEV_COOKIE = "caravan_dev";
const G = globalThis as { __caravanDevSecret?: Buffer };

export function setDevSecret(secret: Buffer): void {
  G.__caravanDevSecret = secret;
}

export function getDevSecret(dataDir: string = join(process.cwd(), ".data")): Buffer {
  if (G.__caravanDevSecret) return G.__caravanDevSecret;
  const file = join(dataDir, "dev-secret");
  let secret: Buffer;
  if (existsSync(file)) secret = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  else {
    mkdirSync(dataDir, { recursive: true });
    secret = randomBytes(32);
    writeFileSync(file, secret.toString("hex"), { mode: 0o600 });
  }
  G.__caravanDevSecret = secret;
  return secret;
}

const sign = (secret: Buffer, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function makeDevCookieValue(secret: Buffer, name: string): string {
  const payload = Buffer.from(JSON.stringify({ name }), "utf8").toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function readDevCookie(secret: Buffer, cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== DEV_COOKIE) continue;
    const value = rest.join("=");
    const dot = value.lastIndexOf(".");
    if (dot < 1) return null;
    const payload = value.slice(0, dot);
    const given = Buffer.from(value.slice(dot + 1));
    const want = Buffer.from(sign(secret, payload));
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    try {
      const name = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { name?: unknown }).name;
      return typeof name === "string" && /^[A-Za-z0-9 _-]{1,24}$/.test(name) ? name : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function devSessionResolver(secret: () => Buffer): SessionResolver {
  return async (req) => {
    const name = readDevCookie(secret(), req.headers.get("cookie"));
    if (!name) return null;
    return { provider: "dev", subject: name.toLowerCase(), email: null, name };
  };
}
