# PROGRESS

Source of truth: `CARAVAN_ROAD_MASTER_PLAN.md` (Mahdi's Downloads folder; spec-v1 is section 2).
Times are UTC.

## Status

- Last checked: 2026-10-30 (`date -u`). Build window opens 2026-11-01T00:00:00Z. Mahdi decided on 2026-10-30 to build before the gate (see D1).
- Branch: `chore/scaffold` (local only, no remote).
- Phase 1 done except the `spec-v1` tag. Independent review finished (12 findings: 8 fixed in `6cb0cc6`, 3 recorded as OPEN_QUESTIONS #11-13, 1 tag wording). Tag waits for Mahdi's answers on `spec/OPEN_QUESTIONS.md`.
- Running in parallel (sub-agents, own folders only): Phase 6 art (`tools/art`, `apps/web/public/assets`, `docs/CREDITS.md`), Phase 4 UI against the mock (`apps/web/src/app/play`, `components`, `ui`).
- Blocked on Mahdi (human checkpoints, section 0.4): Rust + wasm target + `cargo-near` and testnet accounts (Phase 2); `.env.local` values, Postgres, OAuth apps (Phase 3); `NEAR_AI_API_KEY` and credits (Phase 5); 1Click JWT (Phase 7).
- Next action: collect the spec review, fix, tag `spec-v1`; then merge sub-agent results after checking their tests.

## Phases

- [ ] Phase 0 — pre-flight
  - [x] `date -u` reported (2026-10-30)
  - [x] PROGRESS.md created
  - [x] D1 decided
  - [ ] 1Click API JWT requested (Mahdi)
  - [ ] Mainnet NEAR account for prize payout (Mahdi creates)
  - [ ] X account ready (Mahdi)
  - [ ] International payment route for NEAR AI credits and hosting (Mahdi)
  - [ ] Toolchain: Rust + wasm target, `cargo-near`, Postgres, Vercel project, Google and Discord OAuth apps (Node 24, pnpm 10, git, Python 3.12 are present)
  - [ ] Unique project name reserved (candidates: "Caravan Road", "Caravan Road: Silk Ledger", "Dinar Road")
  - [x] `spec/*.md` written from section 2 (verbatim extracts)
- [ ] Phase 1 — scaffold and shared package
  - [x] Scaffold (commit `3c8d4be`)
  - [x] Spec files regenerated from the master plan (`e3ffe7f`)
  - [x] Shared package: types, world/PARAMS (plan names), `quote()`, `tradeCost()`, zod schemas, golden vector tests
  - [x] Fixtures + mock api-client (4 merchants, 3 players, 8 events, leaderboard; tick every 5 s)
  - [x] TS economy sim (`pnpm sim --bots 5 --ticks 240 --seed 7`): reproduces the Python reference exactly (64/5944/23, 177/1088/43, 342/1099/86) and asserts money conservation every tick; 34 tests pass
  - [x] Independent spec review (fresh Opus sub-agent), fixes applied (`6cb0cc6`)
  - [ ] `git tag spec-v1` (after Mahdi resolves OPEN_QUESTIONS)
- [ ] Phase 2 — smart contract (needs Rust toolchain from Mahdi)
- [ ] Phase 3 — server, accounts, game endpoints (needs Postgres, OAuth, env values)
- [ ] Phase 4 — user interface (sub-agent running, mock only)
- [ ] Phase 5 — NPC brain (needs `NEAR_AI_API_KEY`)
- [ ] Phase 6 — art pipeline (sub-agent running)
- [ ] Phase 7 — real money with NEAR Intents (needs JWT, mainnet actions are Mahdi's)
- [ ] Phase 8 — integration, tuning, review
- [ ] Phase 9 — README, docs, judge rehearsal
- [ ] Phase 10 — demo, X post, submission

## Decisions

- **D1 — building before the date gate.** The master plan (section 0.3 rule 1) and the hackathon rule say code starts 2026-11-01T00:00:00Z. Commits were made on 2026-10-23 (scaffold, spec, shared package, mock) and continue on 2026-10-30. On 2026-10-30 Mahdi said to ignore the gate and finish early. History is not rewritten. README, X post and submission text must state the real dates and must not claim the whole project was built inside the window. Risk accepted by Mahdi: the organisers may treat pre-window work as a rule violation.
- **D2 — `spec/` regenerated from the master plan** (verbatim extracts); the older part-1 PDF is superseded.
- **D3 — TS sim follows Appendix B exactly** (including its ambush rounding); see OPEN_QUESTIONS #6 for the conflict with section 2.4 text.

## Open questions

See `spec/OPEN_QUESTIONS.md` (13 open items: `Event` type, `net_worth`, `/api/proof` shape, faucet cooldown, shahr text vs table, ambush rounding, `limit_total`, stall fee, tie-breaks, document placement).

## Completed items

- 2026-10-30 — read master plan sections 0–3, PROGRESS.md, Phase 1 steps 1–5 (see commits `c79bff4`, `e3ffe7f`).
