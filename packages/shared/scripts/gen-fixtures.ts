// Generates packages/shared/fixtures/*.json. Run: pnpm --filter @caravan/shared fixtures
// Quotes come from quote(); everything else is plausible sample data, not chain data.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { netWorthFils, quote } from "../src/quote.js";
import { CITY_IDS, GOODS, GOOD_IDS, PARAMS } from "../src/world.js";
import type { CityId, Decision, Merchant, Player, GoodId } from "../src/types.js";
import type { Event } from "../src/provisional.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
mkdirSync(dir, { recursive: true });

export const FIXTURE_NOW = 1793534400; // 2026-11-01 12:00:00 UTC
const POLICY = { spread_bp: PARAMS.SPREAD_DEFAULT_BP, bias_bp: 0 };
const TREASURY = String(PARAMS.MERCHANT_TREASURY_FILS);

// Stock near target, nudged per city/good so quotes differ.
const NUDGE: Record<CityId, Partial<Record<GoodId, number>>> = {
  dasht: { grain: 40, salt: 10, iron: -15, spice: -5, silk: -4 },
  madan: { grain: -30, salt: 8, iron: 20, spice: 3, silk: -3 },
  bandar: { grain: -20, salt: -12, iron: -25, spice: 12, silk: 9 },
  shahr: { grain: -10, salt: -30, iron: 5, spice: -10, silk: -8 },
};

const LINES: Record<CityId, string> = {
  dasht: "Harvest is in. Grain is cheap today.",
  madan: "Iron by the cartload, but we are short on grain.",
  bandar: "Ships are late. Spice and silk will not stay cheap.",
  shahr: "The capital pays well for salt.",
};

function merchant(id: CityId, i: number): Merchant {
  const stock = {} as Record<GoodId, number>;
  const quotes = {} as Merchant["quotes"];
  for (const g of GOOD_IDS) {
    stock[g] = Math.max(0, GOODS[g].target + (NUDGE[id][g] ?? 0));
    quotes[g] = quote({ good: g, stock: stock[g], spreadBp: POLICY.spread_bp, biasBp: POLICY.bias_bp });
  }
  return {
    id,
    account_id: `${id}.merchant.fixture`,
    treasury: TREASURY,
    stock,
    policy: { ...POLICY },
    quotes,
    mood: (["calm", "greedy", "worried", "generous"] as const)[i] ?? "calm",
    last_line: LINES[id],
    verified: i === 0
      ? { model: "fixture-model", request_id: "fixture-request-0001", attested: false, at: FIXTURE_NOW - 120 }
      : null,
  };
}

const merchants = CITY_IDS.map(merchant);

const world = {
  tick: 42,
  now: FIXTURE_NOW,
  mode: "PLAY",
  merchants,
  stalls: [{ id: 1, seller: "trader.fixture", city: "shahr", good: "salt", qty: 12, unit_price: "1700" }],
};

const zeroInv = () => Object.fromEntries(GOOD_IDS.map((g) => [g, 0])) as Record<GoodId, number>;

function player(p: Omit<Player, "net_worth">): Player {
  return { ...p, net_worth: netWorthFils(BigInt(p.fils), p.inventory).toString() };
}

const players = {
  newPlayerInBandar: player({
    account_id: "newbie.fixture", display_name: "Newbie", fils: "50000", location: "bandar",
    inventory: zeroInv(), journey: null,
  }),
  midJourney: player({
    account_id: "wanderer.fixture", display_name: "Wanderer", fils: "30000", location: "dasht",
    inventory: zeroInv(),
    journey: {
      id: 7, from: "dasht", to: "shahr", cargo: { grain: 20 }, guards: 1,
      started_at: FIXTURE_NOW - 60, arrives_at: FIXTURE_NOW + 180, risk_bp: 780, status: "IN_TRANSIT",
    },
  }),
  ambushResult: player({
    account_id: "unlucky.fixture", display_name: "Unlucky", fils: "28000", location: "shahr",
    inventory: { ...zeroInv(), grain: 14 },
    journey: {
      id: 5, from: "dasht", to: "shahr", cargo: { grain: 20 }, guards: 0,
      started_at: FIXTURE_NOW - 400, arrives_at: FIXTURE_NOW - 160, risk_bp: 1200, status: "CLAIMED",
      ambushed: true, lost: { grain: 6 },
    },
  }),
};

const t = (n: number) => FIXTURE_NOW - n;
const events: Event[] = [
  { id: 1, type: "tick", at: t(70), data: { tick: 41 } },
  { id: 2, type: "faucet", at: t(66), data: { account_id: "newbie.fixture", fils: "50000" } },
  { id: 3, type: "trade", at: t(64), data: { merchant: "dasht", good: "grain", side: "buy", qty: 20, total: "21000", fee: "210" } },
  { id: 4, type: "journey_started", at: t(60), data: { account_id: "wanderer.fixture", from: "dasht", to: "shahr", guards: 1 } },
  { id: 5, type: "policy", at: t(40), data: { merchant: "bandar", spread_bp: 800, bias_bp: 0 } },
  { id: 6, type: "stall_create", at: t(30), data: { seller: "trader.fixture", city: "shahr", good: "salt", qty: 12, unit_price: "1700" } },
  { id: 7, type: "journey_claimed", at: t(15), data: { account_id: "unlucky.fixture", ambushed: true, lost: { grain: 6 } } },
  { id: 8, type: "tick", at: t(10), data: { tick: 42 } },
];

const leaderboard = {
  rows: [
    { name: "Silk Baron", net_worth: "182400" },
    { name: "Salt Queen", net_worth: "97150" },
    { name: "Wanderer", net_worth: players.midJourney.net_worth },
    { name: "Unlucky", net_worth: players.ambushResult.net_worth },
    { name: "Newbie", net_worth: players.newPlayerInBandar.net_worth },
  ].sort((a, b) => (BigInt(b.net_worth) > BigInt(a.net_worth) ? 1 : -1)),
};

const decisions: Decision[] = merchants.map((m, i) => ({
  merchant: m.id,
  ts: FIXTURE_NOW - 120,
  spread_bp: m.policy.spread_bp,
  bias_bp: m.policy.bias_bp,
  mood: m.mood,
  ship: null,
  line: LINES[m.id],
  reason: "Fixture decision: stock is near target, keep the default policy.",
  source: i === 0 ? ("llm" as const) : ("baseline" as const),
  model: i === 0 ? "fixture-model" : null,
  request_id: i === 0 ? "fixture-request-0001" : null,
  attested: false,
  tx_hashes: [],
}));

const files: Record<string, unknown> = { world, players, events, leaderboard, decisions };
for (const [name, value] of Object.entries(files)) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
}
console.log(`wrote ${Object.keys(files).join(", ")} to ${dir}`);
