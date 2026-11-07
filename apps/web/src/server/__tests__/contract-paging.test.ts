// F5 / F6: the contract pages its list views (at most 100 per call; get_stalls applies the city filter INSIDE the page),
// so the server must walk every page and filter client-side. The provider below pages exactly like views.rs.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import { NearContract } from "../contract/near";
import type { ContractPlayer } from "../contract/types";
import { getLeaderboard } from "../game/state";
import { makeKit, type Kit } from "./testkit";

const CITIES = ["dasht", "madan", "bandar", "shahr"] as const;
const MAX_PAGE = 100;

interface Call { method: string; args: Record<string, unknown> }

/** A provider whose get_stalls / get_players / get_world behave like contracts/caravan/src/views.rs. */
function pagedProvider(stallCount: number, playerCount = 0) {
  const calls: Call[] = [];
  const stalls = Array.from({ length: stallCount }, (_, i) => ({
    id: i, seller: `s${i}.players.test`, city: CITIES[i % 4]!, good: "grain", qty: 1, unit_price: "1000",
  }));
  const players = Array.from({ length: playerCount }, (_, i) => ({
    account_id: `p${i}.players.test`, fils: String(1000 + i), location: "dasht", inventory: {}, journey: null, total_deposited: "0",
  }));
  const page = (a: Record<string, unknown>) => {
    const from = Number(a.from_index ?? 0);
    const lim = Math.min(Number(a.limit ?? MAX_PAGE), MAX_PAGE);
    return { from, lim };
  };
  const provider = {
    async callFunction({ method, args }: { method: string; args: Record<string, unknown> }) {
      calls.push({ method, args });
      if (method === "get_stalls") {
        const { from, lim } = page(args);
        return stalls.slice(from, from + lim).filter((s) => args.city === undefined || args.city === null || s.city === args.city);
      }
      if (method === "get_players") {
        const { from, lim } = page(args);
        return players.slice(from, from + lim);
      }
      if (method === "get_world") {
        return {
          tick: 1, now_ns: "1", mode: "PLAY", paused: false, house: "0", merchants: [], player_count: playerCount, stall_count: stallCount,
        };
      }
      throw new Error(`unexpected view ${method}`);
    },
  };
  return { provider: provider as unknown as JsonRpcProvider, calls };
}

const make = (provider: JsonRpcProvider) => new NearContract({
  network: "testnet", contractId: "c.test", relayerAccountId: "r.test", relayerPrivateKey: KeyPair.fromRandom("ed25519").toString(),
  operatorAccountId: "o.test", operatorPrivateKey: KeyPair.fromRandom("ed25519").toString(), provider,
});

describe("F5: NearContract pages get_stalls and filters by city client-side", () => {
  it("getStalls() returns every stall beyond the first 100", async () => {
    const { provider, calls } = pagedProvider(250);
    const stalls = await make(provider).getStalls();
    expect(stalls).toHaveLength(250);
    expect(new Set(stalls.map((s) => s.id)).size).toBe(250);
    expect(calls.map((c) => c.args.from_index)).toEqual([0, 100, 200]);
  });

  it("getStalls(city) never passes the city to the contract (it would filter inside the page) and still finds them all", async () => {
    const { provider, calls } = pagedProvider(450);
    const stalls = await make(provider).getStalls("shahr");
    const expected = Array.from({ length: 450 }, (_, i) => i).filter((i) => CITIES[i % 4] === "shahr");
    expect(stalls.map((s) => s.id)).toEqual(expected);
    expect(stalls.every((s) => s.city === "shahr")).toBe(true);
    expect(calls.every((c) => !("city" in c.args))).toBe(true);
  });

  it("an exactly full last page costs one extra (empty) call; zero stalls costs one call", async () => {
    const full = pagedProvider(200);
    expect(await make(full.provider).getStalls()).toHaveLength(200);
    expect(full.calls.map((c) => c.args.from_index)).toEqual([0, 100, 200]);
    const none = pagedProvider(0);
    expect(await make(none.provider).getStalls()).toEqual([]);
    expect(none.calls).toHaveLength(1);
  });

  it("a stall seen on two pages (the list shifted between calls) is returned once", async () => {
    let n = 0;
    const row = (id: number) => ({ id, seller: "s.players.test", city: "dasht", good: "grain", qty: 1, unit_price: "1" });
    const provider = {
      async callFunction() {
        n++;
        return n === 1 ? Array.from({ length: 100 }, (_, i) => row(i)) : [row(99), row(100)];
      },
    } as unknown as JsonRpcProvider;
    const stalls = await make(provider).getStalls();
    expect(stalls.map((s) => s.id)).toEqual(Array.from({ length: 101 }, (_, i) => i));
  });

  it("getWorld includes every stall (all pages) and the contract's counts", async () => {
    const { provider } = pagedProvider(130, 7);
    const w = await make(provider).getWorld();
    expect(w.stalls).toHaveLength(130);
    expect(w.player_count).toBe(7);
    expect(w.stall_count).toBe(130);
  });
});

describe("F6: the leaderboard walks every page of players", () => {
  let kit: Kit;
  beforeAll(async () => { kit = await makeKit(); });
  afterAll(async () => { await kit.close(); });

  const synth = (n: number): ContractPlayer[] => Array.from({ length: n }, (_, i) => ({
    account_id: `p${i}.players.test`, fils: String(1000 + i), location: "dasht", inventory: {} as ContractPlayer["inventory"], journey: null, total_deposited: "0",
  }));

  it("finds a player at index 2300 (past the old 1000-player scan) and stops at the first short page", async () => {
    const all = synth(2350);
    const pages: number[] = [];
    vi.spyOn(kit.contract, "getPlayerCount").mockResolvedValue(all.length);
    vi.spyOn(kit.contract, "getPlayers").mockImplementation(async (from, limit) => { pages.push(from); return all.slice(from, from + Math.min(limit, 100)); });
    vi.spyOn(kit.svc.repo, "namesByAccount").mockImplementation(async (ids) => new Map(ids.filter((i) => i === "p2300.players.test").map((i) => [i, "Late Joiner"])));
    const board = await getLeaderboard(kit.svc);
    expect(board.rows).toEqual([{ name: "Late Joiner", net_worth: "3300" }]);
    expect(pages).toHaveLength(24); // 0..2300 step 100; the page at 2300 holds 50 rows, which is short
    expect(pages.at(-1)).toBe(2300);
  });

  it("the page count is bounded by player_count (a runaway view cannot loop forever)", async () => {
    const calls: number[] = [];
    vi.spyOn(kit.contract, "getPlayerCount").mockResolvedValue(250);
    // Every call returns a full page, forever.
    vi.spyOn(kit.contract, "getPlayers").mockImplementation(async (from) => { calls.push(from); return synth(100); });
    vi.spyOn(kit.svc.repo, "namesByAccount").mockResolvedValue(new Map());
    kit.svc.leaderboardCache.invalidate();
    await getLeaderboard(kit.svc);
    expect(calls.length).toBeLessThanOrEqual(5); // 250 players plus slack for growth, never unbounded
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("an absolute cap applies even when player_count is absurd", async () => {
    const calls: number[] = [];
    vi.spyOn(kit.contract, "getPlayerCount").mockResolvedValue(10_000_000);
    vi.spyOn(kit.contract, "getPlayers").mockImplementation(async (from) => { calls.push(from); return synth(100); });
    vi.spyOn(kit.svc.repo, "namesByAccount").mockResolvedValue(new Map());
    kit.svc.leaderboardCache.invalidate();
    await getLeaderboard(kit.svc);
    expect(calls.length).toBe(50); // 5000 players / 100
  });
});
