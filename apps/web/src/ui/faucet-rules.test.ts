import { describe, expect, it } from "vitest";
import type { Player, Stall } from "@caravan/shared";
import {
  FAUCET_COOLDOWN_MOCK_SEC, FAUCET_COOLDOWN_REAL_SEC, FAUCET_TOO_RICH_TEXT, faucetBlockReason, faucetCooldownSec,
  faucetEligible, faucetRefusalText, faucetWorthFils, formatWait,
} from "./faucet-rules";

const me = (over: Partial<Player> = {}): Player => ({
  account_id: "me.test", display_name: "Me", fils: "0", location: "bandar",
  inventory: { grain: 0, salt: 0, iron: 0, spice: 0, silk: 0 }, journey: null, net_worth: "0", ...over,
});
const stall = (over: Partial<Stall>): Stall => ({ id: 1, seller: "me.test", city: "bandar", good: "grain", qty: 1, unit_price: "999", ...over });
const journey = (status: "IN_TRANSIT" | "ARRIVED" | "CLAIMED", cargo: Record<string, number>) =>
  ({ id: 1, from: "bandar", to: "shahr", cargo, guards: 0, started_at: 0, arrives_at: 1, risk_bp: 0, status }) as Player["journey"];

describe("faucetWorthFils (contract faucet_worth)", () => {
  it("counts coins and inventory at base prices (grain 1000, silk 20000 fils)", () => {
    const p = me({ fils: "1200", inventory: { grain: 2, salt: 0, iron: 0, spice: 0, silk: 1 } });
    expect(faucetWorthFils(p, [])).toBe(1200n + 2000n + 20000n);
  });

  it("adds goods in my own stalls (base value, not the asking price) and ignores other sellers", () => {
    const p = me({ fils: "100" });
    const stalls = [stall({ qty: 3, good: "salt" }), stall({ id: 2, seller: "someone.else", qty: 50, good: "silk" })];
    expect(faucetWorthFils(p, stalls)).toBe(100n + 3n * 1500n);
  });

  it("adds the cargo of a journey in transit but not of an arrived or claimed one", () => {
    expect(faucetWorthFils(me({ journey: journey("IN_TRANSIT", { iron: 2 }) }), [])).toBe(8000n);
    expect(faucetWorthFils(me({ journey: journey("ARRIVED", { iron: 2 }) }), [])).toBe(0n);
    expect(faucetWorthFils(me({ journey: journey("CLAIMED", { iron: 2 }) }), [])).toBe(0n);
  });

  it("sums all parts", () => {
    const p = me({
      fils: "1000", inventory: { grain: 1, salt: 0, iron: 0, spice: 0, silk: 0 },
      journey: journey("IN_TRANSIT", { grain: 1 }),
    });
    expect(faucetWorthFils(p, [stall({ qty: 1, good: "grain" })])).toBe(4000n);
  });
});

describe("eligibility", () => {
  it("is refused at exactly 5000 fils (50 coins), allowed at 4999", () => {
    expect(faucetEligible(4999n)).toBe(true);
    expect(faucetEligible(5000n)).toBe(false);
  });
  it("3 coins plus 4 grain in a stall (4300) is eligible, 5 grain (5300) is not", () => {
    expect(faucetEligible(faucetWorthFils(me({ fils: "300" }), [stall({ qty: 4 })]))).toBe(true);
    expect(faucetEligible(faucetWorthFils(me({ fils: "300" }), [stall({ qty: 5 })]))).toBe(false);
  });
});

describe("cooldown", () => {
  it("is 3600 s for the real contract and 60 s in the mock", () => {
    expect(faucetCooldownSec(false)).toBe(FAUCET_COOLDOWN_REAL_SEC);
    expect(FAUCET_COOLDOWN_REAL_SEC).toBe(3600);
    expect(faucetCooldownSec(true)).toBe(FAUCET_COOLDOWN_MOCK_SEC);
    expect(FAUCET_COOLDOWN_MOCK_SEC).toBe(60);
  });

  it("words the wait honestly", () => {
    expect(formatWait(3600)).toBe("about an hour");
    expect(formatWait(3400)).toBe("about an hour");
    expect(formatWait(1500)).toBe("about 25 minutes");
    expect(formatWait(61)).toBe("61 seconds");
    expect(formatWait(1)).toBe("1 second");
    expect(formatWait(-5)).toBe("0 seconds");
  });
});

describe("refusal messages", () => {
  it("RATE_LIMIT says about an hour in real mode and 60 seconds in the mock", () => {
    expect(faucetRefusalText("RATE_LIMIT", false)).toBe("Available again in about an hour.");
    expect(faucetRefusalText("RATE_LIMIT", true)).toBe("Available again in 60 seconds.");
  });
  it("BAD_REQUEST says the player still owns too much", () => {
    expect(faucetRefusalText("BAD_REQUEST", false)).toBe(FAUCET_TOO_RICH_TEXT);
    expect(FAUCET_TOO_RICH_TEXT).toMatch(/own too much/);
  });
  it("other codes fall back to the standard toast", () => {
    expect(faucetRefusalText("INTERNAL", false)).toBeNull();
  });
  it("block reason: too rich beats waiting; nothing blocks an eligible player with no wait", () => {
    expect(faucetBlockReason({ eligible: false, waitLeftSec: 100 })).toBe(FAUCET_TOO_RICH_TEXT);
    expect(faucetBlockReason({ eligible: true, waitLeftSec: 1800 })).toBe("Available again in about 30 minutes.");
    expect(faucetBlockReason({ eligible: true, waitLeftSec: 0 })).toBeNull();
  });
});
