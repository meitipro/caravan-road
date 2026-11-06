# Spec changelog

## spec-v1.2 (ADOPTED 2026-11-03; prepared as a proposal on 2026-11-02, merged on owner delegation, tag `spec-v1.2`)

Branch `proposal/spec-v1.2-mult-k-3000`, one parameter only: **`MULT_K_BP` 4000 -> 3000** (price sensitivity). Everything else in sections 2.5-2.8 is unchanged (clamps stay 7500 / 13500, spreads, bias, fees, treasuries).

**Why** (evidence: `docs/ECONOMY_TUNING.md` section 4 Tables 3A, 3B, 3C-A, 3C-C, 3D and section 7 proposal 3; 10 seeds, 240 ticks, 5 bots):

- At K = 4000, spice and silk sit at a price clamp 86% (Appendix B rules) / 89% (contract rules) of the time; at K = 3000 only 22% / 24%. Grain, salt and iron are at a clamp 0% (Appendix B rules) / 9% (contract rules) of the time, against 0% / 29% at K = 4000.
- Median profit per trip stays about the same: 1,432 -> 1,231 fils (Appendix B rules) and 2,722 -> 2,687 fils (contract rules); under the contract rules fewer merchant-ticks are dry (19.0% -> 15.6%).
- Raising K (6000, 8000) raises profit but increases clamp time, truncated sales and dry merchants; K = 2000 removes clamping but 10 greedy bots then lose money on average.
- Trade-off named in the evidence: the price band shrinks to 75%-130% of base (was 75%-135%), so a little less price signal for the UI and the AI.

**What changes**

- Section 2.5 / 2.6: `MULT_K_BP = 3000`, `mult_bp = clamp(10000 + 3000 * (target - stock) / target, 7500, 13500)`. The maximum multiplier is 13000, so the upper clamp is unreachable for stock >= 0; the lower clamp binds above 183.3% of target stock (stock 367 of target 200, 56 of 30, ...).
- Section 2.7 golden vectors (same seven inputs): `grain` 0 -> 1248 / 1300 / 1352 (was 1296 / 1350 / 1404); `iron` 37 -> 4565 / 4756 / 4946 (was 4807 / 5008 / 5208); `spice` 55 -> 10261 / 10916 / 11570 (was 9827 / 10455 / 11082); `silk` 12 -> 20815 / 21240 / 21664 (was 21873 / 22320 / 22766). The rows `grain` 200, `grain` 400 and `silk` 60 are unchanged. Only the `grain` stock-0 row changes clamp status (was on the high clamp, now unclamped); the other rows keep theirs. Derivations are in `spec/ECONOMY.md` 2.7.
- Section 2.2 (`spec/GAME.md`) mid-price range column: the lower bounds do not change; the upper bounds become grain 1,300, salt 1,950, iron 5,200, spice 15,600, silk 26,000 (were 1,350 / 2,025 / 5,400 / 16,200 / 27,000).
- Prices at stock = target (the start of every world) do not change, so a fresh world opens with the same prices as before; they diverge as stock moves away from target.
- At K = 3000 every real target (30, 40, 100, 120, 200) divides `3000 x (target - stock)` exactly, so `mult_bp` no longer rounds for real goods. The truncate-toward-zero rule still governs `mid`, `ask`, `bid` and any other division; tests exercise `mult_bp` truncation with synthetic targets.
- **Section 2.9 simulation numbers change; the Appendix B figures no longer apply to the shared sim.** `pnpm sim` (seed 7, 240 ticks, Appendix B rules, real runs, identical to a local K = 3000 copy of `scripts/ref`): 2 bots 53 trips / median 5,795 fils / 10 broke; 5 bots 190 / 1,392 / 47; 10 bots 329 / 689 / 72; money conserved in all. The spec-v1 / v1.1 Appendix B figures (64 / 5,944 / 23, 177 / 1,088 / 43, 342 / 1,099 / 86) are what the unchanged `scripts/ref/economy_sim.py` still prints. Contract-rule figures (the spec-v1.1 method, `scripts/analysis/econ_variant.py` `contract_d123`, which reproduces 61/6,714/26, 132/933/44, 344/958/74 at K = 4000): 2 bots 53 / 8,175 / 16; 5 bots 182 / 739 / 28; 10 bots 314 / 704 / 66. Single-seed medians swing a lot (the sim is chaotic); use the 10-seed means in `docs/ECONOMY_TUNING.md` for any comparison.

**Not part of this proposal:** treasury size, re-baselining section 2.9 with contract semantics, shippable spice and silk, guard pricing, the first-minute goal and the other items of `docs/ECONOMY_TUNING.md` section 7. `scripts/ref/*` was deliberately NOT changed on the proposal branch; on adoption `MULT_K_BP = 3000` was set in `scripts/ref/world.py` too, so `economy_sim.py` and `pnpm sim` agree again (the spec-v1.1 figures above are the old K = 4000 output).

**Applied on the branch to:** `spec/ECONOMY.md`, `spec/GAME.md`, `packages/shared` (`PARAMS.MULT_K_BP`, golden vectors, sim expectations, regenerated `fixtures/world.json`), `contracts/caravan/src/math.rs` and its tests, `apps/web` and `apps/worker` tests, `docs/ECONOMY.md`, `docs/NPC_EVAL.md` (regenerated), README, PROGRESS. Before adopting, `cargo test`, `cargo clippy` and the wasm release build were run in `contracts/caravan` (the Rust expectations had been computed with the Python reference and cross-checked with `tradeCost()`); after adoption the suite passes (68 tests) and the wasm builds, see PROGRESS.md D5.

## spec-v1.1 (2026-10-31)

Adopted from the contract implementation (`contracts/caravan/DECISIONS.md`, independently audited) to resolve OPEN_QUESTIONS #6, #8, #11, #12 and #4:

- **Ambush loss (#6):** each cargo good loses `floor(30% x qty)` (section 2.4 text). Appendix B's `q * 7000 // 10000` (ceil loss) is superseded for the contract; the TypeScript sim `packages/shared/src/sim.ts` still reproduces Appendix B exactly and is a reference, not the contract.
- **World tick order (#11):** production/consumption, rebalancing, recycling, then merchant-driven `ship` (section 2.8 text).
- **House-caravan gap test (#12):** integer test `(hi - lo) x 10000 >= 5000 x target`.
- **Stall fee (#8):** paid by the seller (plan 5.3), 2% rounded up, minimum 1 fils; `limit_total` bounds the price.
- **Faucet (#4):** allowed when net worth is under 5,000 fils, 1 hour cooldown (the shared mock uses 60 s for demos).
- **Section 2.9 numbers with the contract rules** (reference sim re-run, seed 7, 240 ticks): 2 bots 61 trips / median 6,714 fils / 26 broke; 5 bots 132 / 933 / 44; 10 bots 344 / 958 / 74; money conserved in all. The Appendix B figures (64/5,944/23, 177/1,088/43, 342/1,099/86) remain what `pnpm sim` prints.
- **Added safety rules (audit):** minimum withdrawal 1,000 fils and one open withdrawal per player; `set_policy` moves spread/bias at most 300 bp per change, once per tick; merchant `ship` only to a destination below target stock, paying at most 25% of its treasury per tick; only the owner can unpause.
