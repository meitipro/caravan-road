import { describe, expect, it } from "vitest";
import { CITY_IDS, GOODS, GOOD_IDS, PARAMS, quote, tradeCost, type GoodId } from "@caravan/shared";
import { FakeContract } from "../contract/fake";
import { PLAYER_METHODS, nsToSec, secToNs, type PlayerKey } from "../contract/types";
import { ApiError, ContractPanic } from "../errors";
import { generateKey, playerKeyFromSeed } from "../near/custody";
import { playerAccountId } from "../near/accounts";
import { KeyedMutex } from "../near/relayer";
import { makeKit, START_TIME } from "./testkit";

function setup(opts: ConstructorParameters<typeof FakeContract>[0] = {}) {
  let now = START_TIME;
  const c = new FakeContract({ now: () => now, ...opts });
  const advance = (s: number) => { now += s; };
  const mk = async (name: string) => {
    const k = generateKey();
    const key: PlayerKey = playerKeyFromSeed(k.seed, k.publicKey);
    await c.createPlayerAccount(name, k.publicKey);
    await c.playerCall(name, "register", {}, key);
    return key;
  };
  return { c, advance, mk };
}

const rejects = (p: Promise<unknown>, code: string) => expect(p).rejects.toThrow(new RegExp(`^${code}:`));

