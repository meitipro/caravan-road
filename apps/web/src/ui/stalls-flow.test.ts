import { describe, expect, it } from "vitest";
import { createMockApiClient, type ApiClient, type Player, type WorldState } from "@caravan/shared";
import {
  buyProblem, maxStallBuyQty, myStalls, stallErrorText, stallFee, stallPrice, stallsForSale, validateCreate,
} from "./stall-math";
import { cargoUnits } from "./trade-math";

// The create / buy / cancel flow of the stalls screen against the in-memory mock (NEXT_PUBLIC_MOCK=1), using the
// same helpers the screen uses to build its requests. The mock follows the contract rule: the SELLER pays the fee.

function setup() {
  let t = 1_800_000_000;
  const api = createMockApiClient({ now: () => t, seed: 1 });
  return { api, advance: (s: number) => { t += s; } };
}

async function state(api: ApiClient): Promise<{ world: WorldState; me: Player }> {
  const r = await api.getState();
  if (!r.ok) throw new Error(r.error.message);
  return { world: r.data.world, me: r.data.me! };
}

async function buyGrain(api: ApiClient, qty: number): Promise<Player> {
  const r = await api.trade({ merchant: "bandar", good: "grain", side: "buy", qty, limit_total: "99999999" });
  if (!r.ok) throw new Error(r.error.message);
  return r.data.player;
}

describe("stalls flow on the mock: create and cancel in Bandar", () => {
  it("lists a created stall under Your stalls, takes the goods out of the inventory, and cancel returns them", async () => {
    const { api } = setup();
    const player = await buyGrain(api, 10);
    expect(player.inventory.grain).toBe(10);

    // the form: 6 of 10 grain at 11.50 each
    const check = validateCreate({ good: "grain", qty: 6, held: player.inventory.grain, priceInput: "11.50", openStalls: 0 });
    expect(check).toEqual({ problem: null, unit: 1150n });
    const created = await api.stallCreate({ good: "grain", qty: 6, unit_price: check.unit!.toString() });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.stall).toMatchObject({ city: "bandar", good: "grain", qty: 6, unit_price: "1150", seller: player.account_id });

    const s1 = await state(api);
    expect(s1.me.inventory.grain).toBe(4);
    expect(myStalls(s1.world.stalls, s1.me.account_id).map((s) => s.id)).toEqual([created.data.stall.id]);
    // own stalls never appear in the "for sale" list, and the fixture stall (shahr) is not in bandar
    expect(stallsForSale(s1.world.stalls, "bandar", s1.me.account_id)).toEqual([]);
    expect(stallsForSale(s1.world.stalls, "shahr", s1.me.account_id)).toHaveLength(1);

    const cancelled = await api.stallCancel({ stall_id: created.data.stall.id });
    expect(cancelled.ok && cancelled.data.player.inventory.grain).toBe(10);
    const s2 = await state(api);
    expect(myStalls(s2.world.stalls, s2.me.account_id)).toEqual([]);
    expect(s2.world.stalls.map((s) => s.id)).toEqual([1]); // only the fixture stall is left
  });

  it("cannot list more than held, cannot buy one's own stall, cannot cancel someone else's", async () => {
    const { api } = setup();
    await buyGrain(api, 3);
    const tooMany = await api.stallCreate({ good: "grain", qty: 4, unit_price: "1000" });
    expect(!tooMany.ok && tooMany.error.code).toBe("INSUFFICIENT_STOCK");
    if (!tooMany.ok) expect(stallErrorText("create", tooMany.error.code)).toMatch(/do not hold that many/);

    const created = await api.stallCreate({ good: "grain", qty: 2, unit_price: "1000" });
    if (!created.ok) throw new Error("create failed");
    const own = await api.stallBuy({ stall_id: created.data.stall.id, qty: 1, limit_total: "1000" });
    expect(!own.ok && own.error.code).toBe("BAD_REQUEST");

    const fixture = await api.stallCancel({ stall_id: 1 }); // the fixture stall belongs to trader.fixture
    expect(!fixture.ok && fixture.error.code).toBe("BAD_REQUEST");
    if (!fixture.ok) expect(stallErrorText("cancel", fixture.error.code)).toMatch(/already gone/);
  });

  it("rejects a zero quantity and a missing price at the API boundary as BAD_REQUEST", async () => {
    const { api } = setup();
    await buyGrain(api, 2);
    const zero = await api.stallCreate({ good: "grain", qty: 0, unit_price: "1000" });
    expect(!zero.ok && zero.error.code).toBe("BAD_REQUEST");
    const noPrice = await api.stallCreate({ good: "grain", qty: 1, unit_price: "" });
    expect(!noPrice.ok && noPrice.error.code).toBe("BAD_REQUEST");
  });

  it("cannot create or buy while travelling (IN_TRANSIT)", async () => {
    const { api } = setup();
    await buyGrain(api, 5);
    const j = await api.journeyStart({ to: "shahr", cargo: { grain: 3 }, guards: 0 });
    expect(j.ok).toBe(true);
    const create = await api.stallCreate({ good: "grain", qty: 1, unit_price: "1000" });
    expect(!create.ok && create.error.code).toBe("IN_TRANSIT");
    const buy = await api.stallBuy({ stall_id: 1, qty: 1, limit_total: "99999999" });
    expect(!buy.ok && buy.error.code).toBe("IN_TRANSIT");
  });
});

