// Production wiring from environment variables (names in .env.example). Loaded lazily by
// getServices(), so importing routes never needs a database or keys.

import { loadEnv } from "./env";
import { createPgDb } from "./db/pg";
import { NearContract } from "./contract/near";
import { createIntentsClient } from "./intents/create";
import { authSession } from "./auth/config";
import { buildServices, type Services } from "./services";

export async function createProductionServices(): Promise<Services> {
  const env = loadEnv();
  const contract = new NearContract({
    network: env.NEAR_NETWORK, rpcUrl: env.NEAR_RPC_URL, contractId: env.CARAVAN_CONTRACT_ID,
    relayerAccountId: env.RELAYER_ACCOUNT_ID, relayerPrivateKey: env.RELAYER_PRIVATE_KEY,
    operatorAccountId: env.OPERATOR_ACCOUNT_ID, operatorPrivateKey: env.OPERATOR_PRIVATE_KEY,
  });
  return buildServices({
    mode: env.GAME_MODE, cronSecret: env.CRON_SECRET, db: createPgDb(env.DATABASE_URL), contract,
    encSecret: env.KEY_ENC_SECRET,
    // 1Click client (Phase 7). Stays `unconfigured` (money routes closed) unless LIVE + mainnet and every variable is set.
    intents: createIntentsClient(env),
    session: authSession,
    relayerAccountId: env.RELAYER_ACCOUNT_ID,
    treasuryAccountId: env.TREASURY_ACCOUNT_ID ?? null,
  });
}
