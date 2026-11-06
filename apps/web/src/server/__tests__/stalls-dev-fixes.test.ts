// Follow-up fixes from the stalls UI walkthrough: (14) mapped errors must survive duplicate module instances,
// (15) FakeContract.stallCancel follows the contract, (16) the dev world can be reset and does not collapse.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOD_IDS, GOODS, PARAMS } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as faucetPOST } from "../../app/api/faucet/route";
import { POST as stallCreatePOST } from "../../app/api/stall/create/route";
import { POST as stallBuyPOST } from "../../app/api/stall/buy/route";
import { POST as stallCancelPOST } from "../../app/api/stall/cancel/route";
import { POST as journeyStartPOST } from "../../app/api/journey/start/route";
import { FakeContract } from "../contract/fake";
import { ApiError, ContractPanic, isApiError, isContractPanic } from "../errors";
import type { SessionUser } from "../guards/auth";
import { silentLog } from "../log";
import { setServices } from "../services";
import { createDevBackend, type DevBackend } from "../services.dev";
import { tickOnce } from "../dev/ticker";
import { generateKey, playerKeyFromSeed } from "../near/custody";
import { post, signIn, START_TIME, makeKit } from "./testkit";

const TIMEOUT = 180_000;
const DEV_ENV = { NODE_ENV: "development", DEV_LOGIN: "1", GAME_MODE: "PLAY" };
const headerSession = async (req: Request): Promise<SessionUser | null> => {
  const who = req.headers.get("x-test-user");
  return who ? { provider: "test", subject: who, email: null, name: who[0]!.toUpperCase() + who.slice(1) } : null;
};

afterEach(() => setServices(null));

async function devBackend(t: { now: number }, extra: Record<string, string> = {}): Promise<DevBackend> {
  const b = await createDevBackend({ dataDir: null, now: () => t.now, startTicker: false, env: { ...DEV_ENV, ...extra }, log: silentLog, session: headerSession, faucetCooldownSeconds: 1 });
  setServices(b.svc);
  return b;
}

describe("14: errors are recognised across duplicate module instances", () => {
  it("a brand, not instanceof: an ApiError / ContractPanic from another copy of errors.ts is still recognised", async () => {
    vi.resetModules();
    const other = await import("../errors");
    const foreign = new other.ApiError("RATE_LIMIT", "from another module copy");
    expect(other.ApiError).not.toBe(ApiError); // two registries, two classes
    expect(foreign instanceof ApiError).toBe(false); // the old check failed exactly like this
    expect(isApiError(foreign)).toBe(true);
    expect(isContractPanic(new other.ContractPanic("SLIPPAGE: x"))).toBe(true);
    expect(isApiError(new Error("plain"))).toBe(false);
    expect(isApiError({ code: "RATE_LIMIT", name: "ApiError" })).toBe(false); // a lookalike without the brand
    expect(isApiError(new ApiError("NOT_IN_CITY", "x"))).toBe(true);
    expect(isContractPanic(new ContractPanic("x"))).toBe(true);
  });

  it("a route answers the mapped code and status when the relayer throws another module copy's ApiError", async () => {
    vi.resetModules();
    const other = await import("../errors");
    const kit = await makeKit();
    try {
      await signIn(kit, stateGET, "alice");
      kit.svc.relayer.submit = async () => { throw new other.ApiError("NOT_IN_CITY", "You are not in that city."); };
      const r = await post(faucetPOST, "/api/faucet", {}, { user: "alice" });
      expect(r.status).toBe(409);
      expect(r.json.error?.code).toBe("NOT_IN_CITY");
    } finally { await kit.close(); }
  }, TIMEOUT);

  it("real handlers on the dev backend: a 6th open stall is RATE_LIMIT (429) and a buy from another city is NOT_IN_CITY (409)", async () => {
    const t = { now: START_TIME };
    const b = await devBackend(t);
    try {
      const alice = await signIn(undefined as never, stateGET, "alice");
      const bob = await signIn(undefined as never, stateGET, "bob");
      b.contract.testGrantGoods(alice, "salt", 30);
      let first = 0;
      for (let i = 0; i < 5; i++) {
        const r = await post(stallCreatePOST, "/api/stall/create", { good: "salt", qty: 1, unit_price: "1500" }, { user: "alice" });
        expect(r.json.ok).toBe(true);
        if (i === 0) first = r.json.data.stall.id;
      }
      const sixth = await post(stallCreatePOST, "/api/stall/create", { good: "salt", qty: 1, unit_price: "1500" }, { user: "alice" });
      expect(sixth.status).toBe(429);
      expect(sixth.json.error?.code).toBe("RATE_LIMIT");

      await post(faucetPOST, "/api/faucet", {}, { user: "bob" });
      b.contract.testSetLocation(bob, "shahr");
      const buy = await post(stallBuyPOST, "/api/stall/buy", { stall_id: first, qty: 1, limit_total: "99999" }, { user: "bob" });
      expect(buy.status).toBe(409);
      expect(buy.json.error?.code).toBe("NOT_IN_CITY");
    } finally { await b.stop(); }
  }, TIMEOUT);
});