describe("stalls flow on the mock: buy from the fixture stall in Shahr", () => {
  it("is refused in another city (NOT_IN_CITY) and works after arriving, charging the exact price only", async () => {
    const { api, advance } = setup();
    await buyGrain(api, 10);

    // in Bandar the fixture stall (Shahr) cannot be bought
    const early = await api.stallBuy({ stall_id: 1, qty: 1, limit_total: "99999999" });
    expect(!early.ok && early.error.code).toBe("NOT_IN_CITY");
    if (!early.ok) expect(stallErrorText("buy", early.error.code)).toMatch(/seller is away/);

    const j = await api.journeyStart({ to: "shahr", cargo: { grain: 10 }, guards: 0 });
    if (!j.ok) throw new Error(j.error.message);
    advance(j.data.journey.arrives_at - j.data.journey.started_at + 1);
    const claim = await api.journeyClaim();
    if (!claim.ok) throw new Error(claim.error.message);

    const s = await state(api);
    expect(s.me.location).toBe("shahr");
    const list = stallsForSale(s.world.stalls, "shahr", s.me.account_id);
    expect(list).toHaveLength(1);
    const stall = list[0]!;
    expect(stall).toMatchObject({ good: "salt", qty: 12, unit_price: "1700" });

    // the sheet: quantity 3, exact price, limit_total = price
    const fils = BigInt(s.me.fils);
    const carried = cargoUnits(s.me.inventory);
    expect(maxStallBuyQty(stall, fils, carried)).toBeGreaterThanOrEqual(3);
    expect(buyProblem(stall, 3, fils, carried)).toBeNull();
    const price = stallPrice(stall.unit_price, 3);
    expect(price).toBe(5100n);
    const tight = await api.stallBuy({ stall_id: stall.id, qty: 3, limit_total: (price - 1n).toString() });
    expect(!tight.ok && tight.error.code).toBe("SLIPPAGE");

    const bought = await api.stallBuy({ stall_id: stall.id, qty: 3, limit_total: price.toString() });
    if (!bought.ok) throw new Error(bought.error.message);
    expect(BigInt(bought.data.player.fils)).toBe(fils - price); // no fee on top for the buyer
    expect(bought.data.player.inventory.salt).toBe(s.me.inventory.salt + 3);
    expect(stallFee(price)).toBe(102n); // 2% of 51.00 is paid by the seller, not shown as a cost to the buyer

    const after = await state(api);
    expect(after.world.stalls.find((x) => x.id === stall.id)?.qty).toBe(9);
  });

  it("removes a stall that is bought out, and then reports it as gone", async () => {
    const { api, advance } = setup();
    // rich enough: buy grain in Bandar, travel, then buy all 12 salt
    await buyGrain(api, 10);
    const j = await api.journeyStart({ to: "shahr", cargo: { grain: 10 }, guards: 0 });
    if (!j.ok) throw new Error(j.error.message);
    advance(200);
    await api.journeyClaim();
    const sell = await api.trade({ merchant: "shahr", good: "grain", side: "sell", qty: 10, limit_total: "0" });
    expect(sell.ok).toBe(true);
    const price = stallPrice("1700", 12);
    const all = await api.stallBuy({ stall_id: 1, qty: 12, limit_total: price.toString() });
    expect(all.ok).toBe(true);
    const s = await state(api);
    expect(s.world.stalls).toEqual([]);
    const again = await api.stallBuy({ stall_id: 1, qty: 1, limit_total: "1700" });
    expect(!again.ok && again.error.code).toBe("BAD_REQUEST");
    if (!again.ok) expect(stallErrorText("buy", again.error.code)).toMatch(/gone/);
  });

  it("refuses a purchase beyond the stall's quantity as INSUFFICIENT_STOCK", async () => {
    const { api, advance } = setup();
    await buyGrain(api, 10);
    const j = await api.journeyStart({ to: "shahr", cargo: { grain: 10 }, guards: 0 });
    if (!j.ok) throw new Error(j.error.message);
    advance(200);
    await api.journeyClaim();
    const r = await api.stallBuy({ stall_id: 1, qty: 13, limit_total: "99999999" });
    expect(!r.ok && r.error.code).toBe("INSUFFICIENT_STOCK");
    if (!r.ok) expect(stallErrorText("buy", r.error.code)).toMatch(/fewer units/);
  });
});
