// The local end-to-end dev backend: guards, dev login, strict contract rules of the fake, persistence, the
// ticker/NPC stand-in, and a full game loop through the REAL route handlers.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOODS, GOOD_IDS, PARAMS, tradeCost } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as faucetPOST } from "../../app/api/faucet/route";
import { POST as tradePOST } from "../../app/api/trade/route";
import { POST as journeyStartPOST } from "../../app/api/journey/start/route";
import { POST as journeyClaimPOST } from "../../app/api/journey/claim/route";
import { GET as leaderboardGET } from "../../app/api/leaderboard/route";
import { POST as loginPOST, GET as loginGET } from "../../app/api/dev/login/route";
import { GET as logoutGET } from "../../app/api/dev/logout/route";
import { FakeContract } from "../contract/fake";
import { assertDevFlagsSafe, devLoginAllowed, isLocalHostHeader } from "../dev/flags";
import { devLogin } from "../dev/login";
import { DEV_COOKIE, makeDevCookieValue, readDevCookie, setDevSecret } from "../dev/session";
import { baselineTargets, runNpcStandIn, startDevTicker, tickOnce } from "../dev/ticker";
import { getServices, setServices } from "../services";
import { createDevBackend } from "../services.dev";
import { silentLog } from "../log";
import { generateKey, playerKeyFromSeed } from "../near/custody";
import { call, get, post, START_TIME } from "./testkit";

const TIMEOUT = 180_000;
const DEV_ENV = { NODE_ENV: "development", DEV_LOGIN: "1", GAME_MODE: "PLAY" };

const req = (path: string, init: { method?: string; host?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  new Request(`http://${init.host ?? "localhost"}${path}`, {
    method: init.method ?? "POST",
    headers: { host: init.host ?? "localhost", "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  setServices(null);
});

describe("startup guards", () => {
  it("DEV_LOGIN=1 or SERVER_BACKEND=dev throws when NODE_ENV=production", () => {
    expect(() => assertDevFlagsSafe({ NODE_ENV: "production", DEV_LOGIN: "1", GAME_MODE: "PLAY" })).toThrow(/production/);
    expect(() => assertDevFlagsSafe({ NODE_ENV: "production", SERVER_BACKEND: "dev", GAME_MODE: "PLAY" })).toThrow(/production/);
  });
  it("requires GAME_MODE=PLAY and is silent when no dev switch is set", () => {
    expect(() => assertDevFlagsSafe({ NODE_ENV: "development", DEV_LOGIN: "1", GAME_MODE: "LIVE" })).toThrow(/PLAY/);
    expect(() => assertDevFlagsSafe({ NODE_ENV: "development", SERVER_BACKEND: "dev" })).toThrow(/PLAY/);
    expect(() => assertDevFlagsSafe({ NODE_ENV: "production", GAME_MODE: "LIVE" })).not.toThrow();
    expect(() => assertDevFlagsSafe({ NODE_ENV: "development", DEV_LOGIN: "1", GAME_MODE: "PLAY" })).not.toThrow();
  });
  it("getServices() refuses to start the dev backend in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SERVER_BACKEND", "dev");
    vi.stubEnv("GAME_MODE", "PLAY");
    await expect(getServices()).rejects.toThrow(/production/);
  });
  it("importing the dev login route with DEV_LOGIN=1 in production throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("GAME_MODE", "PLAY");
    vi.resetModules();
    await expect(import("../../app/api/dev/login/route")).rejects.toThrow(/production/);
  });
});