describe("15: FakeContract.stallCancel follows contracts/caravan (strict)", () => {
  function setup() {
    const now = START_TIME;
    const c = new FakeContract({ now: () => now, strict: true, ambushRoll: () => 9999 });
    const mk = async (name: string) => {
      const k = generateKey();
      await c.createPlayerAccount(name, k.publicKey);
      const key = playerKeyFromSeed(k.seed, k.publicKey);
      await c.playerCall(name, "register", {}, key);
      return key;
    };
    return { c, mk };
  }
  const rejects = (p: Promise<unknown>, code: string) => expect(p).rejects.toThrow(new RegExp(`^${code}:`));

  it("unknown stall BAD_REQUEST, foreign stall UNAUTHENTICATED, travelling IN_TRANSIT, wrong city NOT_IN_CITY", async () => {
    const { c, mk } = setup();
    const ka = await mk("a.t");
    const kb = await mk("b.t");
    c.testGrantGoods("a.t", "salt", 10);
    c.testGrantGoods("a.t", "grain", 2);
    const s = (await c.playerCall("a.t", "stall_create", { good: "salt", qty: 5, unit_price: "1500" }, ka)).returnValue as { id: number };

    await rejects(c.playerCall("a.t", "stall_cancel", { stall_id: 999 }, ka), "BAD_REQUEST");
    await rejects(c.playerCall("b.t", "stall_cancel", { stall_id: s.id }, kb), "UNAUTHENTICATED");

    c.testSetLocation("a.t", "shahr"); // seller left the stall's city
    await rejects(c.playerCall("a.t", "stall_cancel", { stall_id: s.id }, ka), "NOT_IN_CITY");
    c.testSetLocation("a.t", "bandar");

    await c.playerCall("a.t", "start_journey", { to: "shahr", cargo: { grain: 2 }, guards: 0 }, ka);
    await rejects(c.playerCall("a.t", "stall_cancel", { stall_id: s.id }, ka), "IN_TRANSIT"); // travelling beats the city check

    // after arriving and claiming in shahr the bandar stall cannot be cancelled from there; back in bandar it can
    (c as unknown as { players: Map<string, { journey: unknown }> }).players.get("a.t")!.journey = null;
    c.testSetLocation("a.t", "shahr");
    await rejects(c.playerCall("a.t", "stall_cancel", { stall_id: s.id }, ka), "NOT_IN_CITY");
    c.testSetLocation("a.t", "bandar");
    await c.playerCall("a.t", "stall_cancel", { stall_id: s.id }, ka);
    expect((await c.getPlayer("a.t"))!.inventory.salt).toBe(10);
  });

  it("through the real routes: the mapped codes reach the client (foreign stall is BAD_REQUEST, not a 500 or a login prompt)", async () => {
    const t = { now: START_TIME };
    const b = await devBackend(t);
    try {
      const alice = await signIn(undefined as never, stateGET, "alice");
      await signIn(undefined as never, stateGET, "bob");
      b.contract.testGrantGoods(alice, "salt", 5);
      b.contract.testGrantGoods(alice, "grain", 2);
      const s = (await post(stallCreatePOST, "/api/stall/create", { good: "salt", qty: 5, unit_price: "1500" }, { user: "alice" })).json.data.stall;

      const foreign = await post(stallCancelPOST, "/api/stall/cancel", { stall_id: s.id }, { user: "bob" });
      expect(foreign.status).toBe(400);
      expect(foreign.json.error?.code).toBe("BAD_REQUEST");

      b.contract.testSetLocation(alice, "shahr");
      const wrongCity = await post(stallCancelPOST, "/api/stall/cancel", { stall_id: s.id }, { user: "alice" });
      expect(wrongCity.status).toBe(409);
      expect(wrongCity.json.error?.code).toBe("NOT_IN_CITY");
      b.contract.testSetLocation(alice, "bandar");

      expect((await post(journeyStartPOST, "/api/journey/start", { to: "shahr", cargo: { grain: 2 }, guards: 0 }, { user: "alice" })).json.ok).toBe(true);
      const travelling = await post(stallCancelPOST, "/api/stall/cancel", { stall_id: s.id }, { user: "alice" });
      expect(travelling.status).toBe(409);
      expect(travelling.json.error?.code).toBe("IN_TRANSIT");
    } finally { await b.stop(); }
  }, TIMEOUT);
});

