# PROGRESS

Source of truth: `CARAVAN_ROAD_MASTER_PLAN.md` (Mahdi's Downloads folder; spec-v1 is section 2).
Times are UTC.

## Status

- Last verified: 2026-11-06 (`date -u`). Mahdi decided on 2026-10-30 to build before the 2026-11-01 gate (D1) and delegated all decisions; the only open items are owner-side (see "Blocked on Mahdi").
- Branch: `chore/scaffold` (local only, no remote). Tags: `spec-v1`, `spec-v1.1`, `spec-v1.2`, `pre-hackathon-baseline`.
- Offline build is complete and verified on the current tree (2026-11-07): typecheck 3/3, shared 35, web 344, worker 183, `setup-testnet` 41, Rust 68 tests, art tests, `cargo fmt --check`, wasm 389,493 bytes, `next build`, `scripts/secret-scan.sh` clean, `scripts/count-chars.mjs` ALL CHECKS PASSED with 9 `TODO(owner)` fields left. No agents running.
- Blocked on Mahdi (human checkpoints, plan section 0.4): root testnet account and keys (`scripts/setup-testnet.mjs`, never run for real), Postgres, Google/Discord OAuth apps, `.env.local` values, `NEAR_AI_API_KEY` + credits + model choice, 1Click JWT, mainnet treasury (USDC registered), contract deploy and `init` (docs/DEPLOY.md), hosting + cron + worker host, making the repo public, demo video, X post, submission (before 2026-11-14T23:59Z), keeping services up to at least 2026-11-25.
- Never run against real services: NEAR testnet/mainnet, NEAR AI Cloud, 1Click, OAuth, Postgres. The local loop (login, faucet, buy, journey, claim, sell, ranks, stalls) runs on the dev backend with a fake contract (`SERVER_BACKEND=dev`); that is not a chain test.
- Not built: `grant_discount`/haggling (cut list), sandbox end-to-end suite WRITTEN BUT NEVER RUN (`apps/web/src/server/__sandbox__/chain.sandbox.test.ts`, `pnpm --filter @caravan/web test:sandbox`, CI job `sandbox`; fresh-agent review found 3 real defects, fixed with offline tests: real contract JourneyView made claim show ARRIVED and drop ambushed/lost; direct calls (operator, world_tick) threw raw near-api-js errors instead of ContractPanic; worker swallowed every world_tick failure because the regex matched "tick"). Sandbox facts (checked 2026-11-06: `near-sandbox` supports only Linux x64/arm64 and macOS arm64; the Windows-x86_64 binary does not exist on the download host (HTTP 403) and WSL is not installed here, so it cannot run on this machine; run it on Linux/WSL/CI), `cargo-near` (plain `cargo build --target wasm32-unknown-unknown --release` is used).
- Toolchain: Rust 1.99.1 msvc, wasm32-unknown-unknown, VS Build Tools C++. Windows Application Control can block cargo build scripts outside D: (os error 4551).

- 2026-11-07: repo public at https://github.com/meitipro/caravan-road (branch `main`, tags pushed). Mock demo deployed on Vercel (project `caravan-road`, root `apps/web`, `vercel.json` forces `NEXT_PUBLIC_MOCK=1`): https://caravan-road.vercel.app, verified HTTP 200 on /, /play, ranks, journey, cash, city, stalls. Not a chain test; labelled DEMO. Fixes from three fresh-agent audits merged (events/returns parity with the real contract JSON, worker policy step and ship rules, server paging/nonce/deposit cap/withdraw rules/asset validation, UI QA); web 399, worker 219, shared 35 tests.

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
  - [x] TS economy sim (`pnpm sim --bots 5 --ticks 240 --seed 7`): reproduces the Python reference exactly (spec-v1.1, K=4000: 64/5944/23, 177/1088/43, 342/1099/86; changed by the spec-v1.2 proposal below) and asserts money conservation every tick; 34 tests pass
  - [x] Independent spec review (fresh Opus sub-agent), fixes applied (`6cb0cc6`)
  - [x] `git tag spec-v1` (2026-10-30; Mahdi delegated OPEN_QUESTIONS, provisional behaviours adopted; #6, #11, #12 to be finalised in Phase 2)
- [ ] Phase 2 — contract implemented (`3547183`, `25b8509`, `7ce65be`; near-sdk 5.30.0): full spec 2.14 interface except `grant_discount`; 59 Rust tests pass and wasm builds (390,903 bytes), both re-verified 2026-10-31. Decisions in `contracts/caravan/DECISIONS.md` (ambush floor(30%), tick order per 2.8 text, integer gap test) change the 2.9 sim numbers (2 bots 61/6714/26, 5 bots 132/933/44, 10 bots 344/958/74) -> spec-v1.1 decision pending. Independent audit done: 12 findings fixed (`da30d32`, `b5f7985`), 68 Rust tests pass, wasm 389,493 bytes built with `--cfg near` (re-verified 2026-10-31); `get_withdrawals` added; spec-v1.1 adopted (spec/CHANGELOG.md). Not done: `grant_discount`, near-workspaces sandbox test, deploy scripts, testnet deploy (needs Mahdi's accounts; `init` now needs `player_suffix` and `operator_daily_cap`); no cargo-near.
- [ ] Phase 3 — server done offline (`497e91d`, `3a82c39` + lint fix): all spec 2.13 endpoints, Auth.js, relayer, custody, PGlite tests; 148 web tests, typecheck, lint, build pass (re-verified 2026-10-31). Independent security review done: 17 findings fixed or documented (`12cb94c`; relayer full-access key documented as known limitation); 180 web tests pass (re-verified 2026-10-31). Going live needs Postgres, OAuth apps, keys, deployed contract (Mahdi); testnet smoke script not run.
- [x] Phase 4 — UI done (`dae8c64`; digits legible `d5fd7df`; local live connect `3f0a4a9`; real testnet connect pending): tasks 1-8 except live connect (needs Phase 3) and optional stalls screen. Re-verified by Claude 2026-10-30: typecheck all packages, 56 web tests, 35 shared tests, tree clean, no secrets. 25 screens at 390/1280 px in `docs/screens/`. Issues: `apps/web/src/ui/SHARED_ISSUES.md`. UI fonts (Pixelify Sans, Inter, Vazirmatn, OFL 1.1) still to be added to `docs/CREDITS.md`.
- [ ] Phase 5 — NPC brain built offline (`f753098`, `c008cb6`): baseline + validated LLM proposals, fallback ladder, NEAR AI client from docs (never run live), attestation recorded honestly (`attested` always false in production), dry-run and FAKE-model eval in `docs/NPC_EVAL.md`; 177 worker tests pass (re-verified 2026-10-31). Needs `NEAR_AI_API_KEY`, model choice, host, real eval; haggling skipped.
- [x] Phase 6 — art pipeline done (`78f0972`, `930a3e6`): 18 slots with exact sizes, 25 tests pass (re-run by Claude 2026-10-30). CREDITS.md notes UI fonts are not yet recorded.
- [ ] Phase 7 — 1Click client built offline (`c3fb765`): asset list, deposit/withdraw, status mapping, fail-closed, 254 web tests pass (re-verified 2026-11-01), doc-derived fixtures only, never called the real API. Since then: SENT-withdrawal follow-up cron added (`/api/cron/withdrawals`), 340 web tests. Still open: no-JWT fee (docs say +0.25%, hackathon Q-006 says 0.2%; only a dry quote settles it, `docs/INTENTS.md`), auth header X-API-Key vs Bearer unconfirmed, USDC asset id and treasury registration need the live test. All mainnet actions are Mahdi's.
- [ ] Phase 8 — economy analysis done (`4b4567c`, docs/ECONOMY_TUNING.md, 2,431 Python runs + 25 TS configs, money conserved): cargo sales cut short by merchant treasuries 20-35% of the time; with contract semantics (unsold goods kept) 5-10 greedy players drain the four merchants from 200,000 to 3,500-10,600 fils in 4 h, so spec 2.9 needs a re-baseline; bigger treasuries do not fix it and raise operator loss; spice/silk sit at a price clamp 66-89% of the time (house caravans cannot pay for them); MULT_K_BP 3000 cuts clamp time 86% -> 22%; 'first profit under a minute' is impossible (shortest journey 180 s; first realised profit median 6-11 min after joining); no money-making exploit loop found. MULT_K_BP 4000 -> 3000 adopted as spec-v1.2 (D5). Still open proposals: re-baseline 2.9 with contract rules; make spice/silk shippable (house pays / partial units); guard re-pricing. Integration on a chain, review of docs still open.
  - **spec-v1.2 prepared on branch `proposal/spec-v1.2-mult-k-3000` (2026-11-02); merged and tagged `spec-v1.2` on 2026-11-03 (D5):** only `MULT_K_BP` 4000 -> 3000 applied end to end (spec, shared, contract constant and tests, web/worker tests, docs). New golden vectors in `spec/ECONOMY.md` 2.7; `pnpm sim` seed 7 / 240 ticks now 53/5,795/10, 190/1,392/47, 329/689/72 (Appendix B figures changed; `scripts/ref` untouched and still K=4000). pnpm shared/web/worker suites pass on the branch. The Rust suite could not be run when the branch was prepared (Windows Application Control blocked the `crunchy` build script in the worktree target dir, os error 4551); it was run on the merged tree (68 tests, clippy, wasm) and passes. The Rust expectations (7 golden vectors, 24 trade vectors, ship payments) were computed with a K=3000 copy of the Python reference and cross-checked with `tradeCost()`.
- [ ] Phase 9 — README/docs DRAFT done (`dc649e3`): README, ARCHITECTURE, ECONOMY, DEPLOY, CREDITS (fonts OFL 1.1), helper scripts (`check-env`, `secret-scan`, `init-args`, `call-cron`); honest timeline (first commit 2026-10-22 UTC, 31 commits before the window). LICENSE (MIT) added. TODO(owner): repo URL, baseline diff link, live URL, video/X post, team statement (9 `TODO(owner)` fields, `node scripts/count-chars.mjs`). Judge rehearsal by a fresh agent not yet run; wait until the live PLAY demo exists. Secret-scan history hit `ed25519:3tys...` in a redaction test sample (public-key-shaped example, not in HEAD): checked by Claude 2026-11-01, not a secret.
- [ ] Phase 10 — demo, X post, submission

## Decisions

- **D5 — spec-v1.2 (2026-11-03):** `MULT_K_BP` 4000 -> 3000 merged from `proposal/spec-v1.2-mult-k-3000` (Mahdi repeatedly said to continue; delegated decisions; reversible with `git revert -m 1`). Verified on the merged tree: 35 shared + 298 web + 180 worker + 68 Rust tests, typecheck, clippy, wasm 389,493 bytes; `scripts/ref/world.py` set to K=3000 and matches `pnpm sim` exactly (53/5795, 190/1392, 329/689 trips/median). New golden vectors in spec/ECONOMY.md 2.7. Docs refreshed for K=3000 on 2026-11-06 (ECONOMY_TUNING, README, DEMO_SCRIPT, SUBMISSION, X_POST, DECISIONS, screenshots, PROOF.md, deployments.md). Stale "spec-v1.2 PROPOSAL" wording in spec, code comments and NPC_EVAL replaced by "adopted" on 2026-11-06 (comments and docs only; 35 shared + 180 worker + 68 Rust tests re-run, typecheck, fmt clean). Other economy proposals (shippable spice/silk, re-baseline with treasury behaviour) still open.

- **D4 — official rules read 2026-11-01 (docs/SUBMISSION.md):** pre-window work counts as BASELINE; only NEAR-integration work built after 2026-11-01 is judged. Local tag `pre-hackathon-baseline` created at `260e0a6` (last commit before the window, 2026-10-31T22:09+03:30). Before submission: README must link the diff `pre-hackathon-baseline...HEAD` once the repo is public (TODO owner), add a LICENSE file, X post tags per the official file (@NEARProtocol, #NEARHackathon) with a video, docs/INTENTS.md fee should read 0.2% (not 0.25%).

- **D1 — building before the date gate.** The master plan (section 0.3 rule 1) and the hackathon rule say code starts 2026-11-01T00:00:00Z. Commits were made on 2026-10-23 (scaffold, spec, shared package, mock) and continue on 2026-10-30. On 2026-10-30 Mahdi said to ignore the gate and finish early. History is not rewritten. README, X post and submission text must state the real dates and must not claim the whole project was built inside the window. Risk accepted by Mahdi: the organisers may treat pre-window work as a rule violation.
- **D2 — `spec/` regenerated from the master plan** (verbatim extracts); the older part-1 PDF is superseded.
- **D3 — TS sim follows Appendix B exactly** (including its ambush rounding); see OPEN_QUESTIONS #6 for the conflict with section 2.4 text.

## Open questions

See `spec/OPEN_QUESTIONS.md` (13 open items: `Event` type, `net_worth`, `/api/proof` shape, faucet cooldown, shahr text vs table, ambush rounding, `limit_total`, stall fee, tie-breaks, document placement).

## Completed items

- 2026-10-30 — read master plan sections 0–3, PROGRESS.md, Phase 1 steps 1–5 (see commits `c79bff4`, `e3ffe7f`).
