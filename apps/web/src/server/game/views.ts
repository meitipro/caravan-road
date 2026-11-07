// Contract views -> API types (spec/API.md section 2.12): seconds instead of nanoseconds, quotes from
// the shared quote(), net worth from the shared netWorthFils(), off-chain merchant fields (mood,
// last_line, verified) from the npc_decisions table (OPEN_QUESTIONS #13).

import {
  EVENT_TYPES, GOOD_IDS, netWorthFils, quote,
  type Event, type EventType, type GoodId, type Journey, type Merchant, type Player, type Stall, type WorldState,
} from "@caravan/shared";
import type { ContractEvent, ContractJourney, ContractMerchant, ContractPlayer, ContractStall, ContractWorld } from "../contract/types";
import { nsToSec } from "../contract/types";
import type { NpcDecisionRow } from "../db/repo";

const nonZero = (g: Partial<Record<GoodId, number>>): Partial<Record<GoodId, number>> => {
  const out: Partial<Record<GoodId, number>> = {};
  for (const id of GOOD_IDS) if ((g[id] ?? 0) > 0) out[id] = g[id];
  return out;
};

export function toApiJourney(j: ContractJourney, now: number): Journey {
  const arrives = nsToSec(j.arrives_at_ns);
  const out: Journey = {
    id: j.id, from: j.from, to: j.to, cargo: nonZero(j.cargo), guards: j.guards,
    started_at: nsToSec(j.started_at_ns), arrives_at: arrives, risk_bp: j.risk_bp,
    status: j.claimed ? "CLAIMED" : now >= arrives ? "ARRIVED" : "IN_TRANSIT",
  };
  if (j.claimed) {
    out.ambushed = j.ambushed;
    if (j.ambushed) out.lost = nonZero(j.lost);
  }
  return out;
}

export function toApiPlayer(p: ContractPlayer, displayName: string, now: number): Player {
  return {
    account_id: p.account_id, display_name: displayName, fils: p.fils, location: p.location,
    inventory: { ...p.inventory }, journey: p.journey ? toApiJourney(p.journey, now) : null,
    net_worth: netWorthFils(BigInt(p.fils), p.inventory).toString(),
  };
}

export function toApiStall(s: ContractStall): Stall {
  return { id: s.id, seller: s.seller, city: s.city, good: s.good, qty: s.qty, unit_price: s.unit_price };
}

// `line` is a plain English string. Rows stored before the English-only change hold {en, fa}: read .en.
interface DecisionOutput { mood?: Merchant["mood"]; line?: string | { en?: unknown } }

function parseOutput(row: NpcDecisionRow | null): DecisionOutput {
  if (!row) return {};
  try {
    return JSON.parse(row.output_json) as DecisionOutput;
  } catch {
    return {};
  }
}

/** The merchant line as one English string; tolerant of old stored rows ({en, fa} objects). */
export function lineText(line: DecisionOutput["line"]): string | null {
  if (typeof line === "string") return line;
  if (line && typeof line === "object" && typeof line.en === "string") return line.en;
  return null;
}

const MOODS = new Set(["calm", "greedy", "worried", "generous"]);

export function toApiMerchant(m: ContractMerchant, latest: NpcDecisionRow | null, proof: NpcDecisionRow | null): Merchant {
  const out = parseOutput(latest);
  const quotes = Object.fromEntries(
    GOOD_IDS.map((g) => [g, quote({ good: g, stock: m.stock[g], spreadBp: m.spread_bp, biasBp: m.bias_bp })]),
  ) as Merchant["quotes"];
  return {
    id: m.id, account_id: m.account_id, treasury: m.treasury, stock: { ...m.stock },
    policy: { spread_bp: m.spread_bp, bias_bp: m.bias_bp }, quotes,
    mood: out.mood && MOODS.has(out.mood) ? out.mood : "calm",
    last_line: lineText(out.line),
    verified: proof ? { model: proof.model ?? "unknown", request_id: proof.request_id ?? "", attested: proof.attested, at: proof.ts } : null,
  };
}

export function toApiWorld(w: ContractWorld, latest: NpcDecisionRow[], proofs: Map<string, NpcDecisionRow>): WorldState {
  const latestBy = new Map(latest.map((d) => [d.merchant, d]));
  return {
    tick: w.tick, now: nsToSec(w.now_ns), mode: w.mode,
    merchants: w.merchants.map((m) => toApiMerchant(m, latestBy.get(m.id) ?? null, proofs.get(m.id) ?? null)),
    stalls: w.stalls.map(toApiStall),
  };
}

const KNOWN = new Set<string>(EVENT_TYPES);

/**
 * Public event fields per type. Events go to unauthenticated callers, so account ids, destinations,
 * references and deposit/withdrawal details are dropped; `tx_hash` stays (the Advanced drawer links it).
 */
export const PUBLIC_EVENT_FIELDS: Record<EventType, readonly string[]> = {
  trade: ["merchant", "good", "side", "qty", "total", "fee"],
  policy: ["merchant", "spread_bp", "bias_bp"],
  journey_started: ["from", "to", "guards"],
  journey_claimed: ["ambushed", "lost"],
  stall_create: ["city", "good", "qty", "unit_price"],
  stall_buy: ["stall_id", "qty", "total", "fee"],
  stall_cancel: ["stall_id"],
  tick: ["tick"],
  ship: ["from", "to", "good", "qty", "total"],
  deposit: [],
  withdraw_requested: [],
  withdraw_marked: [],
  faucet: [],
};

export function toApiEvents(events: ContractEvent[]): Event[] {
  return events
    .filter((e) => KNOWN.has(e.event))
    .map((e) => {
      const type = e.event as EventType;
      const data: Record<string, unknown> = {};
      for (const k of [...PUBLIC_EVENT_FIELDS[type], "tx_hash"]) if (e.data[k] !== undefined) data[k] = e.data[k];
      return { id: e.id, type, at: nsToSec(e.at_ns), data };
    });
}
