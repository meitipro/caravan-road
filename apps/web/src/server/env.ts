// Typed environment loader. Fails fast on missing or malformed variables and reports only their
// NAMES, never their values. Nothing is read at import time: call loadEnv() when services start,
// so `next build` works without any secrets.

import { z } from "zod";

const nonEmpty = z.string().min(1);

/**
 * KEY_ENC_SECRET: 32 random bytes as exactly 64 hex characters, or as canonical base64 (44 chars with
 * padding that round-trips). A passphrase is rejected: lenient base64 decoding would accept one.
 */
export function decodeEncSecret(raw: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return new Uint8Array(Buffer.from(raw, "hex"));
  if (raw.length === 44 && /^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length === 32 && bytes.toString("base64") === raw) return new Uint8Array(bytes);
  }
  throw new Error("KEY_ENC_SECRET must be 32 random bytes as 64 hex characters or canonical base64");
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
  // Optional in PLAY (money routes are closed); in LIVE both are required together (checked in loadEnv).
  ONECLICK_JWT: nonEmpty.optional(),
  ONECLICK_USDC_ASSET_ID: z.string().regex(/^nep141:\S+$/, "must look like nep141:<contract>").optional(),
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
  // PLAY runs on testnet and LIVE on mainnet; a mix would point real-money routes at the wrong chain.
  if (parsed.success) {
    const { GAME_MODE, NEAR_NETWORK } = parsed.data;
    if ((GAME_MODE === "PLAY") !== (NEAR_NETWORK === "testnet")) {
      bad.add("GAME_MODE");
      bad.add("NEAR_NETWORK");
    }
    if (NEAR_NETWORK === "mainnet" && !parsed.data.NEAR_RPC_URL) bad.add("NEAR_RPC_URL");
    // LIVE needs the 1Click credential and the USDC asset id together; PLAY needs neither.
    if (GAME_MODE === "LIVE") {
      if (!parsed.data.ONECLICK_JWT) bad.add("ONECLICK_JWT");
      if (!parsed.data.ONECLICK_USDC_ASSET_ID) bad.add("ONECLICK_USDC_ASSET_ID");
    }
  }
  if (bad.size > 0 || !parsed.success || !secret) throw new EnvError([...bad].sort());
  return { ...parsed.data, KEY_ENC_SECRET: secret };
}

/** Per-mode helper used by the mode guard. */
export function isLive(env: Pick<ServerEnv, "GAME_MODE">): boolean {
  return env.GAME_MODE === "LIVE";
}