describe("FakeContract follows spec/ECONOMY.md", () => {
  it("prices trades with the shared tradeCost (golden vector: grain at target stock)", async () => {
    const { c, mk } = setup();
    const key = await mk("a.t");
    await c.playerCall("a.t", "faucet", {}, key);
    expect(quote({ good: "grain", stock: 200, spreadBp: 800, biasBp: 0 })).toEqual({ bid: "960", mid: "1000", ask: "1040" });
    const out = await c.playerCall("a.t", "trade", { merchant: "bandar", good: "grain", side: "buy", qty: 10, limit_total: "99999" }, key);
    const cost = tradeCost({ good: "grain", side: "buy", qty: 10, merchantStock: 200, spreadBp: 800, biasBp: 0 });
    expect(out.returnValue).toEqual({ total: cost.total.toString(), fee: cost.fee.toString() });
    expect(cost.unit).toBe(1047n); // ask at midpoint stock 195: mult 10075, mid 1007, ask 1047 (spec-v1.2, MULT_K_BP 3000; spec-v1.1 gave 1050)
    expect(out.events.map((e) => e.event)).toEqual(["trade"]);
  });

  it("rejects a delegate signed with the wrong key", async () => {
    const { c, mk } = setup();
    await mk("a.t");
    const other = generateKey();
    await rejects(c.playerCall("a.t", "faucet", {}, playerKeyFromSeed(other.seed, other.publicKey)), "INTERNAL");
  });

  it("faucet: PLAY only with a cooldown; LIVE rejects", async () => {
    const { c, advance, mk } = setup();
    const key = await mk("a.t");
    await c.playerCall("a.t", "faucet", {}, key);
    await rejects(c.playerCall("a.t", "faucet", {}, key), "RATE_LIMIT");
    advance(60);
    await c.playerCall("a.t", "faucet", {}, key);
    const live = setup({ mode: "LIVE" });
    const k2 = await live.mk("b.t");
    await rejects(live.c.playerCall("b.t", "faucet", {}, k2), "MODE_NOT_ALLOWED");
  });

  it("guards multiply ambush risk by 0.65 each (truncating) and cost 2% of base value each", async () => {
    const { c, mk } = setup();
    const key = await mk("a.t");
    c.testGrantFils("a.t", 100000n);
    c.testGrantGoods("a.t", "iron", 10);
    const expected = [2000, 1300, 845, 549];
    for (let g = 0; g <= 3; g++) {
      const p = (await c.getPlayer("a.t"))!;
      const fils0 = BigInt(p.fils);
      c.testSetLocation("a.t", "madan");
      const j = await c.playerCall("a.t", "start_journey", { to: "bandar", cargo: { iron: 1 }, guards: g }, key);
      expect((j.returnValue as { risk_bp: number }).risk_bp).toBe(expected[g]);
      expect(fils0 - BigInt((await c.getPlayer("a.t"))!.fils)).toBe((4000n * 200n * BigInt(g)) / 10000n);
      // reset
      (c as unknown as { players: Map<string, { journey: unknown; inventory: Record<GoodId, number> }> }).players.get("a.t")!.journey = null;
      c.testGrantGoods("a.t", "iron", 1);
    }
    expect(c.audit().total).toBe(c.audit().expected);
  });

  it("deposits: cap of 20 USDC, duplicate reference ignored, LIVE only", async () => {
    const { c, mk } = setup({ mode: "LIVE" });
    await mk("a.t");
    const r1 = await c.operatorCall("credit_deposit", { account_id: "a.t", fils: "150000", reference: "r1" });
    expect(r1.returnValue).toEqual({ credited: true });
    expect((await c.operatorCall("credit_deposit", { account_id: "a.t", fils: "150000", reference: "r1" })).returnValue).toEqual({ credited: false });
    await rejects(c.operatorCall("credit_deposit", { account_id: "a.t", fils: "60000", reference: "r2" }), "RATE_LIMIT");
    expect((await c.getPlayer("a.t"))!.fils).toBe("150000");
    const play = setup();
    await play.mk("b.t");
    await rejects(play.c.operatorCall("credit_deposit", { account_id: "b.t", fils: "1", reference: "x" }), "MODE_NOT_ALLOWED");
  });

  it("withdrawals: daily cap with day rollover, refund restores the balance exactly, no double refund", async () => {
    const { c, advance, mk } = setup({ mode: "LIVE" });
    const key = await mk("a.t");
    c.testGrantFils("a.t", 300000n);
    const w = (fils: string) => c.playerCall("a.t", "request_withdraw", { fils, dest_asset: "usdc", dest_address: "d" }, key);
    const id = (await w("100000")).returnValue as number;
    await rejects(w("1"), "BAD_REQUEST");
    advance(86400);
    await w("1");
    expect((await c.getPlayer("a.t"))!.fils).toBe("199999");
    await c.operatorCall("refund_withdraw", { id });
    expect((await c.getPlayer("a.t"))!.fils).toBe("299999");
    await rejects(c.operatorCall("refund_withdraw", { id }), "BAD_REQUEST");
    await rejects(c.operatorCall("mark_withdraw", { id, reference: "x" }), "BAD_REQUEST");
    expect(c.audit().total).toBe(c.audit().expected);
  });

  it("paused blocks everything except refund_withdraw and set_paused", async () => {
    const { c, mk } = setup({ mode: "LIVE" });
    const key = await mk("a.t");
    c.testGrantFils("a.t", 1000n);
    const id = (await c.playerCall("a.t", "request_withdraw", { fils: "500", dest_asset: "u", dest_address: "d" }, key)).returnValue as number;
    await c.operatorCall("set_paused", { paused: true });
    await rejects(c.playerCall("a.t", "trade", { merchant: "bandar", good: "grain", side: "buy", qty: 1, limit_total: "9999" }, key), "PAUSED");
    await rejects(c.worldTick(), "PAUSED");
    await rejects(c.operatorCall("credit_deposit", { account_id: "a.t", fils: "1", reference: "q" }), "PAUSED");
    await c.operatorCall("refund_withdraw", { id });
    expect((await c.getPlayer("a.t"))!.fils).toBe("1000");
    await c.operatorCall("set_paused", { paused: false });
  });

  it("world_tick: 240 ticks conserve money, clamp stock to [0, 2x target], 55 s minimum and 10 missed ticks", async () => {
    const { c, advance, mk } = setup();
    const key = await mk("a.t");
    await c.playerCall("a.t", "faucet", {}, key);
    advance(10);
    expect((await c.worldTick()).returnValue).toMatchObject({ ticks: 0 });
    advance(50);
    expect((await c.worldTick()).returnValue).toMatchObject({ ticks: 1 });
    advance(60 * 100);
    expect((await c.worldTick()).returnValue).toMatchObject({ ticks: 10 });
    for (let i = 0; i < 238; i++) {
      advance(60);
      await c.worldTick();
      const w = await c.getWorld();
      expect(c.audit().total).toBe(c.audit().expected);
      for (const m of w.merchants) {
        for (const g of GOOD_IDS) {
          expect(m.stock[g]).toBeGreaterThanOrEqual(0);
          expect(m.stock[g]).toBeLessThanOrEqual(GOODS[g].cap);
        }
      }
    }
    expect(c.tick).toBe(1 + 10 + 238);
    // goods flowed: production minus consumption changes stock somewhere
    const w = await c.getWorld();
    expect(w.merchants.some((m) => GOOD_IDS.some((g) => m.stock[g] !== GOODS[g].target))).toBe(true);
    expect(PARAMS.TICK_SECONDS).toBe(60);
    expect(CITY_IDS).toHaveLength(4);
  });

  it("converts nanoseconds and seconds without float error", () => {
    expect(nsToSec("1800000000999999999")).toBe(1_800_000_000);
    expect(secToNs(1_800_000_000)).toBe("1800000000000000000");
  });
});

