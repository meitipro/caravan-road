# NPC

> Source: CARAVAN_ROAD_MASTER_PLAN.md section 8 (Phase 5), spec-v1, plus the implementation decisions of `apps/worker` listed at the end. Locked facts from other files: ECONOMY.md section 2.8 (world tick, house caravans) and API.md (`Decision`, `/api/npc/decisions`, `/api/proof/{merchant}`).

## 1. Purpose

Four characters (one merchant per city) own real accounts and treasuries. Every minute each one sets its buying/selling policy and may ship goods to another city. Every decision is recorded with its reason and shown to the player.

## 2. AI authority limits

| The AI can | The AI cannot |
|---|---|
| `set_policy(spread_bp, bias_bp)` within contract ranges | send arbitrary transactions |
| `ship(...)` only from options the code computed | move treasury or withdraw |
| (optional, not implemented) `grant_discount` <= 5% for <= 120 s | push prices outside [400, 2000] spread and [-1500, 1500] bias |

Layers: (1) the model only proposes JSON; (2) code validates with zod and **clamps**; (3) the merchant key can call only three methods; (4) the contract re-checks every range. Worst case after a compromised model: a bad price inside the allowed range.

## 3. Cycle

```
every 60 s, per merchant (staggered 15 s):
  read state (view calls)             -> features   (bounded integers only)
  ship_options = rule-based list      -> candidates (same gap rule as the contract)
  skip the model call if inputs barely changed
  else call NEAR AI Cloud             -> brain      (8 s timeout, 1 retry)
    parse + zod + clamp               -> decision
    fallback ladder if anything fails
  apply on chain with merchant key    -> chain      (set_policy only if changed, ship)
  insert row in npc_decisions + heartbeat
after all merchants: world_tick() once
```

The model input is only bounded integers computed by the worker (no free text, so no prompt injection through gameplay). Optional haggling (not implemented) is the only path that would carry player text.

Features per merchant: for each good `stock_ratio_bp` (stock x 10000 / target, cap 30000) and `flow10_bp` (stock change over the last 10 ticks in bp of target, clamped +-20000, 0 without history); `treasury_bp` (treasury x 10000 / initial, cap 100000); `avg_ratio_bp`; current policy; for each other city: `route_risk_bp`, `route_seconds`, `treasury_bp`, stock ratios.

Ship options (at most 4, each with an index): for each other city `to` and good, with `a` = own stock, `b` = destination stock:

