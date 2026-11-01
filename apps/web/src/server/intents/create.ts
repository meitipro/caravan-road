// Builds the production IntentsClient from the environment. Fails CLOSED: anything missing, or any mode
// other than LIVE on mainnet, yields the `unconfigured` client (configured = false), which the money
// routes already treat as "closed". Only variable NAMES are ever logged.
//
// Variables: ONECLICK_JWT, TREASURY_ACCOUNT_ID, TREASURY_PRIVATE_KEY, NEAR_RPC_URL (mainnet) are read by
// env.ts; ONECLICK_USDC_ASSET_ID (the assetId of USDC on NEAR, copied by the operator from GET /v0/tokens)
// is read here because env.ts is outside this component (see OPEN_ISSUES.md).

import type { ServerEnv } from "../env";
import { log as defaultLog, type Logger } from "../log";
import { OneClickIntents, type OneClickConfig } from "./oneclick";
import { NearTreasury, type TreasuryChain } from "./treasury";
import type { IntentsClient } from "./types";
import { unconfiguredIntents } from "./unconfigured";

export interface CreateIntentsOptions {
  /** Extra variables not in ServerEnv (defaults to process.env). */
  source?: Record<string, string | undefined>;
  log?: Logger;
  /** Test seams. */
  treasury?: TreasuryChain;
  overrides?: Partial<OneClickConfig>;
}

type Needed = Pick<ServerEnv, "GAME_MODE" | "NEAR_NETWORK" | "NEAR_RPC_URL" | "ONECLICK_JWT" | "TREASURY_ACCOUNT_ID" | "TREASURY_PRIVATE_KEY">;

export function createIntentsClient(env: Needed, opts: CreateIntentsOptions = {}): IntentsClient {
  const lg = opts.log ?? defaultLog;
  const usdcAssetId = (opts.source ?? process.env).ONECLICK_USDC_ASSET_ID || undefined;

  if (env.GAME_MODE !== "LIVE" || env.NEAR_NETWORK !== "mainnet") return unconfiguredIntents; // PLAY: money routes are closed anyway

  const missing: string[] = [];
  if (!env.ONECLICK_JWT) missing.push("ONECLICK_JWT");
  if (!env.TREASURY_ACCOUNT_ID) missing.push("TREASURY_ACCOUNT_ID");
  if (!env.TREASURY_PRIVATE_KEY && !opts.treasury) missing.push("TREASURY_PRIVATE_KEY");
  if (!env.NEAR_RPC_URL && !opts.treasury) missing.push("NEAR_RPC_URL");
  if (!usdcAssetId) missing.push("ONECLICK_USDC_ASSET_ID");
  if (missing.length > 0) {
    lg.warn(`Deposits and withdrawals stay closed: missing ${missing.join(", ")}`);
    return unconfiguredIntents;
  }

  try {
    const treasury = opts.treasury ?? new NearTreasury({ accountId: env.TREASURY_ACCOUNT_ID!, privateKey: env.TREASURY_PRIVATE_KEY!, rpcUrl: env.NEAR_RPC_URL! });
    return new OneClickIntents({
      jwt: env.ONECLICK_JWT!, usdcAssetId: usdcAssetId!, treasuryAccountId: env.TREASURY_ACCOUNT_ID!, treasury, log: lg, ...opts.overrides,
    });
  } catch {
    lg.error("Deposits and withdrawals stay closed: the 1Click/treasury configuration is invalid");
    return unconfiguredIntents;
  }
}