describe("dev login: 404 unless every condition holds", () => {
  const body = { name: "Alice" };
  it("allowed on localhost, 127.0.0.1 and [::1] with all switches", async () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      const r = await devLogin(req("/api/dev/login", { host, body }), DEV_ENV);
      expect(r.status).toBe(200);
      expect(r.headers.get("set-cookie")).toMatch(new RegExp(`^${DEV_COOKIE}=.+; Path=/; HttpOnly; SameSite=Lax`));
    }
  });
  it("404 in production, without DEV_LOGIN=1, in LIVE", async () => {
    for (const env of [{ ...DEV_ENV, NODE_ENV: "production" }, { ...DEV_ENV, DEV_LOGIN: "0" }, { ...DEV_ENV, DEV_LOGIN: undefined }, { ...DEV_ENV, GAME_MODE: "LIVE" }, { ...DEV_ENV, GAME_MODE: undefined }]) {
      const r = await devLogin(req("/api/dev/login", { body }), env);
      expect(r.status).toBe(404);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });
  it("404 for a non-local host or a non-local forwarded host", async () => {
    expect((await devLogin(req("/api/dev/login", { host: "game.example.org", body }), DEV_ENV)).status).toBe(404);
    expect((await devLogin(req("/api/dev/login", { host: "localhost.evil.example", body }), DEV_ENV)).status).toBe(404);
    expect((await devLogin(req("/api/dev/login", { headers: { "x-forwarded-host": "game.example.org" }, body }), DEV_ENV)).status).toBe(404);
    expect((await devLogin(req("/api/dev/login", { headers: { host: "game.example.org" }, body }), DEV_ENV)).status).toBe(404);
    expect(isLocalHostHeader("localhost:3000")).toBe(true);
    expect(isLocalHostHeader(null)).toBe(false);
  });
  it("the real route answers 404 by default (no DEV_LOGIN in the test environment) for POST, GET and logout", async () => {
    expect((await loginPOST(req("/api/dev/login", { body }))).status).toBe(404);
    expect((await loginGET(req("/api/dev/login?name=Alice", { method: "GET" }))).status).toBe(404);
    expect((await logoutGET(req("/api/dev/logout", { method: "GET" }))).status).toBe(404);
  });
  it("the real route logs in when the environment allows it", async () => {
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("GAME_MODE", "PLAY");
    setDevSecret(randomBytes(32));
    const r = await loginPOST(req("/api/dev/login", { body }));
    expect(r.status).toBe(200);
    const g = await loginGET(req("/api/dev/login?name=Bob&next=/play/cash", { method: "GET" }));
    expect(g.status).toBe(303);
    expect(g.headers.get("location")).toBe("/play/cash");
    const open = await loginGET(req("/api/dev/login?name=Bob&next=//evil.example", { method: "GET" }));
    expect(open.headers.get("location")).toBe("/play"); // no open redirect
    const out = await logoutGET(req("/api/dev/logout", { method: "GET" }));
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("rejects bad names and cross-origin posts", async () => {
    for (const name of ["", "x".repeat(25), "<script>", "a/b"]) {
      const r = await devLogin(req("/api/dev/login", { body: { name } }), DEV_ENV);
      expect(r.status).toBe(400);
    }
    expect((await devLogin(req("/api/dev/login", { headers: { origin: "https://evil.example" }, body }), DEV_ENV)).status).toBe(400);
    expect(devLoginAllowed(req("/api/dev/login"), DEV_ENV)).toBe(true);
  });
  it("the cookie is signed: tampering and other secrets are rejected", () => {
    const secret = randomBytes(32);
    const v = makeDevCookieValue(secret, "Alice");
    expect(readDevCookie(secret, `${DEV_COOKIE}=${v}`)).toBe("Alice");
    expect(readDevCookie(randomBytes(32), `${DEV_COOKIE}=${v}`)).toBeNull();
    expect(readDevCookie(secret, `${DEV_COOKIE}=${v.replace(/^./, "Z")}`)).toBeNull();
    expect(readDevCookie(secret, `${DEV_COOKIE}=${makeDevCookieValue(secret, "bad<name>")}`)).toBeNull();
    expect(readDevCookie(secret, null)).toBeNull();
  });
});

describe("FakeContract strict rules (contracts/caravan/DECISIONS.md)", () => {
  function setup() {
    let now = START_TIME;
    const c = new FakeContract({ now: () => now, strict: true, ambushRoll: () => 9999 });
    const mk = async (name: string) => {
      const k = generateKey();
      await c.createPlayerAccount(name, k.publicKey);
      const key = playerKeyFromSeed(k.seed, k.publicKey);
      await c.playerCall(name, "register", {}, key);
      return key;
    };
    return { c, mk, advance: (s: number) => { now += s; } };
  }
  const rejects = (p: Promise<unknown>, code: string) => expect(p).rejects.toThrow(new RegExp(`^${code}:`));

  it("faucet: net worth under 50 dinars and a 1 h cooldown (D4)", async () => {
    const { c, mk, advance } = setup();
    const key = await mk("a.t");
    await c.playerCall("a.t", "faucet", {}, key);
    await rejects(c.playerCall("a.t", "faucet", {}, key), "RATE_LIMIT");
    advance(3601);
    await rejects(c.playerCall("a.t", "faucet", {}, key), "BAD_REQUEST"); // 500 dinars is not under 50
    c.testGrantFils("a.t", -49_000n);
    await c.playerCall("a.t", "faucet", {}, key);
  });

  it("stall: the SELLER pays ceil(2%), min 1 fils; the seller must be in the city; max 5 stalls (D5, D6)", async () => {
    const { c, mk } = setup();
    const ka = await mk("a.t");
    const kb = await mk("b.t");
    c.testGrantGoods("a.t", "salt", 30);
    c.testGrantFils("b.t", 100000n);
    const s = (await c.playerCall("a.t", "stall_create", { good: "salt", qty: 10, unit_price: "1" }, ka)).returnValue as { id: number };
    await c.playerCall("b.t", "stall_buy", { stall_id: s.id, qty: 1, limit_total: "1" }, kb); // price 1, fee ceil(0.02) = 1
    expect((await c.getPlayer("b.t"))!.fils).toBe("99999"); // buyer paid exactly the price
    expect((await c.getPlayer("a.t"))!.fils).toBe("0"); // seller got price - fee = 0
    expect(c.house).toBe(1n);
    const s2 = (await c.playerCall("a.t", "stall_create", { good: "salt", qty: 10, unit_price: "1000" }, ka)).returnValue as { id: number };
    await c.playerCall("b.t", "stall_buy", { stall_id: s2.id, qty: 10, limit_total: "10000" }, kb);
    expect((await c.getPlayer("a.t"))!.fils).toBe(String(10000 - 200));
    expect(c.audit().total).toBe(c.audit().expected);
    c.testSetLocation("a.t", "shahr");
    const s3 = (await c.playerCall("a.t", "stall_create", { good: "salt", qty: 1, unit_price: "5" }, ka)).returnValue as { id: number };
    c.testSetLocation("a.t", "bandar"); // seller left the stall's city
    c.testSetLocation("b.t", "shahr");
    await rejects(c.playerCall("b.t", "stall_buy", { stall_id: s3.id, qty: 1, limit_total: "5" }, kb), "NOT_IN_CITY");
    c.testSetLocation("a.t", "shahr");
    c.testGrantGoods("a.t", "salt", 10);
    for (let i = 0; i < 3; i++) await c.playerCall("a.t", "stall_create", { good: "salt", qty: 1, unit_price: "5" }, ka);
    await rejects(c.playerCall("a.t", "stall_create", { good: "salt", qty: 1, unit_price: "5" }, ka), "RATE_LIMIT");
  });

  it("withdrawals: minimum 1,000 fils and one open per player (D14)", async () => {
    const { c, mk } = setup();
    const live = new FakeContract({ mode: "LIVE", strict: true });
    void c; void mk;
    const k = generateKey();
    await live.createPlayerAccount("a.t", k.publicKey);
    const key = playerKeyFromSeed(k.seed, k.publicKey);
    await live.playerCall("a.t", "register", {}, key);
    live.testGrantFils("a.t", 10000n);
    const w = (fils: string) => live.playerCall("a.t", "request_withdraw", { fils, dest_asset: "a", dest_address: "b" }, key);
    await rejects(w("999"), "BAD_REQUEST");
    const id = (await w("1000")).returnValue as number;
    await rejects(w("1000"), "RATE_LIMIT");
    await live.operatorCall("mark_withdraw", { id, status: "SENT" });
    await rejects(w("1000"), "RATE_LIMIT"); // SENT still counts as open
    await live.operatorCall("mark_withdraw", { id, status: "DONE" });
    await w("1000");
  });

  it("merchant set_policy: 300 bp steps, once per tick; ship: gap, destination deficit, 25% budget (D24, D25)", async () => {
    const { c, advance } = setup();
    await expect(c.merchantCall("dasht", "set_policy", { spread_bp: 1500, bias_bp: 0 })).rejects.toThrow(/^BAD_REQUEST/);
    await c.merchantCall("dasht", "set_policy", { spread_bp: 1000, bias_bp: 300 });
    await expect(c.merchantCall("dasht", "set_policy", { spread_bp: 1100, bias_bp: 300 })).rejects.toThrow(/^RATE_LIMIT/);
    advance(61);
    await c.worldTick();
    await c.merchantCall("dasht", "set_policy", { spread_bp: 1100, bias_bp: 300 });

    c.testSetStock("dasht", "grain", 400);
    c.testSetStock("madan", "grain", 100);
    await expect(c.merchantCall("dasht", "ship", { to: "madan", good: "grain", qty: 5 })).rejects.toThrow(/^BAD_REQUEST/);
    await c.merchantCall("dasht", "ship", { to: "madan", good: "grain", qty: 4 });
    await expect(c.merchantCall("dasht", "ship", { to: "madan", good: "grain", qty: 1 })).rejects.toThrow(/^RATE_LIMIT/); // once per good per tick
    c.testSetStock("dasht", "salt", 120);
    c.testSetStock("madan", "salt", 120);
    await expect(c.merchantCall("dasht", "ship", { to: "madan", good: "salt", qty: 1 })).rejects.toThrow(/^BAD_REQUEST/);
    expect(c.audit().total).toBe(c.audit().expected);
  });

  it("tick order has no automatic shipping; the schedule advances by whole ticks (D2, D13)", async () => {
    const { c, advance } = setup();
    c.testSetStock("dasht", "grain", 400);
    c.testSetStock("madan", "grain", 0);
    advance(61);
    await c.worldTick();
    expect(c.calls.length).toBeGreaterThan(0);
    expect((await c.getMerchant("madan")).stock.grain).toBe(0); // production only; nobody shipped
    advance(59); // 120 s after start: 59 s after the 61 s call, schedule is at 60 -> elapsed 60 -> one tick
    expect((await c.worldTick()).returnValue).toMatchObject({ ticks: 1 });
    advance(30);
    expect((await c.worldTick()).returnValue).toMatchObject({ ticks: 0 });
  });

  it("snapshot / restore round-trips money, accounts and -Infinity", async () => {
    const { c, mk } = setup();
    const key = await mk("a.t");
    await c.playerCall("a.t", "faucet", {}, key);
    const copy = new FakeContract({ now: () => START_TIME, strict: true });
    copy.restore(c.snapshot());
    expect((await copy.getPlayer("a.t"))!.fils).toBe("50000");
    expect(copy.audit()).toEqual(c.audit());
    expect(copy.accountKey("a.t")).toBe(c.accountKey("a.t"));
    await mk("b.t"); // a player who never used the faucet has last_faucet = -Infinity
    const copy2 = new FakeContract({ now: () => START_TIME, strict: true });
    copy2.restore(c.snapshot());
    const kb = generateKey();
    await expect(copy2.playerCall("b.t", "faucet", {}, playerKeyFromSeed(kb.seed, kb.publicKey))).rejects.toThrow(/^INTERNAL/); // a foreign key is still refused after restore
  });
});

describe("ticker and NPC stand-in", () => {
  it("baseline targets follow the worker baseline rules", () => {
    const rich = baselineTargets(50_000n, { grain: 200, salt: 120, iron: 100, spice: 40, silk: 30 });
    expect(rich).toEqual({ spread_bp: 800, bias_bp: 0 });
    const poorScarce = baselineTargets(0n, { grain: 0, salt: 0, iron: 0, spice: 0, silk: 0 });
    expect(poorScarce).toEqual({ spread_bp: 1800, bias_bp: 1500 });
  });

  it("a tick moves the world and the merchants one bounded step", async () => {
    let t = START_TIME;
    const backend = await createDevBackend({ dataDir: null, now: () => t, startTicker: false, env: DEV_ENV, log: silentLog });
    try {
      const before = await backend.contract.getMerchant("dasht");
      t += 61;
      await tickOnce(backend.contract, backend.svc);
      const after = await backend.contract.getMerchant("dasht");
      expect(backend.contract.tick).toBe(1);
      expect(Math.abs(after.bias_bp - before.bias_bp)).toBeLessThanOrEqual(300);
      expect(Math.abs(after.spread_bp - before.spread_bp)).toBeLessThanOrEqual(300);
      expect(await backend.svc.repo.latestHeartbeat()).toBe(t);
      // after many ticks scarce goods raise the bias, within the contract's step limit each time
      for (let i = 0; i < 20; i++) {
        t += 61;
        await tickOnce(backend.contract, backend.svc);
      }
      expect(backend.contract.audit().total).toBe(backend.contract.audit().expected);
      const r = await runNpcStandIn(backend.contract);
      expect(r.policies).toBe(0); // already acted this tick: rate limited, not an error
    } finally { await backend.stop(); }
  }, TIMEOUT);

  it("startDevTicker calls the tick every N seconds and can be stopped", async () => {
    vi.useFakeTimers();
    const contract = { worldTick: vi.fn(async () => undefined), getMerchant: vi.fn(async () => { throw new Error("stop"); }) } as never;
    const svc = { worldCache: { invalidate: vi.fn() }, repo: { setHeartbeat: vi.fn() }, now: () => 1, log: silentLog } as never;
    const stop = startDevTicker(contract, svc, 5);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect((contract as unknown as { worldTick: { mock: { calls: unknown[] } } }).worldTick.mock.calls).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect((contract as unknown as { worldTick: { mock: { calls: unknown[] } } }).worldTick.mock.calls).toHaveLength(2);
  });
});

describe("persistence under a git-ignored data directory", () => {
  it("keeps accounts, balances and the world across restarts", async () => {
    const dir = join(process.cwd(), ".data", `test-${randomBytes(4).toString("hex")}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(process.cwd(), ".data", ".gitignore"), "*" + String.fromCharCode(10)); // keep test data out of git status
    const t = START_TIME;
    try {
      setDevSecret(randomBytes(32));
      vi.stubEnv("DEV_LOGIN", "1");
      vi.stubEnv("GAME_MODE", "PLAY");
      let backend = await createDevBackend({ dataDir: dir, now: () => t, startTicker: false, env: DEV_ENV, log: silentLog });
      setServices(backend.svc);
      const login = await loginPOST(req("/api/dev/login", { body: { name: "Alice" } }));
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const o = { user: null, headers: { cookie } };
      const s1 = await get(stateGET, "/api/state", o);
      const account = s1.json.data.me.account_id as string;
      await post(faucetPOST, "/api/faucet", {}, o);
      await backend.stop();
      setServices(null);

      expect(existsSync(join(dir, ".gitignore"))).toBe(true);
      expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("*");
      expect(existsSync(join(dir, "dev-contract.json"))).toBe(true);

      backend = await createDevBackend({ dataDir: dir, now: () => t, startTicker: false, env: DEV_ENV, log: silentLog });
      setServices(backend.svc);
      const s2 = await get(stateGET, "/api/state", o);
      expect(s2.json.data.me.account_id).toBe(account);
      expect(s2.json.data.me.fils).toBe("50000");
      await backend.stop();
    } finally {
      setServices(null);
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);
});

describe("end to end: register, faucet, trade, journey, claim, sell with the dev backend", () => {
  it("drives the real route handlers and conserves money", async () => {
    let t = START_TIME;
    const backend = await createDevBackend({ dataDir: null, now: () => t, startTicker: false, env: DEV_ENV, log: silentLog });
    try {
      setServices(backend.svc);
      setDevSecret(randomBytes(32));
      vi.stubEnv("DEV_LOGIN", "1");
      vi.stubEnv("GAME_MODE", "PLAY");

      // not signed in: the world only
      const anon = await get(stateGET, "/api/state");
      expect(anon.json.data.me).toBeNull();

      // dev login
      const login = await loginPOST(req("/api/dev/login", { body: { name: "Sara" } }));
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const o = { user: null, headers: { cookie } };

      // register (first state creates and registers the account), faucet
      const s0 = await get(stateGET, "/api/state", o);
      expect(s0.json.data.me).toMatchObject({ display_name: "Sara", location: "bandar", fils: "0" });
      expect((await post(faucetPOST, "/api/faucet", {}, o)).json.data.player.fils).toBe("50000");

      // buy 10 grain in bandar at the contract price
      const m = await backend.contract.getMerchant("bandar");
      const cost = tradeCost({ good: "grain", side: "buy", qty: 10, merchantStock: m.stock.grain, spreadBp: m.spread_bp, biasBp: m.bias_bp });
      const buy = await post(tradePOST, "/api/trade", { merchant: "bandar", good: "grain", side: "buy", qty: 10, limit_total: (cost.total + cost.fee).toString() }, o);
      expect(buy.json.ok).toBe(true);
      expect(buy.json.data.player.inventory.grain).toBe(10);

      // travel to shahr with one guard, wait, claim
      const start = await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { grain: 10 }, guards: 1 }, o);
      expect(start.json.ok).toBe(true);
      expect(start.json.data.journey.risk_bp).toBe(520);
      expect((await post(journeyClaimPOST, "/api/journey/claim", {}, o)).json.error?.code).toBe("NOT_ARRIVED");
      t += 181;
      const claim = await post(journeyClaimPOST, "/api/journey/claim", {}, o);
      expect(claim.json.ok).toBe(true);
      expect(claim.json.data.player.location).toBe("shahr");
      const carried = claim.json.data.player.inventory.grain as number;
      expect(carried === 10 || carried === 7).toBe(true); // hash-based ambush roll: 30% of 10 is 3

      // sell everything in shahr
      const sh = await backend.contract.getMerchant("shahr");
      const sell = tradeCost({ good: "grain", side: "sell", qty: carried, merchantStock: sh.stock.grain, spreadBp: sh.spread_bp, biasBp: sh.bias_bp });
      const sold = await post(tradePOST, "/api/trade", { merchant: "shahr", good: "grain", side: "sell", qty: carried, limit_total: (sell.total - sell.fee).toString() }, o);
      expect(sold.json.ok).toBe(true);
      expect(sold.json.data.player.inventory.grain).toBe(0);

      // the leaderboard sees Sara; ticks and the NPC stand-in keep the books balanced
      t += 120;
      await tickOnce(backend.contract, backend.svc);
      const board = await get(leaderboardGET, "/api/leaderboard");
      expect(board.json.data.rows.map((r: { name: string }) => r.name)).toContain("Sara");
      const audit = backend.contract.audit();
      expect(audit.total).toBe(audit.expected);
      expect(GOOD_IDS.map((g) => GOODS[g].id)).toHaveLength(5);
      expect(PARAMS.FAUCET_FILS).toBe(50000);

      // a different cookie is a different player; a forged one is nobody
      const forged = await get(stateGET, "/api/state", { user: null, headers: { cookie: `${DEV_COOKIE}=${makeDevCookieValue(randomBytes(32), "Eve")}` } });
      expect(forged.json.data.me).toBeNull();
      expect((await call(faucetPOST, "POST", "/api/faucet", {}, { user: null, headers: { cookie: `${DEV_COOKIE}=garbage` } })).json.error?.code).toBe("UNAUTHENTICATED");
    } finally { await backend.stop(); }
  }, TIMEOUT);
});