describe("16: reset and a world that does not collapse (dev only)", () => {
  it("DEV_RESET=1 starts from a fresh world; without it the world persists", async () => {
    const dir = join(process.cwd(), ".data", `reset-${randomBytes(4).toString("hex")}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(process.cwd(), ".data", ".gitignore"), "*" + String.fromCharCode(10));
    const t = { now: START_TIME };
    try {
      const make = (extra: Record<string, string> = {}) =>
        createDevBackend({ dataDir: dir, now: () => t.now, startTicker: false, env: { ...DEV_ENV, ...extra }, log: silentLog, session: headerSession });
      let b = await make();
      setServices(b.svc);
      const acc = await signIn(undefined as never, stateGET, "alice");
      await post(faucetPOST, "/api/faucet", {}, { user: "alice" });
      t.now += 61;
      await b.contract.worldTick();
      await b.stop();
      setServices(null);

      b = await make(); // no reset: everything is still there
      expect((await b.contract.getPlayer(acc))!.fils).toBe("50000");
      expect(b.contract.tick).toBe(1);
      await b.stop();

      b = await make({ DEV_RESET: "1" });
      setServices(b.svc);
      expect(await b.contract.getPlayer(acc)).toBeNull();
      expect(b.contract.tick).toBe(0);
      expect((await b.svc.repo.db.query("select 1 from users")).length).toBe(0);
      const again = await signIn(undefined as never, stateGET, "alice"); // a fresh account is created on demand
      expect(again).not.toBe(acc);
      await b.stop();
    } finally {
      setServices(null);
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);

  it("the dev:reset script removes .data", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    const script = pkg.scripts["dev:reset"];
    expect(script).toBeTruthy();
    const work = join(process.cwd(), `.reset-script-test-${randomBytes(4).toString("hex")}`);
    mkdirSync(join(work, ".data", "dev-db"), { recursive: true });
    writeFileSync(join(work, ".data", "dev-contract.json"), "{}");
    try {
      execSync(script!, { cwd: work, stdio: "pipe" });
      expect(existsSync(join(work, ".data"))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("the dev ticker rescues a collapsed market and keeps money conserved; the real rules alone do not", async () => {
    // strict contract rules alone: with nobody shipping, Bandar runs out of grain (its staple)
    let now = START_TIME;
    const bare = new FakeContract({ now: () => now, strict: true });
    for (let i = 0; i < 100; i++) {
      now += 61;
      await bare.worldTick();
    }
    expect((await bare.getMerchant("bandar")).stock.grain).toBe(0);
    expect(bare.devKeepAlive).toBeTypeOf("function"); // exists, but only the dev ticker calls it

    const t = { now: START_TIME };
    const b = await devBackend(t);
    try {
      for (const g of GOOD_IDS) b.contract.testSetStock("bandar", g, 0);
      b.contract.testSetTreasury("bandar", 0n); // the test helper destroys 50,000 fils outside the books ...
      const drift = () => b.contract.audit().total - b.contract.audit().expected;
      const baseline = drift(); // ... so compare against the drift it caused: the keeper must add none of its own
      t.now += 61;
      await tickOnce(b.contract, b.svc);
      const m = await b.contract.getMerchant("bandar");
      for (const g of GOOD_IDS) {
        expect(m.stock[g]).toBeGreaterThanOrEqual(Math.floor(GOODS[g].target * 0.3) - 5); // lifted (minus one tick of consumption)
      }
      expect(BigInt(m.treasury)).toBeGreaterThanOrEqual(BigInt(PARAMS.MERCHANT_TREASURY_FILS) / 5n);
      expect(drift()).toBe(baseline); // the minted treasury is accounted for

      // a healthy market is left alone
      const before = await b.contract.getMerchant("dasht");
      expect(b.contract.devKeepAlive()).toEqual({ goods: 0, fils: 0n });
      expect(await b.contract.getMerchant("dasht")).toEqual(before);

      // a long run stays playable: no staple good of any city stays at zero after the keeper acts
      for (let i = 0; i < 150; i++) {
        t.now += 61;
        await tickOnce(b.contract, b.svc);
      }
      const world = await b.contract.getWorld();
      for (const mm of world.merchants) for (const g of GOOD_IDS) expect(mm.stock[g]).toBeGreaterThan(0);
      expect(drift()).toBe(baseline);
    } finally { await b.stop(); }
  }, TIMEOUT);
});
