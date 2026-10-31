// Typed environment, fail fast. Only env var NAMES appear in this repository; values come from the
// host's environment (spec 0.3 rule 5). Error messages list variable names, never values.

import { z } from "zod";
import type { CityId } from "@caravan/shared";

const nonEmpty = z.string().trim().min(1);
const keyString = z.string().trim().regex(/^ed25519:\S+$/, "must be an ed25519:<...> key string");
const positiveInt = z.coerce.number().int().positive();

const EnvSchema = z.object({
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEAR_RPC_URL: z.string().trim().url(),
  CARAVAN_CONTRACT_ID: nonEmpty,
  // public account ids of the four merchants
  MERCHANT_ACCOUNT_DASHT: nonEmpty,
  MERCHANT_ACCOUNT_MADAN: nonEmpty,
  MERCHANT_ACCOUNT_BANDAR: nonEmpty,
  MERCHANT_ACCOUNT_SHAHR: nonEmpty,
  // function-call keys, secret
  KEY_DASHT: keyString,
  KEY_MADAN: keyString,
  KEY_BANDAR: keyString,
  KEY_SHAHR: keyString,
  DATABASE_URL: nonEmpty,
  NEAR_AI_API_KEY: nonEmpty,
  NEAR_AI_MODEL: nonEmpty,
  NEAR_AI_BASE_URL: z.string().trim().url().optional(),
  NEAR_AI_RESPONSE_FORMAT: z.enum(["json_object"]).optional(),
  WORKER_PERIOD_SECONDS: positiveInt.default(60),
  WORKER_STAGGER_SECONDS: z.coerce.number().int().nonnegative().default(15),
  WORKER_ID: z.string().trim().min(1).default("worker-1"),
});

export interface WorkerConfig {
  network: "testnet" | "mainnet";
  rpcUrl: string;
  contractId: string;
  merchantAccounts: Record<CityId, string>;
  /** SECRET. Never log. */
  merchantKeys: Record<CityId, string>;
  databaseUrl: string;
  nearAi: { apiKey: string; model: string; baseUrl: string | undefined; responseFormat: "json_object" | undefined };
  periodSeconds: number;
  staggerSeconds: number;
  workerId: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid worker configuration: ${problems.join("; ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // only variable names and generic reasons: zod messages for these fields never echo the value
    const problems = parsed.error.issues.map((i) => {
      const name = i.path.join(".");
      return i.code === "invalid_type" && i.received === "undefined" ? `${name} is required` : `${name}: ${i.message}`;
    });
    throw new ConfigError(problems);
  }
  const e = parsed.data;
  return {
    network: e.NEAR_NETWORK,
    rpcUrl: e.NEAR_RPC_URL,
    contractId: e.CARAVAN_CONTRACT_ID,
    merchantAccounts: { dasht: e.MERCHANT_ACCOUNT_DASHT, madan: e.MERCHANT_ACCOUNT_MADAN, bandar: e.MERCHANT_ACCOUNT_BANDAR, shahr: e.MERCHANT_ACCOUNT_SHAHR },
    merchantKeys: { dasht: e.KEY_DASHT, madan: e.KEY_MADAN, bandar: e.KEY_BANDAR, shahr: e.KEY_SHAHR },
    databaseUrl: e.DATABASE_URL,
    nearAi: { apiKey: e.NEAR_AI_API_KEY, model: e.NEAR_AI_MODEL, baseUrl: e.NEAR_AI_BASE_URL, responseFormat: e.NEAR_AI_RESPONSE_FORMAT },
    periodSeconds: e.WORKER_PERIOD_SECONDS,
    staggerSeconds: e.WORKER_STAGGER_SECONDS,
    workerId: e.WORKER_ID,
  };
}

/** Safe-to-log summary: no keys, no API key, no database URL. */
export function describeConfig(c: WorkerConfig): Record<string, unknown> {
  return {
    network: c.network,
    contractId: c.contractId,
    merchantAccounts: c.merchantAccounts,
    model: c.nearAi.model,
    nearAiKey: "set",
    merchantKeys: "set",
    databaseUrl: "set",
    periodSeconds: c.periodSeconds,
    staggerSeconds: c.staggerSeconds,
    workerId: c.workerId,
  };
}
