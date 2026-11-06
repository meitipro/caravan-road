// Sandbox end-to-end test: the REAL code paths against a local NEAR node (near-sandbox), no fakes on the chain side.
//   1. scripts/setup-testnet.mjs `all` (accounts, merchant function-call keys, deploy + init, verify) with the root
//      account created in the sandbox genesis;
//   2. the server's route handlers with the real NearContract: custodial account creation, NEP-366 relayed player
//      calls (register, faucet, trade, stalls, journey), contract panics mapped to API error codes, event parsing,
//      the cron tick route, the operator pause;
//   3. the worker's NearChain adapter with the merchants' function-call keys (set_policy, world_tick);
//   4. the money invariant read back from the chain.
//
// Run (Linux x64/arm64 or macOS arm64; near-sandbox has no Windows binary):
//   (cd contracts/caravan && cargo build --target wasm32-unknown-unknown --release)
//   pnpm --filter @caravan/web test:sandbox
// The first run downloads the sandbox node (near-sandbox.tar.gz, about 36 MB, from the NEAR build bucket on S3).
// The default `pnpm test` never runs this file (vitest.config.ts excludes *.sandbox.test.ts).
// No real network, account or key is used: every key here is generated for the run and lives in a temp dir.
//
// APIs, verified 2026-11-06:
//  - near-sandbox@0.3.4 type definitions (dist/esm/index.d.mts): Sandbox.start({ config, version }), sandbox.rpcUrl,
//    sandbox.tearDown(), new GenesisAccount(accountId, publicKey, privateKey, balance), config.additionalAccounts.
//    Supported platforms (src/binary/binaryUtils.ts getPlatform): Linux x86_64 / aarch64, Darwin arm64.
//  - `sandbox_fast_forward` JSON-RPC ({ delta_height }): near-workspaces Worker::fast_forward docs, "the state being
//    forwarded in this case refers to time-related state (the block height, timestamp and epoch)". The test does not
//    assume how much time one block adds: it measures it and repeats until the chain clock passed the target.
//  - Sandbox version 2.14.0: the version testnet and mainnet ran on 2026-11-06 (RPC `status`: protocol 88). A wasm
//    built with rustc >= 1.87 needs protocol >= 84 (cargo-near-build BULK_MEMORY_PROTOCOL_VERSION).

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Account, JsonRpcProvider, KeyPair, teraToGas, type KeyPairString } from "near-api-js";
import { GenesisAccount, Sandbox } from "near-sandbox";
import { PlayerSchema, tradeCost, type CityId, type GoodId } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as faucetPOST } from "../../app/api/faucet/route";
import { POST as tradePOST } from "../../app/api/trade/route";
import { POST as journeyStartPOST } from "../../app/api/journey/start/route";
import { POST as journeyClaimPOST } from "../../app/api/journey/claim/route";
import { POST as stallCreatePOST } from "../../app/api/stall/create/route";
import { POST as stallBuyPOST } from "../../app/api/stall/buy/route";
import { POST as stallCancelPOST } from "../../app/api/stall/cancel/route";
import { GET as leaderboardGET } from "../../app/api/leaderboard/route";
import { GET as cronTickGET } from "../../app/api/cron/tick/route";
import { NearContract } from "../contract/near";
import { createPgliteDb } from "../db/pglite";
import { migrate } from "../db/migrate";
import type { Db } from "../db/types";
import type { SessionUser } from "../guards/auth";
import { FakeIntents } from "../intents/fake";
import { isContractPanic } from "../errors";
import { silentLog } from "../log";
import { buildServices, setServices, type Services } from "../services";
import { call, get, post } from "../__tests__/testkit";

const SANDBOX_VERSION = "2.14.0";
const ROOT = "caravan-sbx.testnet";
const ROOT_BALANCE = 100n * 10n ** 24n; // 100 NEAR; the setup plan needs about 18.6
const CRON_SECRET = "sandbox-cron-secret-not-real";
const STEP = 180_000;
const NS = 1_000_000_000n;

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const WASM = process.env.CARAVAN_SANDBOX_WASM ?? join(REPO_ROOT, "contracts", "caravan", "target", "wasm32-unknown-unknown", "release", "caravan.wasm");

