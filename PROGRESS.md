# PROGRESS

Source of truth: `CARAVAN_ROAD_MASTER_PLAN.md` (Mahdi's Downloads folder; spec-v1 is section 2).
Times are UTC.

## Status

- Last checked: 2026-10-30 (`date -u`). Build window opens 2026-11-01T00:00:00Z. Mahdi decided on 2026-10-30 to build before the gate (see D1).
- Branch: `chore/scaffold` (local only, no remote).
- Phase 1 done except the `spec-v1` tag. Independent review finished (12 findings: 8 fixed in `6cb0cc6`, 3 recorded as OPEN_QUESTIONS #11-13, 1 tag wording). Tag waits for Mahdi's answers on `spec/OPEN_QUESTIONS.md`.
- Done by sub-agents and re-verified: Phase 6 art, Phase 4 UI on the mock. No agents running.
- Blocked on Mahdi (human checkpoints, section 0.4): Rust + wasm target + `cargo-near` and testnet accounts (Phase 2); `.env.local` values, Postgres, OAuth apps (Phase 3); `NEAR_AI_API_KEY` and credits (Phase 5); 1Click JWT (Phase 7).
- Toolchain (2026-10-31): Rust 1.99.1 msvc, wasm32-unknown-unknown, VS Build Tools C++ installed. `cargo-near` NOT installed: its build needs NASM (aws-lc-sys); plain `cargo build --target wasm32-unknown-unknown --release` is used instead. Note: Windows Application Control blocked a build artifact under %TEMP% once; builds on D: work.
- Running (sub-agents, own folders): Phase 2 contract (`contracts/caravan`, Opus), Phase 3 server (`apps/web/src/app/api`, `src/server`). Next action: verify and commit their results; testnet accounts are Mahdi's.

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
  - [x] `git tag spec-v1` (2026-10-30; Mahdi delegated OPEN_QUESTIONS, provisional behaviours adopted; #6, #11, #12 to be finalised in Phase 2)
- [ ] Phase 2 — smart contract (sub-agent running; testnet deploy needs Mahdi's accounts)
- [ ] Phase 3 — server done offline (`497e91d`, `3a82c39` + lint fix): all spec 2.13 endpoints, Auth.js, relayer, custody, PGlite tests; 148 web tests, typecheck, lint, build pass (re-verified 2026-10-31). Independent security review running. Going live needs Postgres, OAuth apps, keys, deployed contract (Mahdi); testnet smoke script not run.
- [x] Phase 4 — UI on the mock done (`dae8c64`): tasks 1-8 except live connect (needs Phase 3) and optional stalls screen. Re-verified by Claude 2026-10-30: typecheck all packages, 56 web tests, 35 shared tests, tree clean, no secrets. 25 screens at 390/1280 px in `docs/screens/`. Issues: `apps/web/src/ui/SHARED_ISSUES.md`. UI fonts (Pixelify Sans, Inter, Vazirmatn, OFL 1.1) still to be added to `docs/CREDITS.md`.
- [ ] Phase 5 — NPC brain built offline (`f753098`, `c008cb6`): baseline + validated LLM proposals, fallback ladder, NEAR AI client from docs (never run live), attestation recorded honestly (`attested` always false in production), dry-run and FAKE-model eval in `docs/NPC_EVAL.md`; 177 worker tests pass (re-verified 2026-10-31). Needs `NEAR_AI_API_KEY`, model choice, host, real eval; haggling skipped.
- [x] Phase 6 — art pipeline done (`78f0972`, `930a3e6`): 18 slots with exact sizes, 25 tests pass (re-run by Claude 2026-10-30). CREDITS.md notes UI fonts are not yet recorded.
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
