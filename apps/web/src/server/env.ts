// Typed environment loader. Fails fast on missing or malformed variables and reports only their
// NAMES, never their values. Nothing is read at import time: call loadEnv() when services start,
// so `next build` works without any secrets.

import { z } from "zod";

const nonEmpty = z.string().min(1);

/** KEY_ENC_SECRET: 32 bytes encoded as 64 hex characters or base64 (44 chars with padding). */
export function decodeEncSecret(raw: string): Uint8Array {
  const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : null;
  const b64 = hex ? null : Buffer.from(raw, "base64");
  const bytes = hex ?? b64!;
  if (bytes.length !== 32) throw new Error("KEY_ENC_SECRET must decode to exactly 32 bytes (64 hex chars or base64)");
  return new Uint8Array(bytes);
}

const EnvSchema = z.object({
  GAME_MODE: z.enum(["PLAY", "LIVE"]),
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]),
  NEAR_RPC_URL: z.string().url().optional(),
  CARAVAN_CONTRACT_ID: nonEmpty,
  RELAYER_ACCOUNT_ID: nonEmpty,
  RELAYER_PRIVATE_KEY: nonEmpty,
  OPERATOR_ACCOUNT_ID: nonEmpty,
  OPERATOR_PRIVATE_KEY: nonEmpty,
  TREASURY_ACCOUNT_ID: nonEmpty.optional(),
  TREASURY_PRIVATE_KEY: nonEmpty.optional(),
  KEY_ENC_SECRET: nonEmpty,
  DATABASE_URL: nonEmpty,
  AUTH_SECRET: nonEmpty,
  CRON_SECRET: nonEmpty,
  ONECLICK_JWT: nonEmpty.optional(),
});

export type ServerEnv = Omit<z.infer<typeof EnvSchema>, "KEY_ENC_SECRET"> & { KEY_ENC_SECRET: Uint8Array };

export class EnvError extends Error {
  constructor(public readonly names: string[]) {
    super(`Invalid or missing environment variables: ${names.join(", ")}`);
    this.name = "EnvError";
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  // Empty strings count as missing (an unset line in .env.local).
  const cleaned: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) cleaned[k] = v === "" ? undefined : v;
  const parsed = EnvSchema.safeParse(cleaned);
  const bad = new Set<string>();
  if (!parsed.success) for (const i of parsed.error.issues) bad.add(String(i.path[0]));
  let secret: Uint8Array | null = null;
  if (cleaned.KEY_ENC_SECRET) {
    try {
      secret = decodeEncSecret(cleaned.KEY_ENC_SECRET);
    } catch {
      bad.add("KEY_ENC_SECRET");
    }
  }
  if (bad.size > 0 || !parsed.success || !secret) throw new EnvError([...bad].sort());
  return { ...parsed.data, KEY_ENC_SECRET: secret };
}

/** Per-mode helper used by the mode guard. */
export function isLive(env: Pick<ServerEnv, "GAME_MODE">): boolean {
  return env.GAME_MODE === "LIVE";
}
