// The worker's view of get_world against the REAL contract JSON (contracts/caravan/fixtures/contract-json.json,
// written by the contract's own Rust tests).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CITY_IDS } from "@caravan/shared";
import { parseWorldView } from "../src/chain-near.js";

const fixture = JSON.parse(readFileSync(new URL("../../../contracts/caravan/fixtures/contract-json.json", import.meta.url), "utf8")) as {
  play: { views: { get_world: { tick: number; now_ns: string; merchants: Array<{ id: string; treasury: string; policy: { spread_bp: number; bias_bp: number } }> } } };
};

describe("parseWorldView on the contract's real get_world", () => {
  it("maps every merchant, the tick and the chain time", () => {
    const w = fixture.play.views.get_world;
    const s = parseWorldView(w, () => 0);
    expect(s.tick).toBe(w.tick);
    expect(s.now).toBe(Number(BigInt(w.now_ns) / 1_000_000_000n));
    for (const c of CITY_IDS) {
      const raw = w.merchants.find((m) => m.id === c)!;
      expect(s.merchants[c].treasury).toBe(BigInt(raw.treasury));
      expect(s.merchants[c].policy).toEqual(raw.policy);
    }
  });
});
