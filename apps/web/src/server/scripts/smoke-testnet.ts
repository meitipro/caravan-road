// Testnet smoke run for Mahdi (needs real values in .env.local and a deployed contract):
//   pnpm --filter @caravan/web smoke:testnet
// It signs in a synthetic test user at the service level (no OAuth), creates the custodial account,
// claims the faucet and buys grain. It prints PASS/FAIL lines only, never keys, ids or balances.
// GAME_MODE must be PLAY. It creates one real testnet account the first time it runs.

import { loadEnv } from "../env";
import { createProductionServices } from "../services.prod";

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    console.warn(`PASS ${name}`);
    return true;
  } catch (e) {
    console.warn(`FAIL ${name}: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
    return false;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.GAME_MODE !== "PLAY" || env.NEAR_NETWORK !== "testnet") throw new Error("smoke test needs GAME_MODE=PLAY and NEAR_NETWORK=testnet");
  const svc = await createProductionServices();
  const user = await svc.repo.upsertUser({
    id: crypto.randomUUID(), provider: "smoke", subject: "smoke-user", email: null, name: "Smoke Tester", now: svc.now(),
  });
  let ready = user;
  let ok = await step("account created and registered", async () => { ready = await svc.accounts.ensure(user); });
  ok = (await step("faucet", async () => {
    await svc.relayer.submit(ready, "faucet", {}).catch((e: { code?: string }) => { if (e.code !== "RATE_LIMIT") throw e; });
  })) && ok;
  ok = (await step("buy 1 grain in bandar", async () => {
    await svc.relayer.submit(ready, "trade", { merchant: "bandar", good: "grain", side: "buy", qty: 1, limit_total: "100000" });
  })) && ok;
  ok = (await step("player view readable", async () => {
    if (!(await svc.contract.getPlayer(ready.near_account_id!))) throw new Error("player not found");
  })) && ok;
  process.exit(ok ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "smoke failed");
  process.exit(1);
});