describe("relayer and account service", () => {
  it("only relays the player methods, never an operator method", async () => {
    const kit = await makeKit();
    try {
      const user = await kit.svc.repo.upsertUser({ id: "u1", provider: "t", subject: "s", email: null, name: "N", now: 1 });
      const ready = await kit.svc.accounts.ensure(user);
      expect(PLAYER_METHODS).not.toContain("credit_deposit");
      await expect(kit.svc.relayer.submit(ready, "credit_deposit" as never, {} as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(kit.svc.relayer.submit(ready, "set_paused" as never, {} as never)).rejects.toBeInstanceOf(ApiError);
      expect(kit.contract.calls.filter((c) => c.method === "credit_deposit" || c.method === "set_paused")).toHaveLength(0);
    } finally { await kit.close(); }
  }, 60_000);

  it("rejects any call that would attach a deposit", async () => {
    const kit = await makeKit();
    try {
      const user = await kit.svc.accounts.ensure(await kit.svc.repo.upsertUser({ id: "u1", provider: "t", subject: "s", email: null, name: "N", now: 1 }));
      await expect(kit.svc.relayer.submit(user, "faucet", {}, { deposit: 1n })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/deposit/) });
      await expect(kit.svc.relayer.submit(user, "faucet", {}, { deposit: 0n })).resolves.toBeTruthy();
    } finally { await kit.close(); }
  }, 60_000);

  it("maps contract panics to ErrorCodes and reports a missing custody record as INTERNAL", async () => {
    const kit = await makeKit();
    try {
      const user = await kit.svc.accounts.ensure(await kit.svc.repo.upsertUser({ id: "u1", provider: "t", subject: "s", email: null, name: "N", now: 1 }));
      await expect(kit.svc.relayer.submit(user, "claim_journey", {})).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(kit.svc.relayer.submit(user, "trade", { merchant: "dasht", good: "grain", side: "buy", qty: 1, limit_total: "1" })).rejects.toMatchObject({ code: "NOT_IN_CITY" });
      await kit.db.query("delete from custody_keys");
      await expect(kit.svc.relayer.submit(user, "faucet", {})).rejects.toMatchObject({ code: "INTERNAL" });
    } finally { await kit.close(); }
  }, 60_000);

  it("account ids are p<8hex>.<root>; ensure() is idempotent for a registered user", async () => {
    expect(playerAccountId("root.fake", new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("pdeadbeef.root.fake");
    const kit = await makeKit();
    try {
      const u = await kit.svc.repo.upsertUser({ id: "u1", provider: "t", subject: "s", email: null, name: "N", now: 1 });
      const a = await kit.svc.accounts.ensure(u);
      const b = await kit.svc.accounts.ensure(u);
      expect(b.near_account_id).toBe(a.near_account_id);
      expect(a.account_status).toBe("REGISTERED");
      expect(kit.contract.calls.filter((c) => c.method === "register")).toHaveLength(1);
    } finally { await kit.close(); }
  }, 60_000);

  it("KeyedMutex runs work for one key strictly in order", async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    const slow = m.run("k", async () => { await new Promise((r) => setTimeout(r, 20)); log.push("a"); });
    const fast = m.run("k", async () => { log.push("b"); });
    const other = m.run("z", async () => { log.push("z"); });
    await Promise.all([slow, fast, other]);
    expect(log.indexOf("a")).toBeLessThan(log.indexOf("b"));
    await expect(m.run("k", async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(m.run("k", async () => "still works")).resolves.toBe("still works");
    expect(ContractPanic).toBeDefined();
  });
});
