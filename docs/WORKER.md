# Worker (NPC brain)

`apps/worker` runs the four merchants. Design and rules: `spec/NPC.md`. Evaluation: `docs/NPC_EVAL.md`.

## What exists and what is verified

| Part | State |
|---|---|
| Features, ship candidates (integer gap rule), baseline, decision validation and clamping, sanitising, prompts, personas | implemented, unit and property tested |
| NEAR AI client (`brain.ts`), model list (`models.ts`) | implemented against docs.near.ai, tested with a mocked HTTP layer; **never run against the live service** |
| Fallback ladder, main loop, graceful shutdown, failure isolation | implemented, integration tested against an in-memory world |
| Evidence capture (`attest.ts`) | implemented; **TEE quote verification is not implemented**, so `attested` is always false in production |
| Chain adapter (`chain-near.ts`) | implemented with near-api-js 7.4.0; **not run against a deployed contract**; view shape assumed (see below) |
| Postgres store (`db.ts`) | implemented, tested with a mock client; **not run against a database** |
| Haggling | not implemented (optional, first to cut) |
| Deployment | not done |

## Run it

```
pnpm --filter @caravan/worker typecheck
pnpm --filter @caravan/worker lint      # strict tsc incl. unused symbols (no eslint configured)
pnpm --filter @caravan/worker test
pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7    # fake model, no network
pnpm --filter @caravan/worker eval -- --write ../../docs/NPC_EVAL.md     # fake model, no network
pnpm --filter @caravan/worker start      # production: needs the environment below
```

The dry run and the evaluation use a scripted fake model and an in-memory world. They are labelled as such in their output and never import production wiring; `main.ts` and `bootstrap.ts` never import the fake (a test enforces that).

## Environment (names only; values live in the host dashboard or `.env.local`)

| Name | Secret | Meaning |
|---|---|---|
| `NEAR_NETWORK` | no | `testnet` (default) or `mainnet` |
| `NEAR_RPC_URL` | no | RPC endpoint (required; no default) |
| `CARAVAN_CONTRACT_ID` | no | contract account |
| `MERCHANT_ACCOUNT_DASHT`, `_MADAN`, `_BANDAR`, `_SHAHR` | no | the four merchant account ids |
| `KEY_DASHT`, `KEY_MADAN`, `KEY_BANDAR`, `KEY_SHAHR` | **yes** | function-call keys (ed25519 key strings), only these env vars, never logged |
| `DATABASE_URL` | **yes** | Postgres (same database as the server) |
| `NEAR_AI_API_KEY` | **yes** | NEAR AI Cloud key; the worker refuses to start without it |
| `NEAR_AI_MODEL` | no | model id, must appear in the service's model list |
| `NEAR_AI_BASE_URL` | no | optional override; must be https (the key is sent there) |
| `NEAR_AI_RESPONSE_FORMAT` | no | optional `json_object`; undocumented for this API, off by default |
| `WORKER_PERIOD_SECONDS`, `WORKER_STAGGER_SECONDS`, `WORKER_ID` | no | defaults 60, 15, `worker-1` |

`.env.example` (a root file, outside this component's ownership) does not yet list these names; add them when the owner of that file next edits it.

A missing or malformed variable stops the worker at startup with an error that names the variable and never prints a value. A present but rejected key (HTTP 401/402) does not stop the game: each round falls to the baseline after one call.

## Database

Reads the server's tables (`apps/web/src/server/db/migrations/0001_init.sql`, owned by the server): writes `npc_decisions(merchant, ts, input_hash, output_json, model, request_id, attested, source, tx_hashes)` and upserts `worker_heartbeat(worker, ts)`. `output_json` is the full `Decision`. The worker creates one table of its own, idempotently, at startup:

```
npc_evidence(id bigserial, merchant text, ts bigint, request_id text, evidence_json text)
```

## Evidence record and `/api/proof/{merchant}`

`/api/proof` lives in `apps/web`. A suggested response (the worker writes this JSON into `npc_evidence.evidence_json`):

```
{ merchant, at, model, request_id, chat_id,
  request_sha256, response_sha256,
  signature: { text, signature, signing_address, signing_algo, signature_kind } | null,
  checks: { signature: "not_attempted"|"unavailable"|"ok"|"failed",
            tee_quote: "not_verified"|"ok"|"failed" },
  attested: boolean, note }
```

Honest status: `attested` is true only when `checks.signature = "ok"` (ed25519, text equal to `<model>:<request_hash>:<response_hash>`, verified locally), `checks.tee_quote = "ok"` (needs a `QuoteVerifier`, not implemented) and `signature_kind = "provider_tee"`. Today `tee_quote` is always `not_verified`, so the UI must show "Private AI (TEE)" with "evidence recorded". Assumptions not confirmed against live data: hex encodings of the hashes, signature and public key (a mismatch makes the check fail, i.e. fails safe).

Docs used: docs.near.ai/cloud/verification/model, /cloud-api/response-signatures.md, /cloud-api/model-attestations.md. Real verification needs an Intel DCAP verifier (the docs name `dcap-qvl`), RTMR3 event-log replay, MRCONFIGID check and NVIDIA evidence verification; see the NEAR AI Cloud Verifier repository referenced there.

## Chain adapter assumptions (verify when the contract is deployed)

Written from spec 2.14 and the contract's `MerchantView`; `get_world` is assumed to return `{ tick, now_ns, merchants: [{ id, treasury (string), stock{grain..silk}, policy{spread_bp, bias_bp}, ... }] }` (four merchants). Calls: `set_policy({spread_bp, bias_bp})`, `ship({to, good, qty})`, `world_tick({})` (sent from the shahr key; a "too early" rejection counts as skipped). If the deployed contract differs, change `chain-near.ts` and `parseWorldView` (covered by a mapping test); nothing else depends on it.

## What needs a human to go live

1. `NEAR_AI_API_KEY` from cloud.near.ai with credits, and a model choice: run `pnpm --filter @caravan/worker try-brain -- --list`, pick one, set `NEAR_AI_MODEL`, then run `try-brain` once (spends a few tokens) and read its output. Confirm whether `response_format` works for the chosen model before enabling `NEAR_AI_RESPONSE_FORMAT`.
2. The four merchant accounts and function-call keys (restricted to `set_policy`, `ship`, and optionally `grant_discount`/`world_tick`), set only in the host's environment.
3. An always-on host with auto-restart (Railway, Fly.io, Render or a small VPS) and `DATABASE_URL` reachable from it; start command `pnpm --filter @caravan/worker start`. Keep it running until 2026-11-19.
4. After deploy: watch logs for 10 minutes, check `/api/npc/decisions`, set a wrong `NEAR_AI_API_KEY` and confirm rows switch to `source=baseline` and the game continues, then restore the key. Not done.
5. Real-model evaluation: `NEAR_AI_API_KEY=... NEAR_AI_MODEL=... pnpm --filter @caravan/worker eval -- --real --write ../../docs/NPC_EVAL.md` (200 calls, rate limited).
6. Optional: a `QuoteVerifier` implementation to make `attested` meaningful.

## Known limits

- The model-skip rule rarely triggers in the busy dry-run world (silk moves 333 bp per unit); it is meant for quiet periods.
- Flow history is in memory; after a restart `flow10_bp` is 0 for ten ticks.
- Each round re-reads the whole world once per merchant (one view call). At four merchants per minute this is small.
- The in-memory world (`sim-world.ts`) is not the Appendix B simulation; do not compare its numbers with spec 2.9.