const SUPPORTED = (platform() === "linux" && (arch() === "x64" || arch() === "arm64")) || (platform() === "darwin" && arch() === "arm64");
if (!SUPPORTED) console.warn(`chain.sandbox.test: skipped, near-sandbox has no binary for ${platform()}-${arch()} (Linux x64/arm64 and macOS arm64 only)`);

// Structural views of the plain-JS / other-package modules loaded at run time (kept loose on purpose: those
// modules are typechecked in their own packages).
interface SetupModule { main(argv: string[], deps: Record<string, unknown>): Promise<number> }
interface NearChainModule { createNearChain(cfg: { repoRoot: string; rpcUrl: string }): unknown }
interface EnvModule { parseEnvText(text: string): Map<string, string> }
interface WorkerChain {
  readSnapshot(): Promise<{ tick: number; merchants: Record<CityId, { treasury: bigint; policy: { spread_bp: number; bias_bp: number } }> }>;
  setPolicy(city: CityId, spreadBp: number, biasBp: number): Promise<{ txHash: string | null }>;
  worldTick(): Promise<{ txHash: string | null; skipped?: boolean }>;
}
interface WorkerChainModule { NearChain: new (cfg: Record<string, unknown>) => WorkerChain }

const importFile = <T>(...parts: string[]): Promise<T> => import(pathToFileURL(join(REPO_ROOT, ...parts)).href) as Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errCode = (r: { json: { ok: boolean; error?: { code: string } } }) => (r.json.ok ? "OK" : r.json.error?.code);

