// Read endpoints: /api/state, /api/leaderboard, /api/npc/decisions, /api/proof/{merchant}.

import {
  CityIdSchema, NpcDecisionsQuerySchema, netWorthFils, DecisionSchema,
  type Decision, type DecisionsData, type LeaderboardData, type Proof, type StateData, type WorldState, type Event,
} from "@caravan/shared";
import { ApiError } from "../errors";
import type { UserRow } from "../db/repo";
import type { Services } from "../services";
import { lineText, toApiEvents, toApiPlayer, toApiWorld } from "./views";

interface WorldPart { world: WorldState; events: Event[] }

/** World, merchants (with off-chain mood/line/proof) and the last 20 events; cached for 1 second. */
export async function loadWorldPart(svc: Services): Promise<WorldPart> {
  return (await svc.worldCache.get(async () => {
    const [w, events, latest, proofRows] = await Promise.all([
      svc.contract.getWorld(),
      svc.contract.recentEvents(20),
      svc.repo.latestDecisionPerMerchant(),
      Promise.all(["dasht", "madan", "bandar", "shahr"].map((m) => svc.repo.latestProof(m))),
    ]);
    const proofs = new Map(proofRows.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => [r.merchant, r]));
    return { world: toApiWorld(w, latest, proofs), events: toApiEvents(events) } satisfies WorldPart;
  })) as WorldPart;
}

export async function getStateData(svc: Services, user: UserRow | null): Promise<StateData> {
  const part = await loadWorldPart(svc);
  let me = null;
  if (user?.near_account_id) {
    const p = await svc.contract.getPlayer(user.near_account_id);
    if (p) me = toApiPlayer(p, user.display_name, svc.now());
  }
  // `now` follows the request clock so clients see journeys arrive without waiting for the cache.
  return { world: { ...part.world, now: svc.now() }, me, events: part.events };
}

const LEADERBOARD_ROWS = 50;
const PAGE = 100;
/** Never scan more than this many players, whatever get_world says (a request-time bound, not the contract's max_players). */
const ABSOLUTE_PLAYER_CAP = 5000;

export async function getLeaderboard(svc: Services): Promise<LeaderboardData> {
  return (await svc.leaderboardCache.get(async () => {
    // Walk every page until a short one. player_count (plus two pages of slack for players who join mid-scan) bounds
    // the loop so a misbehaving view cannot spin it; ABSOLUTE_PLAYER_CAP bounds it when the count itself is absurd.
    let count = ABSOLUTE_PLAYER_CAP;
    try {
      count = await svc.contract.getPlayerCount();
    } catch {
      svc.log.warn("leaderboard: player_count unavailable; scanning to the absolute cap");
    }
    const limit = Math.min(ABSOLUTE_PLAYER_CAP, Math.max(0, count) + 2 * PAGE);
    const all = [];
    for (let from = 0; from < limit; from += PAGE) {
      const page = await svc.contract.getPlayers(from, PAGE);
      all.push(...page);
      if (page.length < PAGE) break;
    }
    const names = await svc.repo.namesByAccount(all.map((p) => p.account_id));
    const rows = all
      .filter((p) => names.has(p.account_id))
      .map((p) => ({ name: names.get(p.account_id)!, net_worth: netWorthFils(BigInt(p.fils), p.inventory) }))
      .sort((a, b) => (a.net_worth === b.net_worth ? 0 : a.net_worth < b.net_worth ? 1 : -1))
      .slice(0, LEADERBOARD_ROWS)
      .map((r) => ({ name: r.name, net_worth: r.net_worth.toString() }));
    return { rows } satisfies LeaderboardData;
  })) as LeaderboardData;
}

export async function getDecisions(svc: Services, req: Request): Promise<DecisionsData> {
  const merchant = new URL(req.url).searchParams.get("merchant") ?? undefined;
  const q = NpcDecisionsQuerySchema.safeParse({ merchant });
  if (!q.success) throw new ApiError("BAD_REQUEST", "merchant must be a city id");
  const rows = await svc.repo.listDecisions(q.data.merchant, 50);
  const out: Decision[] = [];
  for (const r of rows) {
    try {
      const stored = JSON.parse(r.output_json) as { line?: unknown };
      // Old rows stored the line as {en, fa}: keep the English text only.
      const line = lineText(stored.line as Parameters<typeof lineText>[0]) ?? undefined;
      const parsed = DecisionSchema.safeParse({ ...stored, line, tx_hashes: r.tx_hashes });
      if (parsed.success) out.push({ ...parsed.data, tx_hashes: r.tx_hashes });
    } catch {
      /* skip a malformed row */
    }
  }
  return { rows: out };
}

export async function getProof(svc: Services, merchantParam: string): Promise<Proof> {
  const m = CityIdSchema.safeParse(merchantParam);
  if (!m.success) throw new ApiError("BAD_REQUEST", "unknown merchant");
  const r = await svc.repo.latestProof(m.data);
  if (!r) return null;
  // OPEN_QUESTIONS #3: shape = Merchant["verified"]. `attested` is what the worker recorded, not re-verified here.
  return { model: r.model ?? "unknown", request_id: r.request_id ?? "", attested: r.attested, at: r.ts };
}
