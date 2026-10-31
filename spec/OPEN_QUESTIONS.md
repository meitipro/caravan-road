# OPEN QUESTIONS

**Update 2026-10-31:** items #4, #6, #8, #11 and #12 are resolved by `spec-v1.1` (see `spec/CHANGELOG.md`). The rest stay as provisional behaviours.

**Status 2026-10-30:** Mahdi delegated these decisions ("do whichever you like, just go"). Every open item below is resolved by adopting its provisional behaviour; `spec-v1` is tagged on that basis. Items #6, #11 and #12 must be finalised in the contract (Phase 2); if the contract changes them, create `spec-v1.1`.

Contradictions and gaps in `CARAVAN_ROAD_MASTER_PLAN.md` (spec-v1). Nothing here is resolved silently: each item names the provisional behaviour the code uses until Mahdi decides.

Resolved by the master plan (were open against the old part-1 PDF): initial merchant treasury (50,000 fils), spread and bias ranges, guard risk formula, `Decision` shape, parameter names, simulation reference (Appendix B, reproduced exactly by `scripts/ref/economy_sim.py`).

## Open

1. **`Event` is undefined.** `/api/state` returns `Event[]` and section 2.14 lists NEP-297 event names, but no fields. Provisional: `{ id, type, at, data }` in `packages/shared/src/provisional.ts` (A1).
2. **`net_worth` has no formula** (`Player.net_worth`, leaderboard). Provisional (A2): `fils` + sum(qty x base price) of inventory; cargo in transit and stall goods are not counted.
3. **`/api/proof/{merchant}` response shape is undefined** ("latest inference-evidence record"). Provisional (A18): `Merchant["verified"]` in the mock; to be defined in Phase 5.
4. **PLAY faucet cooldown length is not given** (section 2.14: "with cooldown"; section 2.9 suggests a top-up for players under 50 dinars). Provisional (A7): 60 s in the mock.
5. **Text vs table, section 2.3.** The text says each city produces two goods and consumes two or three, but `shahr` produces one good (iron 1) and consumes four. The table matches Appendix A and keeps production equal to consumption per good, so the table is used as written.
6. **Ambush loss rounding.** Section 2.4: "30% of each cargo good is destroyed (floor)" means lost = floor(0.3 x qty). Appendix B keeps `q * 7000 // 10000`, so lost = ceil(0.3 x qty) (qty 11: sim loses 4, text loses 3). Provisional: the TypeScript sim reproduces Appendix B exactly (needed to match its published numbers); the mock follows the section 2.4 text. The contract must follow one of them.
7. **`limit_total` semantics.** Not stated whether it bounds the gross total or the amount after the 1% fee. Provisional (A12): buy: `total + fee <= limit_total`; sell: `total - fee >= limit_total`. `tradeCost()` returns the gross `total` and `fee` separately.
8. **Stall fee payer and rounding.** "2% fee to `house`": payer and rounding unstated. Provisional: buyer pays 2% on top, truncated.
9. **Tie-breaks in the world tick** ("poorest merchant", richest/poorest stocked city). Provisional: first in the order dasht, madan, bandar, shahr, as in Appendix B.
10. **Document placement.** Section 4 step 2 maps sections 1, 2.1-2.10 and 2.12-2.14 to spec files; 2.11 (layout) is placed at the end of `GAME.md` and 2.15 (colors) in `UI.md`.

11. **World tick order.** Section 2.8 lists: production, rebalancing, recycling, house caravans. Appendix B (and the TypeScript sim) runs production, house caravans, rebalancing, recycling. Provisional: follow Appendix B. The contract must pick one.
12. **House-caravan gap test is a float in the reference** (`(stock_hi/target - stock_lo/target) x 10000 >= 5000`). It cannot be written in integer math without changing results: at exact 50% gaps (e.g. silk 21 vs 6) the float test says no shipment, the integer test `(hi - lo) x 10000 >= 5000 x target` says ship (about 110 such stock pairs across the five goods). Provisional: the TypeScript sim keeps the float to reproduce Appendix B; the contract needs a decision (integer test recommended, then re-run the sim to re-baseline the section 2.9 numbers).
13. **Off-chain fields.** `Merchant.mood`, `last_line`, `verified` and `Player.display_name` cannot be produced by the contract interface in section 2.14 (`set_policy` and `register()` carry no such data). Provisional: they come from the server database / worker, not the contract.

## Process notes

- **P1 (2026-10-30): building before the date gate.** Section 0.3 rule 1 and the hackathon rule say code starts on 2026-11-01T00:00:00Z. Mahdi decided on 2026-10-30 to proceed anyway. Git history is not rewritten. The README, X post and submission must state the real dates and must not claim the project was built entirely inside the window.
