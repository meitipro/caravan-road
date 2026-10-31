import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CITY_IDS } from "@caravan/shared";
import { bootstrap } from "../src/bootstrap.js";
import { ConfigError, describeConfig, loadConfig } from "../src/config.js";
import { PgDecisionStore } from "../src/db.js";
import { StockHistory } from "../src/features.js";
import { abortableSleep, runCycle, runLoop } from "../src/loop.js";
import { MemoryStore } from "../src/memory-store.js";
import { parseWorldView } from "../src/chain-near.js";
import type { RunDeps } from "../src/run-once.js";
import { SimWorld } from "../src/sim-world.js";
import { silentLogger, type ChainPort, type DecisionRecord } from "../src/types.js";

const FAKE_KEY = ["ed25519", "TESTONLYNOTAREALKEY1111"].join(":");
const goodEnv = {
  NEAR_NETWORK: "testnet",
  NEAR_RPC_URL: "https://rpc.example.test",
  CARAVAN_CONTRACT_ID: "caravan.test",
  MERCHANT_ACCOUNT_DASHT: "dasht.test",
  MERCHANT_ACCOUNT_MADAN: "madan.test",
  MERCHANT_ACCOUNT_BANDAR: "bandar.test",
  MERCHANT_ACCOUNT_SHAHR: "shahr.test",
  KEY_DASHT: FAKE_KEY,
  KEY_MADAN: FAKE_KEY,
  KEY_BANDAR: FAKE_KEY,
  KEY_SHAHR: FAKE_KEY,
  DATABASE_URL: "postgres://user:pw@db.example.test/x",
  NEAR_AI_API_KEY: "test-ai-key-value",
  NEAR_AI_MODEL: "org/model",
};

describe("config (fail fast, no secrets in messages)", () => {
  it("loads a complete environment with defaults", () => {
    const c = loadConfig(goodEnv);
    expect(c.periodSeconds).toBe(60);
    expect(c.staggerSeconds).toBe(15);
    expect(c.merchantAccounts.bandar).toBe("bandar.test");
  });

  it("NEAR_AI_API_KEY is mandatory", () => {
    const { NEAR_AI_API_KEY: _k, ...rest } = goodEnv;
    expect(() => loadConfig(rest)).toThrow(ConfigError);
    try {
      loadConfig(rest);
    } catch (e) {
      expect((e as ConfigError).problems.join(" ")).toContain("NEAR_AI_API_KEY is required");
    }
    expect(() => loadConfig({ ...goodEnv, NEAR_AI_API_KEY: "  " })).toThrow(ConfigError);
  });

  it("NEAR_AI_MODEL, keys, database and rpc are mandatory; names are reported", () => {
    try {
      loadConfig({});
      throw new Error("should have thrown");
    } catch (e) {
      const p = (e as ConfigError).problems.join(" ");
      for (const name of ["NEAR_RPC_URL", "CARAVAN_CONTRACT_ID", "KEY_DASHT", "KEY_SHAHR", "DATABASE_URL", "NEAR_AI_API_KEY", "NEAR_AI_MODEL"]) expect(p).toContain(name);
    }
  });

  it("a malformed key is rejected without echoing its value", () => {
    try {
      loadConfig({ ...goodEnv, KEY_MADAN: "super-secret-looking-value-ZZZ" });
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("KEY_MADAN");
      expect(msg).not.toContain("super-secret-looking-value-ZZZ");
    }
  });

  it("describeConfig never contains keys, the AI key or the database URL", () => {
    const text = JSON.stringify(describeConfig(loadConfig(goodEnv)));
    for (const secret of [FAKE_KEY, "test-ai-key-value", "postgres://", "pw@"]) expect(text).not.toContain(secret);
  });

  it("bootstrap refuses to start without the key and makes no network call", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const { NEAR_AI_API_KEY: _k, ...rest } = goodEnv;
    await expect(bootstrap(rest, silentLogger)).rejects.toThrow(ConfigError);
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });

  it("production entry points never import the fake model", () => {
    for (const file of ["../src/main.ts", "../src/bootstrap.ts"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text).not.toMatch(/fake/i);
    }
  });
});

// ---------------------------------------------------------------------------------------------
function cycleDeps(world: SimWorld, store = new MemoryStore()): RunDeps & { store: MemoryStore } {
  return { chain: world, store, model: null, attestor: null, history: new StockHistory(), memory: new Map(), now: () => world.snapshot().now, log: silentLogger };
}
const noSleep = async () => {};
const wrap = (w: SimWorld, over: Partial<ChainPort> = {}): ChainPort => ({
  readSnapshot: () => w.readSnapshot(),
  setPolicy: (...a) => w.setPolicy(...a),
  ship: (...a) => w.ship(...a),
  worldTick: () => w.worldTick(),
  ...over,
});