- gap test, integer: `(a - b) * 10000 >= 5000 * target` (OPEN_QUESTIONS #12, integer form);
- `qty = min(4, a, 2 x target - b)`, reduced while the destination treasury cannot pay `qty x midpoint price`, dropped if it reaches 0;
- midpoint price per unit = `(mid(a, bias_from) + mid(b, bias_to)) / 2` truncated; the destination must be able to afford the larger of this and the same figure computed without bias;
- sorted by gap descending, then city and good order.

## 4. NEAR AI Cloud

| Item | Value |
|---|---|
| Base (OpenAI-compatible) | `https://cloud-api.near.ai/v1` |
| Chat | `POST /v1/chat/completions`, `Authorization: Bearer <NEAR_AI_API_KEY>` |
| Model list | `GET /v1/model/list` (fallback `GET /v1/models`); read at startup, never hard-coded; `NEAR_AI_MODEL` must be set and present in the list |
| Request id | response header `X-Request-Id` |
| Parameters | `temperature` 0.4, `max_tokens` 300, 8 s timeout, one retry |
| JSON mode | `response_format` is not documented for chat completions; the worker asks for JSON in the prompt and validates strictly. `NEAR_AI_RESPONSE_FORMAT=json_object` is an opt-in that has not been confirmed against the live service |

Sources: docs.near.ai/cloud/quickstart, /api-reference/chat/create-chat-completion.md, /api-reference/models/list-models-with-pricing.md, /api-reference/chat/list-available-models.md (read 2026-10-31).

## 5. Decision

`Decision` and `Mood` are in `packages/shared` (API.md section 2.12). Raw model output:

```json
{
  "spread_bp": 900, "bias_bp": -300, "mood": "worried", "ship_choice": null,
  "line": { "en": "Salt is thin; I buy cheap and sell dear.", "fa": "نمک کم است؛ ارزان می‌خرم و گران می‌فروشم." },
  "reason": "Salt stock 62% of target, treasury 71% of initial; widen spread, lean toward buying less."
}
```

`ship_choice` is the **index** of an option the code supplied, or `null`. Validation:

| Input | Result |
|---|---|
| not a JSON object | reject |
| `spread_bp` / `bias_bp` missing, string, float, null, object | reject |
| `spread_bp` / `bias_bp` integer out of range | clamp to [400, 2000] / [-1500, 1500] |
| `mood` missing or not one of the four | derived from the baseline |
| `ship_choice` not an integer index of a supplied option | `null` |
| `line.en` / `line.fa` wrong type | reject |
| `line.*` empty after sanitising, or `fa` without a Persian-script letter | persona fallback line |
| `line.*`, `reason` | control and bidi characters, markup characters, emoji, links stripped; whitespace collapsed; cut to 120 / 240 characters; ZWNJ kept |
| extra keys | ignored |

Invalid output: one retry with a "JSON only" nudge, then the fallback ladder. The recorded `Decision` is finally checked with the shared `DecisionSchema`.

## 6. Fallback ladder

| Level | Condition | Action | `source` |
|---|---|---|---|
| 1 | model answered and valid | apply | `llm` |
| 2 | timeout/error/invalid after one retry, or HTTP 4xx other than 408/429 (no retry) | **baseline policy** (deterministic) | `baseline` |
| 3 | chain rejects `set_policy`, or inputs barely changed (model skipped) | keep previous policy | `keep` |
| 4 | worker down | contract keeps last policy; `/api/cron/tick` calls `world_tick` | none |

Baseline policy (integer, truncating toward zero):

```
avg_ratio_bp = mean over goods of stock*10000/target
treasury_bp  = treasury*10000/initial_treasury
spread_bp    = clamp(800 + max(0, 10000-treasury_bp)/10, 400, 2000)   # poorer -> wider
bias_bp      = clamp((10000-avg_ratio_bp)/4, -1500, 1500)             # scarce -> pay more
ship         = candidate with the largest ratio gap, else null
```

Mood (baseline and fallback): `worried` if `treasury_bp < 6000`; else `greedy` if `avg_ratio_bp < 7500`; else `generous` if `avg_ratio_bp > 12500`; else `calm`.

## 7. Personas

| City | Character | Tendency |
|---|---|---|
| dasht | Golnar, farmer | generous, hates hoarding; cheaper grain when stock is high |
| madan | Ostad Rostam, blacksmith | gruff and exact; keeps iron dear, rarely gives way |
| bandar | Captain Nahid, sea trader | bold; gambles on silk and spice, changes prices fast |
| shahr | Hakim Sohrab, city broker | calculating; wide spreads, ships goods often |

System prompt (wording kept from the plan; persona text injected): "You are the merchant of {city} in Caravan Road, a small trading game. Every minute you set your buying/selling spread and bias and may ship goods to another city. You never talk about being an AI. You output ONE JSON object and nothing else, matching exactly: {spread_bp:int 400..2000, bias_bp:int -1500..1500, mood:'calm'|'greedy'|'worried'|'generous', ship_choice:int|null, line:{en:string<=120, fa:string<=120}, reason:string<=240}. spread_bp is the gap between your buy and sell prices in basis points; higher means you earn more per trade but players trade less. bias_bp > 0 raises both prices (goods are scarce for you), bias_bp < 0 lowers them. ship_choice is the index of one of the given ship_options, or null. Keep your treasury healthy: if treasury_bp < 6000 widen the spread. Never exceed the ranges. line.fa must be natural Persian; line.en natural English; both in your persona's voice, no emojis, no links."

Two few-shot examples per persona are replayed as prior user/assistant turns; the final user turn is the JSON `{features, ship_options}`. No player-provided text ever enters the prompt; a runtime guard (`assertNoFreeText`) refuses any leaf that is not an integer or a city/good id.

## 8. Evidence and attestation

Every `llm` decision keeps: `request_id` (`X-Request-Id`), the model id reported by the service, SHA-256 of the exact request and response bytes, and (best effort) the response signature from `GET /v1/signature/<chat id>`. `attested` is true **only if** the response signature verified locally and a TEE quote verifier (Intel TDX, NVIDIA GPU evidence, RTMR3 replay per docs.near.ai/cloud/verification) also passed and the signature is `provider_tee`. The quote verifier is **not implemented**; `attested` is therefore false in every decision the shipped worker writes. The UI must show "Private AI (TEE)" with "evidence recorded", never a verified mark. See docs/WORKER.md.

## 9. Haggling

Optional, not implemented. If added: the player's sentence only inside a `player_message` JSON field of the user turn, <= 200 characters, control characters stripped (`fenceUntrusted` in the worker), never in the system prompt, no tools; output schema-validated and clamped; `discount_bp <= 500` for 120 s enforced by the contract; at least 20 injection tests.

## 10. Implementation decisions beyond the plan

1. **Model skip rule.** The model is skipped (`source: keep`) when every stock ratio moved < 300 bp and treasury < 500 bp since the last LLM decision and that decision is < 10 minutes old. In a skipped round the policy, mood and line stay as they were, and the deterministic ship rule (best candidate) still runs, so shipping does not stall for ten minutes.
2. **Chain failure.** If `set_policy` fails the round is recorded as `keep` with the previous policy and no `model` / `request_id`, and no ship is attempted. If only `ship` fails, the decision keeps its source and the ship is recorded as null with the failure in `reason`.
3. **Retry policy.** One retry on network error, timeout, 408, 429, 5xx and invalid output. No retry on other 4xx (bad key, no credits), so a broken key falls to the baseline in one call.
4. **Persistence.** `npc_decisions.output_json` holds the full `Decision`; the inference evidence goes to the worker's own table `npc_evidence` (no column for it in the server schema).
5. **Off-chain fields** (OPEN_QUESTIONS #13): `mood`, `last_line` and `verified` come from the latest `npc_decisions` row, not from the contract.
6. **Integer gap test** (OPEN_QUESTIONS #12): the worker uses the integer form. If the contract decides otherwise, `candidates.ts` must follow; a ship the contract rejects is recorded, never forced.
