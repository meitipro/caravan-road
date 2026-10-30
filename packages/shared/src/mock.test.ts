import { describe, expect, it } from "vitest";
import { createApiClient } from "./api-client.js";
import { createMockApiClient } from "./mock.js";
import { quote } from "./quote.js";
import { GOOD_IDS } from "./world.js";

function setup(seed = 1) {
  let t = 1_800_000_000;
  const api = createMockApiClient({ now: () => t, seed });
  return { api, advance: (s: number) => { t += s; } };
}

async function state(api: ReturnType<typeof setup>["api"]) {
  const r = await api.getState();
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

describe("mock api client", () => {
  it("createApiClient({mock:true}) serves the mock", async () => {
    const s = await createApiClient({ mock: true }).getState();
    expect(s.ok && s.data.world.merchants).toHaveLength(4);
  });

  it("runs a tick every 5 seconds and keeps quotes consistent with quote()", async () => {
    const { api, advance } = setup();
    const before = await state(api);
    advance(5);
    const after = await state(api);
    expect(after.world.tick).toBe(before.world.tick + 1);
    advance(60);
    const later = await state(api);
    expect(later.world.tick).toBe(before.world.tick + 13);
    for (const m of later.world.merchants) {
      for (const g of GOOD_IDS) {
        expect(m.quotes[g]).toEqual(quote({ good: g, stock: m.stock[g], spreadBp: m.policy.spread_bp, biasBp: m.policy.bias_bp }));
      }
      for (const g of GOOD_IDS) expect(m.stock[g]).toBeGreaterThanOrEqual(0);
    }
    // dasht produces 8 grain per 60 s net of nothing: after 65 s its grain stock must have grown.
    const d0 = before.world.merchants.find((m) => m.id === "dasht")!.stock.grain;
    const d1 = later.world.merchants.find((m) => m.id === "dasht")!.stock.grain;
    expect(d1).toBeGreaterThan(d0);
  });

  it("buys in bandar, travels, and claims at the destination", async () => {
    const { api, advance } = setup();
    const s0 = await state(api);
    const bandar = s0.world.merchants.find((m) => m.id === "bandar")!;
    const buy = await api.trade({ merchant: "bandar", good: "spice", side: "buy", qty: 2, limit_total: "1000000" });
    expect(buy.ok).toBe(true);
    if (!buy.ok) return;
    expect(BigInt(buy.data.fee)).toBe((BigInt(buy.data.total) * 100n) / 10000n);
    expect(buy.data.player.inventory.spice).toBe(2);
    expect(BigInt(buy.data.player.fils)).toBe(50000n - BigInt(buy.data.total) - BigInt(buy.data.fee));
    expect(bandar.stock.spice).toBeGreaterThan(0);

    const start = await api.journeyStart({ to: "shahr", cargo: { spice: 2 }, guards: 0 });
    expect(start.ok && start.data.journey.arrives_at - start.data.journey.started_at).toBe(180);
    expect((await api.trade({ merchant: "bandar", good: "spice", side: "buy", qty: 1, limit_total: "1000000" })).ok).toBe(false);

    const early = await api.journeyClaim();
    expect(!early.ok && early.error.code).toBe("NOT_ARRIVED");
    advance(181);
    const claim = await api.journeyClaim();
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.data.player.location).toBe("shahr");
    expect(claim.data.player.journey).toBeNull();
  });

  it("maps failures to spec error codes", async () => {
    const { api } = setup();
    const wrongCity = await api.trade({ merchant: "dasht", good: "grain", side: "buy", qty: 1, limit_total: "99999" });
    expect(!wrongCity.ok && wrongCity.error.code).toBe("NOT_IN_CITY");
    const slip = await api.trade({ merchant: "bandar", good: "silk", side: "buy", qty: 1, limit_total: "1" });
    expect(!slip.ok && slip.error.code).toBe("SLIPPAGE");
    const broke = await api.trade({ merchant: "bandar", good: "silk", side: "buy", qty: 6, limit_total: "99999999" });
    expect(!broke.ok && broke.error.code).toBe("INSUFFICIENT_FUNDS");
    const bad = await api.trade({ merchant: "bandar", good: "silk", side: "buy", qty: 0, limit_total: "1" });
    expect(!bad.ok && bad.error.code).toBe("BAD_REQUEST");
    const dep = await api.depositQuote({ origin_asset: "x", amount_in: "1", refund_address: "y" });
    expect(!dep.ok && dep.error.code).toBe("MODE_NOT_ALLOWED");
  });

  it("rate-limits the faucet", async () => {
    const { api, advance } = setup();
    expect((await api.faucet()).ok).toBe(true);
    const again = await api.faucet();
    expect(!again.ok && again.error.code).toBe("RATE_LIMIT");
    advance(61);
    expect((await api.faucet()).ok).toBe(true);
  });

  it("ambush loses 30% of each good, truncated toward zero", async () => {
    // Search seeds for a run that is ambushed, so the assertion is deterministic.
    for (let seed = 1; seed < 400; seed++) {
      const { api, advance } = setup(seed);
      await api.trade({ merchant: "bandar", good: "grain", side: "buy", qty: 10, limit_total: "99999999" });
      const j = await api.journeyStart({ to: "madan", cargo: { grain: 10 }, guards: 0 });
      if (!j.ok) throw new Error("journey failed");
      advance(400);
      const c = await api.journeyClaim();
      if (c.ok && c.data.journey.ambushed) {
        expect(c.data.journey.lost).toEqual({ grain: 3 });
        expect(c.data.player.inventory.grain).toBe(7);
        return;
      }
    }
    throw new Error("no ambushed seed found");
  });
});

describe("mock stalls", () => {
  it("charges the buyer price plus a 2% fee and delivers the goods", async () => {
    const { api, advance } = setup();
    await api.trade({ merchant: "bandar", good: "grain", side: "buy", qty: 10, limit_total: "99999999" });
    const j = await api.journeyStart({ to: "shahr", cargo: { grain: 10 }, guards: 0 });
    expect(j.ok).toBe(true);
    advance(200);
    const c = await api.journeyClaim();
    if (!c.ok) throw new Error(c.error.message);
    const before = BigInt(c.data.player.fils);
    // fixture stall 1: 12 salt at 1700 fils in shahr
    const buy = await api.stallBuy({ stall_id: 1, qty: 2, limit_total: "99999999" });
    if (!buy.ok) throw new Error(buy.error.message);
    expect(BigInt(buy.data.player.fils)).toBe(before - 3400n - 68n);
    expect(buy.data.player.inventory.salt).toBe(2);
  });
});