describe.skipIf(!SUPPORTED)("caravan contract on a local NEAR sandbox (real setup script, server and worker code)", () => {
  let sandbox: Sandbox;
  let tmp: string;
  let env: Map<string, string>;
  let provider: JsonRpcProvider;
  let svc: Services;
  let db: Db;
  let clockOffset = 0;
  const setupLog: string[] = [];
  const accountOf: Record<string, string> = {};

  const now = () => Math.floor(Date.now() / 1000) + clockOffset;
  const need = (name: string): string => {
    const v = env.get(name);
    if (!v) throw new Error(`setup did not write ${name} to the env file`);
    return v;
  };

  async function rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(sandbox.rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "sandbox-test", method, params }),
    });
    const j = (await res.json()) as { result?: T; error?: unknown };
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 400)}`);
    return j.result as T;
  }

  /** Moves the chain clock forward by at least `seconds` and re-syncs the server clock to it. */
  async function advanceChain(seconds: number): Promise<void> {
    const header = async () => (await rpc<{ header: { timestamp_nanosec: string; height: number } }>("block", { finality: "optimistic" })).header;
    const target = BigInt((await header()).timestamp_nanosec) + BigInt(seconds) * NS;
    let delta = Math.max(10, seconds);
    for (let i = 0; i < 40; i++) {
      const before = await header();
      if (BigInt(before.timestamp_nanosec) >= target) break;
      // One request at a time; retry once if the node is still busy with the previous one.
      for (let attempt = 0; ; attempt++) {
        try { await rpc("sandbox_fast_forward", { delta_height: delta }); break; } catch (e) { if (attempt >= 3) throw e; await sleep(1000); }
      }
      // Wait for the height jump itself (an ordinary new block 1 s later would also change the timestamp).
      let after = before;
      for (let w = 0; w < 600 && after.height < before.height + delta; w++) { await sleep(200); after = await header(); }
      const gained = BigInt(after.timestamp_nanosec) - BigInt(before.timestamp_nanosec);
      const blocks = BigInt(Math.max(1, after.height - before.height));
      const perBlock = gained / blocks;
      const remaining = target - BigInt(after.timestamp_nanosec);
      if (remaining <= 0n) break;
      delta = perBlock > 0n ? Math.min(100_000, Number(remaining / perBlock) + 5) : delta * 2;
    }
    const t = BigInt((await header()).timestamp_nanosec);
    if (t < target) throw new Error("sandbox_fast_forward did not move the block time far enough");
    clockOffset = Number(t / NS) - Math.floor(Date.now() / 1000);
  }

  const view = <T>(method: string, args: Record<string, unknown> = {}) =>
    provider.callFunction({ contractId: need("CARAVAN_CONTRACT_ID"), method, args }) as Promise<T>;
  const playerOf = async (user: string) => PlayerSchema.parse((await get(stateGET, "/api/state", { user })).json.data.me);

  beforeAll(async () => {
    if (!existsSync(WASM)) {
      throw new Error(`no wasm at ${WASM}. Build it first: (cd contracts/caravan && cargo build --target wasm32-unknown-unknown --release)`);
    }
    tmp = mkdtempSync(join(tmpdir(), "caravan-sandbox-"));

    // Root account in the genesis, with a key generated for this run only.
    const rootKey = KeyPair.fromRandom("ed25519");
    sandbox = await Sandbox.start({
      version: SANDBOX_VERSION,
      config: { additionalAccounts: [new GenesisAccount(ROOT, rootKey.getPublicKey().toString(), rootKey.toString(), ROOT_BALANCE)] },
    });
    provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
    const keyFile = join(tmp, "root-key.json");
    writeFileSync(keyFile, JSON.stringify({ account_id: ROOT, private_key: rootKey.toString() }), { mode: 0o600 });
    chmodSync(keyFile, 0o600);

    // 1. The owner's setup script, end to end, pointed at the sandbox (its https-only RPC check is bypassed by
    //    injecting the chain adapter; nothing else is replaced).
    const setup = await importFile<SetupModule>("scripts", "setup-testnet.mjs");
    const chainMod = await importFile<NearChainModule>("scripts", "lib", "near-chain.mjs");
    const envPath = join(tmp, "env.sandbox");
    const argv = ["all", "--env-file", envPath, ...(process.env.CARAVAN_SANDBOX_WASM ? ["--wasm", WASM] : ["--skip-build"])];
    const code = await setup.main(argv, {
      repoRoot: REPO_ROOT,
      processEnv: { ROOT_ACCOUNT_ID: ROOT, ROOT_KEY_FILE: keyFile },
      createChain: async () => chainMod.createNearChain({ repoRoot: REPO_ROOT, rpcUrl: sandbox.rpcUrl }),
      out: (l: string) => setupLog.push(l),
      err: (l: string) => setupLog.push(`ERR ${l}`),
    });
    if (code !== 0) throw new Error(`setup-testnet all exited ${code}:\n${setupLog.slice(-40).join("\n")}`);
    env = (await importFile<EnvModule>("scripts", "lib", "setup-env.mjs")).parseEnvText(readFileSync(envPath, "utf8"));

    // 2. The server with the real NearContract (PGlite instead of Postgres; the database is not under test here).
    db = await createPgliteDb();
    await migrate(db);
    const contract = new NearContract({
      network: "testnet", rpcUrl: sandbox.rpcUrl, contractId: need("CARAVAN_CONTRACT_ID"),
      relayerAccountId: need("RELAYER_ACCOUNT_ID"), relayerPrivateKey: need("RELAYER_PRIVATE_KEY"),
      operatorAccountId: need("OPERATOR_ACCOUNT_ID"), operatorPrivateKey: need("OPERATOR_PRIVATE_KEY"),
    });
    const session = async (req: Request): Promise<SessionUser | null> => {
      const who = req.headers.get("x-test-user");
      return who ? { provider: "sandbox", subject: who, email: null, name: who } : null;
    };
    svc = buildServices({
      mode: "PLAY", cronSecret: CRON_SECRET, now, log: silentLog, db, contract,
      encSecret: new Uint8Array(randomBytes(32)), intents: new FakeIntents(now), session,
      relayerAccountId: need("RELAYER_ACCOUNT_ID"), treasuryAccountId: null,
    });
    setServices(svc);
  }, 15 * 60_000);

  afterAll(async () => {
    setServices(null);
    await db?.close();
    await sandbox?.tearDown();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }, 120_000);

  it("setup: deployed, initialised in PLAY and verified; merchants hold function-call keys only", async () => {
    expect(setupLog.join("\n")).toMatch(/deployed and initialised/);
    const cfg = await view<Record<string, unknown>>("get_config");
    expect(cfg).toMatchObject({ mode: "PLAY", paused: false, owner: need("OWNER_ACCOUNT_ID"), operator: need("OPERATOR_ACCOUNT_ID") });
    expect(cfg.player_suffix).toBe(need("RELAYER_ACCOUNT_ID"));
    for (const city of ["dasht", "madan", "bandar", "shahr"]) {
      const id = need(`MERCHANT_ACCOUNT_${city.toUpperCase()}`);
      const keys = await provider.viewAccessKeyList({ accountId: id });
      const pk = KeyPair.fromString(need(`KEY_${city.toUpperCase()}`) as KeyPairString).getPublicKey().toString();
      const mine = keys.keys.find((k) => k.public_key === pk);
      expect(mine, `${city} key on chain`).toBeDefined();
      expect(typeof mine!.access_key.permission).toBe("object"); // FunctionCall, not "FullAccess"
    }
    // A secret written by the setup never shows up in its own log.
    expect(setupLog.join("\n")).not.toContain(need("RELAYER_PRIVATE_KEY"));
  }, STEP);

  it("sign-in creates the custodial account on chain and registers it with a relayed (NEP-366) call", async () => {
    for (const user of ["alice", "bob"]) {
      const me = await playerOf(user);
      accountOf[user] = me.account_id;
      expect(me.account_id.endsWith(`.${need("RELAYER_ACCOUNT_ID")}`)).toBe(true);
      expect(await view("get_player", { account_id: me.account_id })).toMatchObject({ account_id: me.account_id, location: "bandar", fils: "0" });
    }
    // The player account is a real account with the custodial key.
    await expect(provider.viewAccount({ accountId: accountOf.alice! })).resolves.toBeDefined();
  }, STEP);

  it("faucet: 500 dinars, emitted as an event the server parses from the receipt logs", async () => {
    for (const user of ["alice", "bob"]) {
      const r = await post(faucetPOST, "/api/faucet", {}, { user });
      expect(errCode(r)).toBe("OK");
      expect(r.json.data.player.fils).toBe("50000");
    }
    const events = await svc.contract.recentEvents(50);
    expect(events.filter((e) => e.event === "faucet").map((e) => e.data.account)).toEqual(expect.arrayContaining([accountOf.alice, accountOf.bob]));
    // A second claim is refused (net worth is now above 50 dinars; the contract also has a 1 h cooldown).
    expect(errCode(await post(faucetPOST, "/api/faucet", {}, { user: "alice" }))).toBe("BAD_REQUEST");
  }, STEP);

  it("trade: the chain charges exactly the shared tradeCost(); a too-low limit is SLIPPAGE", async () => {
    const m = await svc.contract.getMerchant("bandar");
    const qty = 10;
    const cost = tradeCost({ good: "grain", side: "buy", qty, merchantStock: m.stock.grain, spreadBp: m.spread_bp, biasBp: m.bias_bp });
    expect(errCode(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty, limit_total: "1" }, { user: "alice" }))).toBe("SLIPPAGE");

    const r = await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty, limit_total: (cost.total + cost.fee).toString() }, { user: "alice" });
    expect(errCode(r)).toBe("OK");
    expect(r.json.data.total).toBe(cost.total.toString());
    expect(r.json.data.fee).toBe(cost.fee.toString());
    const p = PlayerSchema.parse(r.json.data.player);
    expect(p.inventory.grain).toBe(qty);
    expect(BigInt(p.fils)).toBe(50000n - cost.total - cost.fee);
    expect((await svc.contract.getMerchant("bandar")).stock.grain).toBe(m.stock.grain - qty);
    const trades = (await svc.contract.recentEvents(50)).filter((e) => e.event === "trade");
    expect(trades.at(-1)?.data).toMatchObject({ account: accountOf.alice, good: "grain", side: "buy", qty, total: cost.total.toString() });
  }, STEP);

  it("stalls: create, buy (the seller pays the ceil 2% fee), cancel", async () => {
    const created = await post(stallCreatePOST, "/api/stall/create", { good: "grain", qty: 3, unit_price: "1500" }, { user: "alice" });
    expect(errCode(created)).toBe("OK");
    const stall = created.json.data.stall as { id: number };
    const aliceBefore = BigInt((await playerOf("alice")).fils);
    const bobBefore = BigInt((await playerOf("bob")).fils);

    const bought = await post(stallBuyPOST, "/api/stall/buy", { stall_id: stall.id, qty: 1, limit_total: "1500" }, { user: "bob" });
    expect(errCode(bought)).toBe("OK");
    expect(bought.json.data.player.inventory.grain).toBe(1);
    expect(BigInt(bought.json.data.player.fils)).toBe(bobBefore - 1500n);
    expect(BigInt((await playerOf("alice")).fils)).toBe(aliceBefore + 1500n - 30n); // ceil(2% of 1500) = 30

    const cancelled = await post(stallCancelPOST, "/api/stall/cancel", { stall_id: stall.id }, { user: "alice" });
    expect(errCode(cancelled)).toBe("OK");
    expect(cancelled.json.data.player.inventory.grain).toBe(9); // 10 - 3 listed + 2 returned
    expect(await view<unknown[]>("get_stalls", {})).toEqual([]);
  }, STEP);

  it("journey: NOT_ARRIVED before the chain clock reaches arrival, then claim and sell in the destination", async () => {
    const start = await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { grain: 9 }, guards: 0 }, { user: "alice" });
    expect(errCode(start)).toBe("OK");
    expect(start.json.data.journey).toMatchObject({ from: "bandar", to: "shahr" });
    expect(errCode(await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "alice" }))).toBe("NOT_ARRIVED");
    expect(errCode(await post(tradePOST, "/api/trade", { merchant: "bandar", good: "salt", side: "buy", qty: 1, limit_total: "99999" }, { user: "alice" }))).toBe("IN_TRANSIT");

    await advanceChain(185); // bandar -> shahr is 180 s
    const claim = await post(journeyClaimPOST, "/api/journey/claim", {}, { user: "alice" });
    expect(errCode(claim)).toBe("OK");
    const j = claim.json.data.journey as { status: string; ambushed: boolean; lost?: Partial<Record<GoodId, number>> };
    expect(j.status).toBe("CLAIMED");
    const lost = j.ambushed ? (j.lost?.grain ?? 0) : 0;
    if (j.ambushed) expect(lost).toBe(Math.floor((9 * 3000) / 10000)); // floor(30%)
    const p = PlayerSchema.parse(claim.json.data.player);
    expect(p.location).toBe("shahr");
    expect(p.inventory.grain).toBe(9 - lost);

    const m = await svc.contract.getMerchant("shahr");
    const qty = p.inventory.grain;
    const cost = tradeCost({ good: "grain", side: "sell", qty, merchantStock: m.stock.grain, spreadBp: m.spread_bp, biasBp: m.bias_bp });
    const sold = await post(tradePOST, "/api/trade", { merchant: "shahr", good: "grain", side: "sell", qty, limit_total: (cost.total - cost.fee).toString() }, { user: "alice" });
    expect(errCode(sold)).toBe("OK");
    expect(BigInt(sold.json.data.player.fils)).toBe(BigInt(p.fils) + cost.total - cost.fee);
  }, 10 * 60_000);

  it("leaderboard reads every player from the chain", async () => {
    const r = await get(leaderboardGET, "/api/leaderboard");
    expect(errCode(r)).toBe("OK");
    const rows = r.json.data.rows as Array<{ name: string; net_worth: string }>;
    const alice = rows.find((x) => x.name === "alice");
    expect(alice?.net_worth).toBe((await playerOf("alice")).net_worth);
    expect(rows.map((x) => x.name)).toEqual(expect.arrayContaining(["alice", "bob"]));
  }, STEP);

  it("cron tick route calls world_tick on chain (no worker heartbeat)", async () => {
    const before = (await svc.contract.getWorld()).tick;
    await advanceChain(61);
    const r = await call(cronTickGET, "GET", "/api/cron/tick", undefined, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(errCode(r)).toBe("OK");
    expect(r.json.data).toMatchObject({ called: true });
    expect((await svc.contract.getWorld()).tick).toBeGreaterThan(before);
  }, 10 * 60_000);

  it("worker NearChain: merchants move their policy and tick the world with their function-call keys", async () => {
    const { NearChain } = await importFile<WorkerChainModule>("apps", "worker", "src", "chain-near.ts");
    const cities: CityId[] = ["dasht", "madan", "bandar", "shahr"];
    const chain = new NearChain({
      rpcUrl: sandbox.rpcUrl, contractId: need("CARAVAN_CONTRACT_ID"),
      merchantAccounts: Object.fromEntries(cities.map((c) => [c, need(`MERCHANT_ACCOUNT_${c.toUpperCase()}`)])),
      merchantKeys: Object.fromEntries(cities.map((c) => [c, need(`KEY_${c.toUpperCase()}`)])),
    });
    const snap = await chain.readSnapshot();
    expect(Object.keys(snap.merchants).sort()).toEqual([...cities].sort());
    const { spread_bp, bias_bp } = snap.merchants.dasht.policy;
    await chain.setPolicy("dasht", spread_bp + 100, bias_bp + 100);
    expect((await chain.readSnapshot()).merchants.dasht.policy).toEqual({ spread_bp: spread_bp + 100, bias_bp: bias_bp + 100 });

    await advanceChain(61);
    const tick = await chain.worldTick();
    expect(tick.skipped).not.toBe(true);
    // The contract runs every tick that is due (1..10), so after the cron test's leftover time it may be more than one.
    expect((await chain.readSnapshot()).tick).toBeGreaterThan(snap.tick);
  }, 10 * 60_000);

  it("operator pause stops play; only the owner unpauses", async () => {
    await svc.contract.operatorCall("set_paused", { paused: true });
    expect((await svc.contract.getConfig()).paused).toBe(true);
    expect(errCode(await post(tradePOST, "/api/trade", { merchant: "shahr", good: "salt", side: "buy", qty: 1, limit_total: "99999" }, { user: "alice" }))).toBe("PAUSED");
    const denied = await svc.contract.operatorCall("set_paused", { paused: false }).catch((e: unknown) => e);
    expect(isContractPanic(denied)).toBe(true); // a contract panic of a directly signed call is a ContractPanic, not a raw near-api-js error
    expect(String((denied as Error).message)).toMatch(/UNAUTHENTICATED/);

    const owner = new Account(need("OWNER_ACCOUNT_ID"), provider, need("OWNER_PRIVATE_KEY") as KeyPairString);
    await owner.callFunction({ contractId: need("CARAVAN_CONTRACT_ID"), methodName: "set_paused", args: { paused: false }, gas: teraToGas("30"), deposit: 0n });
    expect((await svc.contract.getConfig()).paused).toBe(false);
    expect(errCode(await post(tradePOST, "/api/trade", { merchant: "shahr", good: "salt", side: "buy", qty: 1, limit_total: "99999" }, { user: "alice" }))).toBe("OK");
  }, STEP);

  it("money is conserved on chain: players + treasuries + house + pending = seed + deposits + faucet - withdrawn", async () => {
    const s = await view<Record<string, string>>("get_solvency");
    const players = await view<Array<{ fils: string }>>("get_players", { from_index: 0, limit: 100 });
    const lhs = players.reduce((a, p) => a + BigInt(p.fils), 0n) + BigInt(s.merchant_treasuries!) + BigInt(s.house!) + BigInt(s.pending_withdrawals!);
    const rhs = BigInt(s.seed_total!) + BigInt(s.total_deposited!) + BigInt(s.total_faucet!) - BigInt(s.total_withdrawn!);
    expect(lhs).toBe(rhs);
    expect(BigInt(s.total_faucet!)).toBe(100000n);
  }, STEP);
});
