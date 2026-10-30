# PROGRESS

Source of truth: `CARAVAN_ROAD_MASTER_PLAN.md` (Mahdi's Downloads folder; spec-v1 is section 2).
Times are UTC.

## Status

- Last checked: 2026-10-30T15:46Z (`date -u`). Build window opens 2026-11-01T00:00:00Z. **Date gate: CLOSED.** No project code or art until it opens.
- Current branch: `chore/scaffold` (local only, no remote). HEAD: `39b4a25`.
- Next action: Mahdi decides what to do with code committed before the gate (see Decisions, D1); then walk the Phase 0 checklist.

## Phases

- [ ] Phase 0 — pre-flight (allowed now; documents only)
  - [x] `date -u` reported: 2026-10-30, window closed (2026-10-30T15:46Z)
  - [x] PROGRESS.md created (2026-10-30)
  - [ ] Decision D1 on pre-gate code
  - [ ] 1Click API JWT requested (Mahdi)
  - [ ] Mainnet NEAR account for prize payout (Mahdi creates; never invented by Claude)
  - [ ] X account ready for the demo post (Mahdi)
  - [ ] International payment route for NEAR AI credits and hosting (Mahdi)
  - [ ] Toolchain: Node LTS, pnpm, Rust + wasm target, `cargo-near`, Git, Postgres, Vercel project, Google and Discord OAuth apps
  - [ ] Unique project name reserved (candidates: "Caravan Road", "Caravan Road: Silk Ledger", "Dinar Road")
  - [ ] `spec/*.md` from section 2 (documents only; see D2)
- [ ] Phase 1 — scaffold and shared package (Day 1–2)
- [ ] Phase 2 — smart contract (Day 2–7; mainnet Day 10)
- [ ] Phase 3 — server, accounts, game endpoints (Day 3–9)
- [ ] Phase 4 — user interface (Day 3–10)
- [ ] Phase 5 — NPC brain (Day 5–9)
- [ ] Phase 6 — art pipeline (start Day 1)
- [ ] Phase 7 — real money with NEAR Intents (Day 8–9; mainnet Day 10)
- [ ] Phase 8 — integration, tuning, review (Day 7 gate; Day 11)
- [ ] Phase 9 — README, docs, judge rehearsal (Day 12)
- [ ] Phase 10 — demo, X post, submission (Day 13–14)

## Decisions

- **D1 (OPEN) — code written before the date gate.** On 2026-10-23 (Tehran time), at Mahdi's request and under an earlier part-1 PDF that allowed it, four commits were made in `D:\caravan-road`: scaffold, spec Markdown, `packages/shared` (types, world constants, `quote()`, `tradeCost()`, zod schemas, 29 tests) and fixtures with a mock api-client. The master plan (section 0.3, rule 1) and the hackathon rule "Build the project during the hackathon" say code starts 2026-11-01T00:00:00Z. Options, awaiting Mahdi: (a) keep and disclose it in the README; (b) archive this folder outside the submission repo, do not reuse its code, and rebuild from a fresh repo after the gate (Claude's recommendation); (c) other. Nothing has been deleted or rewritten.

## Open questions (details in `spec/OPEN_QUESTIONS.md`)

- D2: `spec/` and `packages/shared` were written from the older part-1 PDF. The master plan's spec-v1 differs in places (simulation table: 64/177/342 trips, medians 5,944/1,088/1,099, broke events 23/43/86; new parameters such as `SPREAD_MIN/MAX`, `BIAS_MIN/MAX`, `MERCHANT_TREASURY_FILS`, `MAX_DEPOSIT_FILS`, `DAILY_WITHDRAW_CAP_FILS`; `Decision` is defined in section 2.12). The master plan wins; the existing files must be regenerated from it, not patched.
- Still undefined in the master plan: the `Event` type (used by `/api/state`), the `net_worth` formula, the `/api/proof` response shape, the PLAY faucet cooldown length, and exact tie-breaking in the world tick.
- Text vs table: section 2.3 says each city produces two goods and consumes two or three, but `shahr` produces one good (iron 1) and consumes four.

## Completed items

- 2026-10-30T15:46Z — read master plan sections 0–3 and Phase 0.
