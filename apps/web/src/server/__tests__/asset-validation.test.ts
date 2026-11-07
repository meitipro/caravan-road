// F3 (server side): assets are validated against the 1Click token list BEFORE any money moves.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorCode } from "@caravan/shared";
import { GET as stateGET } from "../../app/api/state/route";
import { POST as depositQuotePOST } from "../../app/api/deposit/quote/route";
import { POST as withdrawPOST } from "../../app/api/withdraw/route";
import { GET as tokensGET } from "../../app/api/tokens/route";
import { unconfiguredIntents } from "../intents/unconfigured";
import { get, makeKit, post, signIn, type Kit } from "./testkit";

const TIMEOUT = 120_000;

function expectErr(r: { json: { ok: boolean; error?: { code: string; message: string } } }, code: ErrorCode, message?: RegExp) {
  expect(r.json.ok).toBe(false);
  expect(r.json.error?.code).toBe(code);
  if (message) expect(r.json.error?.message).toMatch(message);
}

let open: Kit | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  if (open) await open.close();
  open = null;
});
const live = async (): Promise<Kit> => (open = await makeKit({ mode: "LIVE" }));

const quote = (user: string, amount_in: string, origin_asset = "nep141:usdc.fake") =>
  post(depositQuotePOST, "/api/deposit/quote", { origin_asset, amount_in, refund_address: "refund.fake" }, { user });
const withdraw = (user: string, fils: string, dest_asset = "nep141:usdc.fake", dest_address = "dest.fake") =>
  post(withdrawPOST, "/api/withdraw", { fils, dest_asset, dest_address }, { user });

describe("F3: assets are validated against the 1Click token list before any money moves", () => {
  it("withdraw: an unsupported dest_asset is BAD_REQUEST 'That asset is not supported'; no reservation, no chain call, no debit", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "alice");
    kit.contract.testGrantFils(acc, 50000n);
    const r = await withdraw("alice", "5000", "usdc-near");
    expectErr(r, "BAD_REQUEST", /^That asset is not supported$/);
    expect(await kit.db.query("select 1 from withdrawals")).toHaveLength(0);
    expect(kit.contract.calls.filter((c) => c.method === "request_withdraw")).toHaveLength(0);
    expect(BigInt((await kit.contract.getPlayer(acc))!.fils)).toBe(50000n);
    // A listed id works.
    expect((await withdraw("alice", "5000", "nep141:usdc.fake")).json.ok).toBe(true);
  }, TIMEOUT);

  it("withdraw: the token list is asked BEFORE the treasury balance and before reserving", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "bob");
    kit.contract.testGrantFils(acc, 50000n);
    const order: string[] = [];
    const tb = kit.intents.treasuryBalanceFils.bind(kit.intents);
    const lt = kit.intents.listTokens.bind(kit.intents);
    kit.intents.treasuryBalanceFils = async () => { order.push("treasury"); return tb(); };
    kit.intents.listTokens = async () => { order.push("tokens"); return lt(); };
    await withdraw("bob", "5000", "nope");
    expect(order).toEqual(["tokens"]);
  }, TIMEOUT);

  it("deposit quote: an unsupported origin_asset is BAD_REQUEST and 1Click is never asked for a quote", async () => {
    const kit = await live();
    await signIn(kit, stateGET, "carol");
    const r = await quote("carol", "1000", "usdc-near");
    expectErr(r, "BAD_REQUEST", /^That asset is not supported$/);
    expect(kit.intents.quotes.size).toBe(0);
    expect(await kit.db.query("select 1 from deposits")).toHaveLength(0);
    expect((await quote("carol", "1000", "nep141:usdc.fake")).json.ok).toBe(true);
  }, TIMEOUT);

  it("if the token list cannot be read the money route fails closed (PAUSED) rather than guessing", async () => {
    const kit = await live();
    const acc = await signIn(kit, stateGET, "dan");
    kit.contract.testGrantFils(acc, 50000n);
    kit.intents.listTokens = async () => { throw new Error("1click down"); };
    expectErr(await withdraw("dan", "5000"), "PAUSED");
    expectErr(await quote("dan", "1000"), "PAUSED");
    expect(kit.contract.calls.filter((c) => c.method === "request_withdraw")).toHaveLength(0);
  }, TIMEOUT);
});

describe("GET /api/tokens", () => {
  it("is public in LIVE and lists id, symbol, chain and decimals only", async () => {
    const kit = await live();
    const r = await get(tokensGET, "/api/tokens"); // no user
    expect(r.json.ok).toBe(true);
    expect(r.json.data.assets).toEqual([
      { id: "nep141:eth.fake", symbol: "ETH", chain: "eth", decimals: 18 },
      { id: "nep141:usdc.fake", symbol: "USDC", chain: "near", decimals: 6 },
    ]);
    expect(Object.keys(r.json.data.assets[0]).sort()).toEqual(["chain", "decimals", "id", "symbol"]);
    // every id it returns is accepted by the money routes
    await signIn(kit, stateGET, "alice");
    for (const a of r.json.data.assets as Array<{ id: string }>) expect((await quote("alice", "100", a.id)).json.ok).toBe(true);
  }, TIMEOUT);

  it("is cached: a second request inside the TTL does not ask the provider again", async () => {
    const kit = await live();
    let n = 0;
    const lt = kit.intents.listTokens.bind(kit.intents);
    kit.intents.listTokens = async () => { n++; return lt(); };
    await get(tokensGET, "/api/tokens");
    await get(tokensGET, "/api/tokens");
    expect(n).toBe(1);
    kit.clock.advance(61);
    await get(tokensGET, "/api/tokens");
    expect(n).toBe(2);
  }, TIMEOUT);

  it("is MODE_NOT_ALLOWED in PLAY and PAUSED when Intents is not configured or down", async () => {
    const play = await makeKit({ mode: "PLAY" });
    try {
      expectErr(await get(tokensGET, "/api/tokens"), "MODE_NOT_ALLOWED");
    } finally { await play.close(); }
    const kit = await live();
    kit.svc.intents = unconfiguredIntents;
    expectErr(await get(tokensGET, "/api/tokens"), "PAUSED");
    kit.svc.intents = kit.intents;
    kit.intents.listTokens = async () => { throw new Error("1click down"); };
    kit.svc.tokensCache.invalidate();
    expectErr(await get(tokensGET, "/api/tokens"), "PAUSED");
  }, TIMEOUT);
});