describe("loop", () => {
  it("runs the four merchants, then world_tick once, then the heartbeat", async () => {
    const world = new SimWorld({ bots: 0, seed: 1 });
    const deps = cycleDeps(world);
    const tickSpy = vi.spyOn(world, "worldTick");
    const r = await runCycle(deps, { staggerMs: 0, sleep: noSleep });
    expect(r.ok).toEqual([...CITY_IDS]);
    expect(r.failed).toEqual([]);
    expect(r.tick).toBe("called");
    expect(tickSpy).toHaveBeenCalledTimes(1);
    expect(deps.store.rows.map((x) => x.decision.merchant)).toEqual([...CITY_IDS]);
    expect(deps.store.heartbeats).toHaveLength(1);
    expect(world.tick).toBe(1);
  });

  it("staggers merchants by the configured delay (3 sleeps between 4 merchants)", async () => {
    const world = new SimWorld({ bots: 0, seed: 1 });
    const sleeps: number[] = [];
    await runCycle(cycleDeps(world), { staggerMs: 15_000, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([15_000, 15_000, 15_000]);
  });

  it("one merchant's failure never stops the others, the tick or the heartbeat", async () => {
    const world = new SimWorld({ bots: 0, seed: 1 });
    const deps = cycleDeps(world);
    let n = 0;
    deps.chain = wrap(world, {
      readSnapshot: async () => {
        if (++n === 2) throw new Error("rpc timeout"); // second merchant (madan) cannot read state
        return world.snapshot();
      },
    });
    const r = await runCycle(deps, { staggerMs: 0, sleep: noSleep });
    expect(r.failed.map((f) => f.merchant)).toEqual(["madan"]);
    expect(r.ok).toEqual(["dasht", "bandar", "shahr"]);
    expect(r.tick).toBe("called");
    expect(deps.store.heartbeats).toHaveLength(1);
  });

  it("world_tick errors and heartbeat errors are contained", async () => {
    const world = new SimWorld({ bots: 0, seed: 1 });
    world.failNext.worldTick = "rpc down";
    const deps = cycleDeps(world);
    deps.store.heartbeat = async () => {
      throw new Error("db down");
    };
    const r = await runCycle(deps, { staggerMs: 0, sleep: noSleep });
    expect(r.tick).toBe("error");
    expect(r.ok).toHaveLength(4);
  });

  it("a too-early world_tick is reported as skipped", async () => {
    const world = new SimWorld({ bots: 0, seed: 1 });
    const deps = cycleDeps(world);
    deps.chain = wrap(world, { worldTick: async () => ({ txHash: null, skipped: true }) });
    expect((await runCycle(deps, { staggerMs: 0, sleep: noSleep })).tick).toBe("skipped");
  });

  it("stops promptly on abort (graceful shutdown)", async () => {
    const world = new SimWorld({ bots: 0, seed: 1 });
    const ctl = new AbortController();
    const deps = cycleDeps(world);
    const loop = runLoop(deps, { periodMs: 60_000, staggerMs: 0, sleep: abortableSleep, signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 30));
    ctl.abort();
    await expect(loop).resolves.toBeUndefined();
    expect(deps.store.heartbeats.length).toBeGreaterThanOrEqual(1);
  });

  it("abortableSleep resolves on abort", async () => {
    const ctl = new AbortController();
    const t0 = Date.now();
    const p = abortableSleep(10_000, ctl.signal);
    ctl.abort();
    await p;
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------------------------
describe("PgDecisionStore (mock client)", () => {
  const rec = (over: Partial<DecisionRecord["decision"]> = {}): DecisionRecord => ({
    decision: {
      merchant: "dasht", ts: 5, spread_bp: 900, bias_bp: -10, mood: "calm", ship: null,
      line: { en: "x", fa: "ی" }, reason: "r", source: "llm", model: "m", request_id: "rid", attested: false, tx_hashes: ["h1"], ...over,
    },
    input_hash: "f".repeat(64),
    evidence: null,
  });

  it("inserts into npc_decisions with the server's column names", async () => {
    const q = vi.fn(async () => undefined);
    await new PgDecisionStore({ query: q }, "w1").insertDecision(rec());
    const [sql, params] = q.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/insert into npc_decisions \(merchant, ts, input_hash, output_json, model, request_id, attested, source, tx_hashes\)/);
    expect(params.slice(0, 3)).toEqual(["dasht", 5, "f".repeat(64)]);
    expect(JSON.parse(params[3] as string).spread_bp).toBe(900);
    expect(params.slice(4)).toEqual(["m", "rid", false, "llm", '["h1"]']);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("stores evidence in the worker's own table; upserts the heartbeat", async () => {
    const q = vi.fn(async () => undefined);
    const store = new PgDecisionStore({ query: q }, "w1");
    await store.insertDecision({ ...rec(), evidence: { merchant: "dasht", at: 5, model: "m", request_id: "rid", chat_id: "c", request_sha256: "a", response_sha256: "b", signature: null, checks: { signature: "unavailable", tee_quote: "not_verified" }, attested: false, note: "n" } });
    expect((q.mock.calls[1] as unknown as [string])[0]).toMatch(/insert into npc_evidence/);
    await store.heartbeat(77);
    const last = q.mock.calls[2] as unknown as [string, unknown[]];
    expect(last[0]).toMatch(/on conflict \(worker\) do update/);
    expect(last[1]).toEqual(["w1", 77]);
  });
});

describe("chain-near view mapping", () => {
  const merchant = (id: string) => ({ id, account_id: `${id}.test`, treasury: "50000", stock: { grain: 1, salt: 2, iron: 3, spice: 4, silk: 5 }, policy: { spread_bp: 800, bias_bp: -5 }, quotes: {} });
  it("maps get_world to a snapshot", () => {
    const s = parseWorldView({ tick: "12", now_ns: "1800000000000000000", merchants: CITY_IDS.map(merchant) }, () => 0);
    expect(s.tick).toBe(12);
    expect(s.now).toBe(1_800_000_000);
    expect(s.merchants.shahr.treasury).toBe(50000n);
    expect(s.merchants.madan.stock.iron).toBe(3);
  });
  it("rejects an incomplete or malformed world", () => {
    expect(() => parseWorldView({ tick: 1, merchants: [merchant("dasht")] }, () => 0)).toThrow();
    expect(() => parseWorldView({ tick: 1, merchants: CITY_IDS.map((c) => ({ ...merchant(c), treasury: "-1" })) }, () => 0)).toThrow();
  });
});
