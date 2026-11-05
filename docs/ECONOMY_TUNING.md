# Economy tuning evidence (Phase 8 input)

> **Status: regenerated on 2026-11-05 with the spec-v1.2 baseline `MULT_K_BP = 3000`** (merged 2026-11-03, tag `spec-v1.2`, PROGRESS decision D5). Every table is a real run of the scripts in `scripts/analysis/`; tables that carry the evidence for the change from K = 4000 (spec-v1.1) to K = 3000 show both values and are labelled with the K they use. Tables without a K in the title use K = 3000. The previous version of this file (K = 4000 baseline) is in git history (`4b4567c`); its K = 4000 numbers are reproduced exactly by the K = 4000 rows below (Tables 1H, 3B, 3C, 3D, 3E), which is a consistency check of the regeneration.
> Nothing in `spec/`, `packages/shared/` or `contracts/` is changed by this file. Proposal 3 of section 7 (K 4000 to 3000) is now adopted; proposals 1, 2 and 4-9 are still open and need the owner's decision and a new spec version.
> This file is generated: `python scripts/analysis/build_doc.py` fills the tables from `scripts/analysis/results/`, which the scripts in `scripts/analysis/` produce. Every number in a table comes from a run; sentences quote those tables. **Sections whose conclusions changed with the new baseline are marked "Changed with K = 3000" and summarised in section 0.1.**

## 0. Top findings (K = 3000 baseline)

1. **Merchant treasuries are still the binding constraint, and the published sim hides how badly (conclusion unchanged).** With the reference semantics 20-32% of cargo sales (ten-seed means; 14-36% for single seeds) are cut short by the merchant's treasury and 14-24% of the sale revenue is lost (Tables 1A, 1B). In the reference sim the unsold goods are *destroyed*; the contract instead rejects the sale and the player keeps the goods. With that contract-faithful behaviour, 5-10 greedy players drain the four merchants from 200,000 fils to between 4,200 and 9,300 fils in 4 hours, 58-74% of merchant-ticks are below 20% of the seed, and trips fall to between a third and a half (Tables 1G and 5D). At K = 4000 the corresponding figures were 3,500-10,600 fils and 64-74%; the move to K = 3000 did not fix this.
2. **Bigger treasuries still do not fix it and scale operator risk linearly (unchanged).** Going from 50,000 to 200,000 fils per merchant lowers the truncated share only from 31.7% to 21.6% (contract rules, 5 bots, Table 1C-C) while the worst operator loss grows from 177,147 to 722,256 fils. At the spec treasury the operator's seed capital is nearly fully consumed in the runs: worst observed loss 192,019 of 200,000 fils (96%, Table 5A) and never above it.
3. **Changed with K = 3000: spice and silk no longer live on the clamps.** At K = 4000 they were at a price clamp 66-89% of the 4 hours; at K = 3000 they are at a clamp 17-24%, and only at the LOW clamp (the high clamp cannot be reached because the multiplier tops out at 13,000; Tables 3B, 3C). All goods together: 7-15% of the time at a clamp (5 and 10 bots, 4 h) instead of 27-53%. The root cause of the clamp saturation, that the house caravans cannot pay for 4 units of silk out of a 50,000-fils treasury or its 25% budget, is unchanged: 6 silk units shipped per run under the contract rules versus 655 with 200,000-fils treasuries under the reference rules (Table 5C). The cost of the change is small: median profit per trip 1,231 versus 1,432 (A, 5 bots) and 2,687 versus 2,722 (C, 5 bots); under A with 10 bots the mean profit per trip falls from -24 to -294 fils (Tables 1B, 1H).
4. **"First profitable trade under one minute" still cannot be met for realised profit**: the shortest journey is 180 s (Table 4E). A first journey can start inside the first minutes (median 0-5 minutes after joining a running world, Table 4F), and the first realised profit arrives a median 6-12 minutes after joining; a brand-new world has no price gaps for the first minutes (Table 4A: first positive trade at minute 3, 805 fils, was minute 2 and 266 fils at K = 4000) so the first profitable arrival takes a median 14-22 minutes there (13-20 at K = 4000).
5. **No exploit loop found in the integer math, and money is conserved in every one of the 2,845 variant runs** (plus the shared TypeScript sim on every tick in validation). 635,400 same-merchant round trips and 30,917 closed multi-trade loops: none profitable (Tables 5-1, 5-2). Real but bounded edges: 1-unit trades beat one 40-unit trade by up to 1.77% on sells and 0.53% on buys (Table 5-3; **changed**: up to 3.91% and 0.83% at K = 4000); a merchant that drifts its bias at the allowed 300 bp per tick gives a risk-free hold-and-sell after 2 ticks (Table 5-4); an ambush destroys nothing when a good is carried in lots of 3 or fewer (Table 5-5), and guards are a pure cost on 5 of 6 routes (Table 4C).

Ranked proposals are in section 7.

### 0.1 What changed with the K = 3000 baseline, and what did not

| Question | Conclusion at K = 4000 (previous version) | Conclusion at K = 3000 (this version) | Evidence |
|---|---|---|---|
| Q1 treasuries bind | 20-35% of sales truncated, 14-25% of revenue lost | **unchanged**: 20-32% and 14-24% | Tables 1B vs 1H |
| Q1 unsold goods kept (contract) | 51-55% truncated, merchants end at 3,488-10,526 fils, 64-74% of merchant-ticks dry | **unchanged in direction**: 43-51% truncated, 4,248-9,300 fils, 58-74% dry | Tables 1G, 5D |
| Q1 bigger treasuries | 35.3% to 23.9% truncated for 4x the treasury | **unchanged**: 31.7% to 21.6% | Table 1C-C |
| Q1 REBALANCE, RECYCLE, ship units | weak levers | **unchanged** | Tables 1D, 1E, 1F |
| Q2 bankruptcy and faucet | faucet takes 39% of 10 bots under 50 dinars after 24 h (A) to 0% | **unchanged**: 43% to 0% | Table 2A |
| Q3 clamp saturation | spice+silk at a clamp 66-89%, all goods 27-53% | **changed**: spice+silk 17-24% (low clamp only), all goods 7-15% | Tables 3B, 3C |
| Q3 wider clamps / larger spice and silk targets | wider clamps cut clamp time but cost trips; x2/x3 targets help partly | **changed**: at K = 3000 a floor of 6000 removes the remaining clamp time at small cost; x2/x3 targets no longer matter | Tables 3D, 3E |
| Q4 first profit | first positive trade at minute 2 (266 fils); first profitable arrival after a median 6-11 min (running world), 13-20 min (fresh world) | **changed a little**: minute 3 (805 fils); 6-12 min and 14-22 min; no conclusion changes | Tables 4A, 4F |
| Q4 best journey for a first mover | median 9,312-17,830 fils on the short route | **changed a little**: median 5,374-16,769 fils (all 8 world types positive) | Table 4B |
| Q5 integer loops | none profitable | **unchanged**; split trades are worth less (1.77% sells, 0.53% buys, was 3.91%, 0.83%) | Tables 5-1 to 5-3 |
| Q5 operator exposure | worst loss 191,308 of 200,000 fils (96%) | **unchanged**: 192,019 (96%) | Table 5A |
| Proposal 7 (spice/silk targets x2) | fallback if K change rejected | **moot**: no effect on clamp time at K = 3000 | Table 3E |

## 1. Method and validation

**Tools** (all new files are under `scripts/analysis/`; `scripts/ref` and `packages/shared` are only read):

| file | purpose |
|---|---|
| `econ_variant.py` | line-by-line port of `scripts/ref/economy_sim.py` with extra knobs (treasury size, `MULT_K_BP` and clamps, `NPC_SHIP_UNITS`, rebalance/recycle percentages, target stock, faucet, contract rule switches) and counters (truncated sales, revenue shortfall, clamp time, treasury time, Gini, operator profit and loss, money conservation on every tick). The default `MULT_K_BP` is `K_SPEC = 3000`; `K_PREV = 4000` is passed explicitly wherever the previous baseline is shown |
| `ts_runsim.ts`, `validate.py` | run the shared TypeScript `runSim()` and the Python reference script as subprocesses and compare them with the variant, at one stated K per comparison (`python scripts/analysis/validate.py [--k N]`) |
| `run_exp.py` | questions 1-3 (tables 1x, 2x, 3x); parts `q1`, `q2`, `q3` can run in parallel |
| `run_q4.py` | question 4 (tables 4x) |
| `run_q5.py`, `exploits.ts` | question 5 (tables 5A-5D and 5-1 to 5-7); `exploits.ts` calls the real `tradeCost()` / `quoteBig()` from `packages/shared/src/quote.ts` (K = 3000) |
| `build_doc.py`, `doc_template.md` | generate this file |

**Why a Python variant:** `runSim()` exposes only `bots`, `ticks`, `seed`, `npc`, `rebalPct` and `housePct`. Treasury size, `MULT_K_BP` and `NPC_SHIP_UNITS_PER_TICK` are constants in `packages/shared` that I must not change, and the counters I need are not exported. The variant is checked against both implementations before use, at one K at a time:

```
== 0. MULT_K_BP in every source (the baseline must be the same everywhere) ==
  scripts/ref/world.py: 3000
  packages/shared/src/world.ts: 3000
  contracts/caravan/src/math.rs: 3000
  variant default (econ_variant.K_SPEC): 3000
  consistent
=== K = MULT_K_BP 3000 (spec-v1.2) ===
python-variant == python-reference (as is): 25/25 configs
python-variant == TypeScript runSim (K compiled into packages/shared = 3000): 25/25 configs
-- vs spec/CHANGELOG.md spec-v1.2 figures (seed 7, 240 ticks), trips/median/broke --
  OK   Appendix B rules (`pnpm sim`) bots=2: changelog 53/5795/10  variant 53/5795/10  conserved=True
  OK   Appendix B rules (`pnpm sim`) bots=5: changelog 190/1392/47  variant 190/1392/47  conserved=True
  OK   Appendix B rules (`pnpm sim`) bots=10: changelog 329/689/72  variant 329/689/72  conserved=True
  OK   contract rules D1-D3 (contract_d123) bots=2: changelog 53/8175/16  variant 53/8175/16  conserved=True
  OK   contract rules D1-D3 (contract_d123) bots=5: changelog 182/739/28  variant 182/739/28  conserved=True
  OK   contract rules D1-D3 (contract_d123) bots=10: changelog 314/704/66  variant 314/704/66  conserved=True
=== K = MULT_K_BP 4000 (spec-v1.1) ===
python-variant == python-reference (with MULT_K_BP patched in memory to 4000): 25/25 configs
TypeScript runSim not compared at K = 4000: packages/shared is compiled with K = 3000 and runSim takes no K
-- vs spec/CHANGELOG.md spec-v1.1 figures (seed 7, 240 ticks), trips/median/broke --
  OK   Appendix B rules (`pnpm sim`) bots=2: changelog 64/5944/23  variant 64/5944/23  conserved=True
  OK   Appendix B rules (`pnpm sim`) bots=5: changelog 177/1088/43  variant 177/1088/43  conserved=True
  OK   Appendix B rules (`pnpm sim`) bots=10: changelog 342/1099/86  variant 342/1099/86  conserved=True
  OK   contract rules D1-D3 (contract_d123) bots=2: changelog 61/6714/26  variant 61/6714/26  conserved=True
  OK   contract rules D1-D3 (contract_d123) bots=5: changelog 132/933/44  variant 132/933/44  conserved=True
  OK   contract rules D1-D3 (contract_d123) bots=10: changelog 344/958/74  variant 344/958/74  conserved=True
variant runs in this validation: 62 (money conserved in 62); TypeScript runSim configurations conserved on every tick: 25
VALIDATION PASSED
```

(`validate.py` first checks that the K in `scripts/ref/world.py`, `packages/shared/src/world.ts`, `contracts/caravan/src/math.rs` and the variant default agree. At K = 3000 it compares trips, median, p10, p90, broke events, house balance, every bot's net worth and every merchant treasury, for 2/5/10 bots x seeds 7/11/13 plus REBALANCE_PCT 0/10/50/100, HOUSE_RECYCLE_PCT 0/25/50, no NPC, and 0 bots, against the real `scripts/ref/economy_sim.py` (whose `world.py` now has K = 3000) and against the shared TypeScript `runSim()`. At K = 4000 it compares the same grid with the real reference script run through a wrapper that sets `MULT_K_BP = 4000` in memory (the file on disk is not touched); `runSim()` cannot take a K, so it is not compared at 4000. For both K it reproduces the `spec/CHANGELOG.md` figures with the Appendix B rules and with the three contract decisions switched on. The earlier version of this script compared the K = 4000 variant with the K = 3000 reference and failed by design; that mismatch is fixed.)

**Two rule sets are used in every table:**

* **A** = Appendix B, exactly what `pnpm sim` and spec section 2.9 print (ceil ambush loss, house caravans before rebalancing, float gap test, house caravans automatic, unsold goods of a truncated sale destroyed).
* **C** = contract-faithful: floor ambush loss, tick order production, rebalancing, recycling, ship (D1-D3, which match the CHANGELOG exactly), plus two contract rules the reference sim lacks: merchant-driven `ship` with the D25 limits (destination below target stock, at most 25% of its treasury per tick; I fit the quantity to that budget, snapshot taken after recycling) and the warehouse cap (`2 x target`). D25 is modelled from `contracts/caravan/DECISIONS.md`, not from the Rust code; it is the only unvalidated piece. Warehouse-cap hits were 0 in every run of Tables 1A, 1B and 1H, so that rule never mattered there.

**Seeds:** per-seed tables use seeds 7, 11, 13. Averages use **ten** seeds, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41 (the requested five are the first five). The sim is chaotic (spec CHANGELOG says medians swing 2x for one changed rounding), so differences of a few percentage points between rows are noise; sd across seeds is shown in Table 1B. The K = 3000 and K = 4000 rows use the same seeds, so the comparison is paired, but a single row difference is still within noise unless it is large.

**Bots** are the reference greedy bots: one good per trip, at most half the merchant's stock, start with 50,000 fils, no guards. They are a stress model, not a forecast of human play.

**Known artefacts of the reference sim** that the tables expose (none is changed here):

1. A truncated sale destroys the unsold goods (`b.inv = {}`); the contract rejects the sale and the player keeps the goods (`try_trade`, `MERCHANT_BROKE`, all-or-nothing per trade). Variant switch `keep_unsold` models the contract behaviour (leftover goods are retried at the same city, then carried to the city that can pay most).
2. After a truncated sale the recomputed price can exceed the treasury, so the treasury goes negative (column "overdrafts": 0.6-3.0 events per run in the ten-seed means of Table 1B; 0.4-4.1 at K = 4000, Table 1H).
3. Sales may push a merchant above `2 x target` (the contract refuses); the count was 0.
4. The reference runs house caravans inside the tick; the contract only does so with `auto_ship = true` (default false), otherwise the worker's merchants call `ship` under D25.

## 2. Question 1 - merchant treasuries and truncated sales

**Definitions.** *Truncated* = at arrival the merchant cannot pay the full price (the reference's "merchant broke" event). *Net revenue lost* = (what the cargo would have fetched at the same prices if the merchant could always pay, after the 1% fee) minus what was paid, as a share of the former. *Profit per cargo sale* = net proceeds minus the buy outlay, averaged per sale: "if the merchant always paid" versus actual. *Merchant-ticks < 20%* = share of (merchant, tick) pairs with a treasury under 20% of the seed.

### 2.1 How often, and how much is lost

Commands: `python scripts/analysis/run_exp.py q1` (tables 1A, 1B, 1H). The TypeScript sim gives the same truncated counts for rule set A (10/47/72 for 2/5/10 bots at seed 7, equal to the "broke" column of spec 2.9 in spec-v1.2).

**Table 1A-A. Truncated sales per run, Appendix B (`pnpm sim`), K = 3000 (spec-v1.2 baseline), 240 ticks**

| bots | seed | trips | cargo sales | truncated (= 'broke') | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip (fils) | merchant-ticks with treasury < 20% | overdrafts | warehouse-cap hits | money conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 7 | 53 | 53 | 10 | 18.9% | 15.5% | 9,751 / 2,308 | 5,795 | 16.5% | 1 | 0 | yes |
| 2 | 11 | 78 | 78 | 19 | 24.4% | 13.7% | 7,736 / 1,675 | 1,861 | 4.0% | 0 | 0 | yes |
| 2 | 13 | 50 | 50 | 10 | 20.0% | 10.4% | 8,094 / 3,228 | 5,439 | 26.0% | 0 | 0 | yes |
| 5 | 7 | 190 | 186 | 47 | 25.3% | 23.3% | 8,091 / -244 | 1,392 | 2.8% | 0 | 0 | yes |
| 5 | 11 | 173 | 173 | 24 | 13.9% | 19.9% | 5,456 / -347 | 898 | 1.5% | 1 | 0 | yes |
| 5 | 13 | 171 | 170 | 35 | 20.6% | 20.3% | 5,658 / -443 | 1,041 | 1.7% | 0 | 0 | yes |
| 10 | 7 | 329 | 325 | 72 | 22.2% | 24.2% | 7,165 / -429 | 689 | 4.4% | 0 | 0 | yes |
| 10 | 11 | 308 | 302 | 60 | 19.9% | 22.2% | 6,040 / -460 | 586 | 3.4% | 0 | 0 | yes |
| 10 | 13 | 308 | 300 | 56 | 18.7% | 22.5% | 6,081 / -340 | 654 | 3.0% | 2 | 0 | yes |

**Table 1A-C. Truncated sales per run, contract rules (D1-D3, D25 ship limits, warehouse cap), K = 3000 (spec-v1.2 baseline), 240 ticks**

| bots | seed | trips | cargo sales | truncated (= 'broke') | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip (fils) | merchant-ticks with treasury < 20% | overdrafts | warehouse-cap hits | money conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 7 | 66 | 66 | 24 | 36.4% | 20.6% | 10,730 / 1,285 | 3,828 | 6.9% | 0 | 0 | yes |
| 2 | 11 | 43 | 43 | 11 | 25.6% | 8.8% | 7,020 / 3,331 | 2,754 | 17.6% | 1 | 0 | yes |
| 2 | 13 | 39 | 39 | 12 | 30.8% | 14.1% | 10,016 / 3,638 | 6,123 | 18.2% | 0 | 0 | yes |
| 5 | 7 | 139 | 139 | 49 | 35.3% | 21.0% | 10,800 / 1,235 | 3,194 | 15.5% | 4 | 0 | yes |
| 5 | 11 | 177 | 177 | 51 | 28.8% | 19.8% | 8,677 / 667 | 1,766 | 3.9% | 4 | 0 | yes |
| 5 | 13 | 119 | 119 | 36 | 30.3% | 19.0% | 8,598 / 1,420 | 2,751 | 26.8% | 2 | 0 | yes |
| 10 | 7 | 300 | 300 | 77 | 25.7% | 23.6% | 8,964 / 422 | 1,032 | 4.7% | 0 | 0 | yes |
| 10 | 11 | 244 | 244 | 67 | 27.5% | 22.2% | 7,827 / 611 | 1,169 | 17.0% | 1 | 0 | yes |
| 10 | 13 | 299 | 299 | 66 | 22.1% | 23.5% | 8,933 / 458 | 1,010 | 5.6% | 1 | 0 | yes |

**Table 1B. Ten-seed means (seeds 7, 11, 13, 17, 19, 23, 29, 31, 37, 41), K = 3000 (spec-v1.2 baseline), 240 ticks**

| rules | bots | trips | cargo sales | truncated | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip (fils) | mean profit/trip (fils) | merchant-ticks < 20% treasury | overdrafts | warehouse hits | conserved runs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 2 | 67.7 | 67.1 | 16.9 | 25.2% (sd 5.3%) | 16.5% | 8,258 / 1,275 | 3,998 | 1,264 | 10.3% | 1.1 | 0.0 | 10/10 |
| A | 5 | 175.0 | 172.4 | 39.9 | 23.1% (sd 4.3%) | 20.1% | 6,916 / 45 | 1,231 | 45 | 3.4% | 0.8 | 0.0 | 10/10 |
| A | 10 | 318.8 | 312.9 | 62.4 | 19.9% (sd 2.1%) | 23.0% | 6,465 / -300 | 768 | -294 | 3.8% | 0.7 | 0.0 | 10/10 |
| C | 2 | 44.8 | 44.8 | 11.8 | 26.3% (sd 8.2%) | 13.6% | 9,036 / 3,117 | 4,191 | 3,117 | 21.9% | 0.8 | 0.0 | 10/10 |
| C | 5 | 143.9 | 143.9 | 45.6 | 31.7% (sd 2.0%) | 20.4% | 9,613 / 1,103 | 2,687 | 1,103 | 15.6% | 3.0 | 0.0 | 10/10 |
| C | 10 | 296.1 | 296.1 | 76.1 | 25.7% (sd 2.2%) | 23.6% | 8,827 / 382 | 1,161 | 382 | 7.2% | 0.6 | 0.0 | 10/10 |

**Table 1H. The same as Table 1B at the previous baseline K = 4000 (spec-v1.1, previous baseline) (comparison; ten-seed means, 240 ticks)**

| rules | bots | trips | cargo sales | truncated | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip (fils) | mean profit/trip (fils) | merchant-ticks < 20% treasury | overdrafts | warehouse hits | conserved runs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 2 | 68.7 | 68.1 | 20.4 | 30.0% (sd 4.8%) | 19.2% | 9,355 / 1,444 | 4,231 | 1,431 | 13.3% | 2.1 | 0.0 | 10/10 |
| A | 5 | 181.6 | 179.2 | 42.2 | 23.5% (sd 2.0%) | 21.7% | 7,794 / 77 | 1,432 | 76 | 2.5% | 1.0 | 0.0 | 10/10 |
| A | 10 | 334.9 | 328.0 | 66.6 | 20.3% (sd 2.2%) | 23.5% | 6,868 / -25 | 857 | -24 | 3.5% | 1.1 | 0.0 | 10/10 |
| C | 2 | 33.8 | 33.8 | 9.3 | 27.5% (sd 7.0%) | 13.9% | 10,832 / 4,304 | 4,630 | 4,304 | 26.8% | 0.4 | 0.0 | 10/10 |
| C | 5 | 130.4 | 130.4 | 46.0 | 35.3% (sd 4.4%) | 23.2% | 11,115 / 1,074 | 2,722 | 1,074 | 19.0% | 4.1 | 0.0 | 10/10 |
| C | 10 | 307.7 | 307.7 | 80.6 | 26.2% (sd 2.3%) | 25.2% | 9,559 / 452 | 1,378 | 452 | 8.4% | 1.9 | 0.0 | 10/10 |

Reading (**conclusion unchanged by K = 3000**): at the spec treasury, 14-36% of single-seed cargo sales are truncated (mean 20-32%) and the merchant's inability to pay removes 14-24% of the sale revenue (means). A typical cargo would earn 6,465-9,613 fils if the merchant could pay (13-19% of a 50,000-fils capital) but realises -294 to 3,117 fils on average. The share falls only a little as bots are added (25.2%, 23.1%, 19.9% under A): the loss is a per-sale ceiling, not only a crowding effect. Against K = 4000 (Table 1H) the truncated share moves by at most 4.8 points (A: 30.0, 23.5, 20.3 to 25.2, 23.1, 19.9; C: 27.5, 35.3, 26.2 to 26.3, 31.7, 25.7), within the seed noise of Table 1B. A single merchant treasury of 50,000 fils caps one visit's revenue at 500 dinars; a 40-unit cargo of silk is worth 800,000 fils at base.

### 2.2 Sensitivity to treasury size (operator risk grows with it)

Operator seed capital = 4 x treasury (LIVE cap today: 4 x 5 USDC = 20 USDC). "Operator P&L" = merchants' cash plus house balance minus 4 x treasury.

**Table 1C-A. Merchant treasury sweep, Appendix B (`pnpm sim`), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks (bot start cash stays 50,000)**

| bots | treasury per merchant (fils) | operator seed capital (USDC) | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | operator P&L at end (fils, mean) | worst operator P&L seen (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 50,000 | 20 | 39.9 | 23.1% | 20.1% | 6,916 / 45 | 1,231 | 45 | 3.4% | 87,776 | -115,057 | 10/10 |
| 5 | 75,000 | 30 | 33.6 | 19.8% | 19.0% | 6,809 / 262 | 1,419 | 258 | 4.4% | 58,651 | -164,332 | 10/10 |
| 5 | 100,000 | 40 | 34.2 | 19.6% | 18.0% | 7,387 / 694 | 1,560 | 685 | 5.3% | -47,221 | -265,452 | 10/10 |
| 5 | 150,000 | 60 | 27.3 | 15.8% | 14.9% | 6,959 / 1,144 | 2,001 | 1,120 | 7.8% | -77,843 | -309,716 | 10/10 |
| 5 | 200,000 | 80 | 0.5 | 0.4% | 0.3% | 3 / -76 | 1,044 | -74 | 1.1% | 93,717 | -70,693 | 10/10 |
| 10 | 50,000 | 20 | 62.4 | 19.9% | 23.0% | 6,465 / -300 | 768 | -294 | 3.8% | 202,761 | -50,116 | 10/10 |
| 10 | 75,000 | 30 | 56.8 | 18.5% | 21.2% | 6,342 / -81 | 759 | -80 | 4.8% | 158,239 | -77,048 | 10/10 |
| 10 | 100,000 | 40 | 48.5 | 15.8% | 18.0% | 5,536 / -85 | 1,038 | -83 | 6.3% | 141,506 | -136,238 | 10/10 |
| 10 | 150,000 | 60 | 5.5 | 2.4% | 2.2% | -105 / -615 | 816 | -593 | 2.0% | 197,648 | 0 | 10/10 |
| 10 | 200,000 | 80 | 0.7 | 0.4% | 0.3% | -311 / -396 | 738 | -382 | 0.6% | 120,179 | -32,087 | 10/10 |

**Table 1C-C. Merchant treasury sweep, contract rules (D1-D3, D25 ship limits, warehouse cap), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks (bot start cash stays 50,000)**

| bots | treasury per merchant (fils) | operator seed capital (USDC) | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | operator P&L at end (fils, mean) | worst operator P&L seen (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 50,000 | 20 | 45.6 | 31.7% | 20.4% | 9,613 / 1,103 | 2,687 | 1,103 | 15.6% | -107,243 | -177,147 | 10/10 |
| 5 | 75,000 | 30 | 34.8 | 27.3% | 18.1% | 9,683 / 1,894 | 2,790 | 1,894 | 24.7% | -181,036 | -281,877 | 10/10 |
| 5 | 100,000 | 40 | 34.2 | 23.9% | 17.2% | 10,447 / 2,338 | 2,491 | 2,338 | 21.1% | -227,986 | -358,360 | 10/10 |
| 5 | 150,000 | 60 | 33.5 | 22.1% | 17.1% | 12,377 / 2,825 | 3,088 | 2,825 | 16.3% | -310,986 | -546,347 | 10/10 |
| 5 | 200,000 | 80 | 32.2 | 21.6% | 16.5% | 13,637 / 3,504 | 3,317 | 3,504 | 16.4% | -367,659 | -722,256 | 10/10 |
| 10 | 50,000 | 20 | 76.1 | 25.7% | 23.6% | 8,827 / 382 | 1,161 | 382 | 7.2% | 47,665 | -169,187 | 10/10 |
| 10 | 75,000 | 30 | 71.0 | 24.3% | 22.9% | 9,202 / 663 | 1,188 | 663 | 10.6% | -24,380 | -288,542 | 10/10 |
| 10 | 100,000 | 40 | 71.7 | 24.1% | 23.5% | 10,385 / 744 | 1,365 | 744 | 9.7% | -62,582 | -275,491 | 10/10 |
| 10 | 150,000 | 60 | 68.3 | 22.8% | 22.1% | 10,768 / 1,061 | 1,650 | 1,061 | 12.9% | -46,334 | -449,351 | 10/10 |
| 10 | 200,000 | 80 | 69.7 | 22.9% | 21.9% | 12,392 / 1,257 | 2,366 | 1,257 | 13.1% | -215,860 | -506,229 | 10/10 |

Reading (**unchanged**): under the contract rules (C) 4x the treasury (50k to 200k) cuts the truncated share only from 31.7% to 21.6% and lost revenue from 20.4% to 16.5%, because players grow richer in step (mean profit per trip 1,103 to 3,504 fils) and drain whatever is there; the worst operator loss rises from 177,147 to 722,256 fils (89% of a 200k seed at 50k; 90% of an 800k seed at 200k). Under A the 200k row looks "fixed" (0.4% truncated) but only because the profit disappears too (potential profit per sale 3 versus 6,916 at 50k): at 200k the house caravans can finally pay for silk and spice (Table 5C) and compete the arbitrage away. At 75k and 100k the improvement is small (23.1% to 19.8% and 19.6% truncated, A, 5 bots). **Larger treasuries mean more operator risk for little relief.**

### 2.3 REBALANCE_PCT, HOUSE_RECYCLE_PCT, NPC ship units

**Table 1D-A. REBALANCE_PCT sweep (0 = rebalancing off, other NPC steps on), Appendix B (`pnpm sim`), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks**

| bots | rebal_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 131.6 | 33.5 | 26.3% | 18.0% | 6,831 / 888 | 1,581 | 861 | 38.2% | 10/10 |
| 5 | 10 | 158.9 | 30.7 | 19.7% | 16.6% | 5,474 / 231 | 1,213 | 227 | 9.0% | 10/10 |
| 5 | 30 | 175.0 | 39.9 | 23.1% | 20.1% | 6,916 / 45 | 1,231 | 45 | 3.4% | 10/10 |
| 5 | 50 | 172.5 | 37.4 | 22.1% | 19.5% | 7,192 / 172 | 1,482 | 169 | 2.9% | 10/10 |
| 5 | 100 | 173.5 | 37.1 | 21.6% | 18.6% | 7,027 / 346 | 1,678 | 342 | 3.7% | 10/10 |
| 10 | 0 | 256.6 | 53.2 | 21.3% | 16.4% | 4,689 / 51 | 721 | 50 | 25.7% | 10/10 |
| 10 | 10 | 306.3 | 61.9 | 20.6% | 23.5% | 5,594 / -503 | 594 | -493 | 3.9% | 10/10 |
| 10 | 30 | 318.8 | 62.4 | 19.9% | 23.0% | 6,465 / -300 | 768 | -294 | 3.8% | 10/10 |
| 10 | 50 | 301.7 | 56.5 | 19.1% | 20.6% | 6,352 / -3 | 813 | -3 | 3.7% | 10/10 |
| 10 | 100 | 317.1 | 32.0 | 10.4% | 11.9% | 2,670 / -378 | 841 | -368 | 2.2% | 10/10 |

**Table 1D-C. REBALANCE_PCT sweep (0 = rebalancing off, other NPC steps on), contract rules (D1-D3, D25 ship limits, warehouse cap), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks**

| bots | rebal_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 128.7 | 35.9 | 27.9% | 18.8% | 8,691 / 1,320 | 3,439 | 1,320 | 30.9% | 10/10 |
| 5 | 10 | 122.3 | 38.2 | 31.2% | 18.9% | 8,467 / 1,287 | 2,355 | 1,287 | 23.2% | 10/10 |
| 5 | 30 | 143.9 | 45.6 | 31.7% | 20.4% | 9,613 / 1,103 | 2,687 | 1,103 | 15.6% | 10/10 |
| 5 | 50 | 144.5 | 46.3 | 32.0% | 20.8% | 9,142 / 904 | 2,725 | 904 | 12.6% | 10/10 |
| 5 | 100 | 168.2 | 55.8 | 33.2% | 21.8% | 10,577 / 692 | 2,821 | 692 | 6.5% | 10/10 |
| 10 | 0 | 311.3 | 70.5 | 22.6% | 18.7% | 6,134 / 322 | 1,232 | 322 | 23.1% | 10/10 |
| 10 | 10 | 289.1 | 69.0 | 23.9% | 21.5% | 7,337 / 380 | 1,001 | 380 | 9.6% | 10/10 |
| 10 | 30 | 296.1 | 76.1 | 25.7% | 23.6% | 8,827 / 382 | 1,161 | 382 | 7.2% | 10/10 |
| 10 | 50 | 302.4 | 78.7 | 26.0% | 23.6% | 8,940 / 363 | 1,228 | 363 | 6.2% | 10/10 |
| 10 | 100 | 313.8 | 84.1 | 26.8% | 24.6% | 9,715 / 267 | 1,425 | 267 | 5.2% | 10/10 |

**Table 1E-A. HOUSE_RECYCLE_PCT sweep (0 = recycling off), Appendix B (`pnpm sim`), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks**

| bots | house_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 168.0 | 35.7 | 21.6% | 18.8% | 5,818 / -166 | 1,189 | -164 | 7.2% | 10/10 |
| 5 | 5 | 170.8 | 38.6 | 22.9% | 19.4% | 6,896 / 155 | 1,399 | 153 | 3.8% | 10/10 |
| 5 | 10 | 175.0 | 39.9 | 23.1% | 20.1% | 6,916 / 45 | 1,231 | 45 | 3.4% | 10/10 |
| 5 | 25 | 170.6 | 36.4 | 21.7% | 19.0% | 6,580 / 221 | 1,170 | 217 | 3.9% | 10/10 |
| 5 | 50 | 163.1 | 36.2 | 22.6% | 18.6% | 6,719 / 307 | 1,311 | 302 | 3.5% | 10/10 |
| 10 | 0 | 305.9 | 58.8 | 19.7% | 22.1% | 5,680 / -367 | 715 | -359 | 4.0% | 10/10 |
| 10 | 5 | 313.0 | 59.9 | 19.6% | 22.3% | 6,444 / -179 | 801 | -176 | 3.8% | 10/10 |
| 10 | 10 | 318.8 | 62.4 | 19.9% | 23.0% | 6,465 / -300 | 768 | -294 | 3.8% | 10/10 |
| 10 | 25 | 308.2 | 57.7 | 19.1% | 22.0% | 6,257 / -116 | 802 | -114 | 3.7% | 10/10 |
| 10 | 50 | 318.1 | 60.7 | 19.4% | 22.1% | 6,242 / -101 | 768 | -100 | 3.9% | 10/10 |

**Table 1E-C. HOUSE_RECYCLE_PCT sweep (0 = recycling off), contract rules (D1-D3, D25 ship limits, warehouse cap), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks**

| bots | house_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 106.3 | 33.2 | 31.2% | 20.5% | 8,629 / 1,068 | 2,616 | 1,068 | 34.4% | 10/10 |
| 5 | 5 | 130.5 | 40.1 | 30.7% | 20.3% | 9,296 / 1,192 | 3,008 | 1,192 | 19.0% | 10/10 |
| 5 | 10 | 143.9 | 45.6 | 31.7% | 20.4% | 9,613 / 1,103 | 2,687 | 1,103 | 15.6% | 10/10 |
| 5 | 25 | 139.4 | 42.2 | 30.3% | 20.7% | 9,611 / 987 | 2,998 | 987 | 14.4% | 10/10 |
| 5 | 50 | 135.7 | 44.3 | 32.6% | 20.8% | 9,869 / 1,069 | 2,722 | 1,069 | 15.9% | 10/10 |
| 10 | 0 | 267.5 | 73.1 | 27.3% | 23.8% | 7,880 / 110 | 1,122 | 110 | 18.5% | 10/10 |
| 10 | 5 | 295.0 | 74.9 | 25.4% | 22.6% | 8,077 / 408 | 1,149 | 408 | 6.6% | 10/10 |
| 10 | 10 | 296.1 | 76.1 | 25.7% | 23.6% | 8,827 / 382 | 1,161 | 382 | 7.2% | 10/10 |
| 10 | 25 | 292.1 | 74.1 | 25.4% | 23.0% | 8,274 / 408 | 1,238 | 408 | 7.4% | 10/10 |
| 10 | 50 | 292.7 | 75.4 | 25.8% | 23.9% | 9,079 / 389 | 1,170 | 389 | 8.0% | 10/10 |

**Table 1F-A. NPC_SHIP_UNITS_PER_TICK sweep (0 = no house caravans), Appendix B (`pnpm sim`), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks**

| bots | ship_units | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 185.0 | 55.1 | 30.1% | 20.4% | 9,052 / 610 | 3,297 | 604 | 8.8% | 10/10 |
| 5 | 2 | 202.0 | 51.0 | 25.6% | 17.2% | 7,136 / 594 | 2,182 | 586 | 5.7% | 10/10 |
| 5 | 4 | 175.0 | 39.9 | 23.1% | 20.1% | 6,916 / 45 | 1,231 | 45 | 3.4% | 10/10 |
| 5 | 8 | 125.0 | 34.7 | 28.3% | 25.3% | 9,068 / 248 | 782 | 243 | 7.3% | 10/10 |
| 5 | 16 | 113.6 | 34.0 | 30.4% | 24.1% | 10,311 / 813 | 1,948 | 801 | 9.9% | 10/10 |
| 10 | 0 | 333.9 | 77.8 | 23.6% | 19.4% | 8,206 / 399 | 1,919 | 394 | 9.5% | 10/10 |
| 10 | 2 | 363.6 | 74.7 | 20.8% | 18.9% | 6,641 / -27 | 1,501 | -27 | 3.6% | 10/10 |
| 10 | 4 | 318.8 | 62.4 | 19.9% | 23.0% | 6,465 / -300 | 768 | -294 | 3.8% | 10/10 |
| 10 | 8 | 232.5 | 60.9 | 26.6% | 28.1% | 10,616 / -212 | 365 | -209 | 4.2% | 10/10 |
| 10 | 16 | 197.9 | 61.5 | 31.4% | 28.7% | 13,361 / 25 | 1,211 | 25 | 4.6% | 10/10 |

**Table 1F-C. NPC_SHIP_UNITS_PER_TICK sweep (0 = no house caravans), contract rules (D1-D3, D25 ship limits, warehouse cap), K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks**

| bots | ship_units | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 165.1 | 52.5 | 31.8% | 21.0% | 9,845 / 670 | 3,902 | 670 | 14.4% | 10/10 |
| 5 | 2 | 170.3 | 56.1 | 32.9% | 20.9% | 10,230 / 648 | 3,327 | 648 | 11.7% | 10/10 |
| 5 | 4 | 143.9 | 45.6 | 31.7% | 20.4% | 9,613 / 1,103 | 2,687 | 1,103 | 15.6% | 10/10 |
| 5 | 8 | 123.5 | 43.8 | 35.5% | 23.2% | 10,274 / 1,056 | 2,667 | 1,056 | 16.5% | 10/10 |
| 5 | 16 | 107.7 | 36.4 | 33.8% | 22.9% | 9,948 / 1,378 | 3,024 | 1,378 | 20.9% | 10/10 |
| 10 | 0 | 328.3 | 85.2 | 26.0% | 20.6% | 9,230 / 466 | 2,468 | 466 | 10.5% | 10/10 |
| 10 | 2 | 327.2 | 79.8 | 24.4% | 19.8% | 7,585 / 431 | 1,597 | 431 | 7.3% | 10/10 |
| 10 | 4 | 296.1 | 76.1 | 25.7% | 23.6% | 8,827 / 382 | 1,161 | 382 | 7.2% | 10/10 |
| 10 | 8 | 258.0 | 71.7 | 27.8% | 25.9% | 9,620 / 394 | 937 | 394 | 6.1% | 10/10 |
| 10 | 16 | 243.6 | 69.0 | 28.3% | 26.6% | 10,045 / 508 | 1,096 | 508 | 8.0% | 10/10 |

Reading (**unchanged**):

* **REBALANCE_PCT**: switching it off is clearly bad (merchant-ticks under 20% jump to 38.2% from 3.4%, A, 5 bots; 30.9% from 15.6%, C). Between 10 and 100 there is no robust winner: A, 10 bots improves at 100 (truncated 19.9% to 10.4%) but C gets worse (25.7% to 26.8%), and the improvement under A coincides with the potential profit per sale falling from 6,465 to 2,670. Keep 30 or move to 50 at most.
* **HOUSE_RECYCLE_PCT**: off versus on matters for liquidity (merchant-ticks under 20%: 7.2% at 0 versus 3.4-3.9% at 5-50, A, 5 bots; 34.4% versus 14.4-19.0%, C), but the fee pool is small so percentages from 5 to 50 are indistinguishable. Keep 10.
* **NPC_SHIP_UNITS**: more shipping does **not** reduce truncation (A, 5 bots: 30.1% at 0, 23.1% at 4, 30.4% at 16) and it competes the players' profit away: the median profit per trip falls from 3,297 (no shipping) to 1,231 (4) to 782 (8) fils. Under C the quantity hardly matters because the 25% budget binds first (Table 5C; C, 5 bots truncated 31.8%, 31.7%, 35.5%, 33.8% for 0, 4, 8, 16 units).

### 2.4 What the contract does with the unsold goods

**Table 1G. What happens to the unsold part of a truncated cargo (K = 3000 (spec-v1.2 baseline), 10-seed means, 240 ticks)**

| rules | bots | policy | trips | truncated sales | truncated share | units unsold per run | median profit/trip | mean profit/trip | total bot net worth at end (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 5 | unsold goods destroyed (reference) | 175.0 | 39.9 | 23.1% | 99 | 1,231 | 45 | 273,024 | 10/10 |
| A | 5 | keeps unsold goods | 65.9 | 41.7 | 42.8% | 242 | 4,931 | 4,983 | 491,542 | 10/10 |
| A | 10 | unsold goods destroyed (reference) | 318.8 | 62.4 | 19.9% | 137 | 768 | -294 | 422,739 | 10/10 |
| A | 10 | keeps unsold goods | 147.2 | 108.5 | 47.2% | 448 | 5,462 | 4,550 | 846,511 | 10/10 |
| C | 5 | unsold goods destroyed (reference) | 143.9 | 45.6 | 31.7% | 223 | 2,687 | 1,103 | 416,043 | 10/10 |
| C | 5 | keeps unsold goods | 45.8 | 44.6 | 50.7% | 327 | 5,722 | 6,697 | 546,612 | 10/10 |
| C | 10 | unsold goods destroyed (reference) | 296.1 | 76.1 | 25.7% | 230 | 1,161 | 382 | 642,285 | 10/10 |
| C | 10 | keeps unsold goods | 102.5 | 104.0 | 51.1% | 519 | 5,309 | 6,347 | 1,076,892 | 10/10 |

**Table 5D. Cash location at the end of 240 ticks, K = 3000 (spec-v1.2 baseline), 10-seed means (merchant seed capital 200,000; bots start with 50,000 each)**

| rules | bots | policy for the unsold part of a truncated cargo | trips | sum of merchant treasuries (fils) | lowest single treasury seen (mean) | merchant-ticks < 20% of seed | operator P&L (merchants + house - 200,000) | bots' cash (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|
| A (Appendix B) | 5 | unsold destroyed (reference) | 175 | 284,014 | 290 | 3.4% | 87,776 | 162,224 | 10/10 |
| A (Appendix B) | 5 | unsold kept by the player | 66 | 9,300 | 49 | 60.3% | -190,692 | 440,692 | 10/10 |
| A (Appendix B) | 10 | unsold destroyed (reference) | 319 | 397,254 | 30 | 3.8% | 202,761 | 297,239 | 10/10 |
| A (Appendix B) | 10 | unsold kept by the player | 147 | 6,230 | -46 | 58.1% | -193,761 | 693,761 | 10/10 |
| C (contract rules) | 5 | unsold destroyed (reference) | 144 | 90,692 | -81 | 15.6% | -107,243 | 357,243 | 10/10 |
| C (contract rules) | 5 | unsold kept by the player | 46 | 8,180 | 43 | 73.7% | -191,812 | 441,812 | 10/10 |
| C (contract rules) | 10 | unsold destroyed (reference) | 296 | 241,404 | 57 | 7.2% | 47,665 | 452,335 | 10/10 |
| C (contract rules) | 10 | unsold kept by the player | 102 | 4,248 | -10 | 71.1% | -195,742 | 695,742 | 10/10 |

Reading (**unchanged in direction, somewhat milder in size**): when the player keeps the goods (the contract behaviour), 43-51% of all sales are truncated (51-55% at K = 4000), only a third to under a half as many trips are completed (66 versus 175, 147 versus 319, 46 versus 144, 102 versus 296), the merchants end the 4 hours holding 4,248-9,300 fils of their 200,000 (58-74% of merchant-ticks under 20%), and the greedy players hold the cash (441k-696k) and unsellable goods. The market stalls rather than the merchants "staying broke for a while". The reference sim looks healthier only because destroying the unsold goods happens to leave the merchant's cash in place. Humans will behave less mechanically than these bots (they will buy more and sell elsewhere), but the direction, cash flowing from the four merchants to the players until the merchants cannot pay, follows from conservation of money and the arbitrage design, not from the bot's stupidity.

### 2.5 Q1 summary

* About a fifth to a third of sales are cut short at today's parameters, losing roughly a fifth of sale revenue; with contract semantics the economy also loses most of its liquidity within hours. K = 3000 does not change this.
* Treasury size, rebalancing, recycling and ship units are weak levers; what pays out the merchants is the arbitrage itself. The levers that matter are the ones that change how much cash the arbitrage can pull out of a single merchant (goods that can be shipped at all: see section 4 and Table 5C; price slope was the other lever and has now been moved to K = 3000 without relieving this).

## 3. Question 2 - wealth concentration and bankruptcies

Method: `python scripts/analysis/run_exp.py q2`. Faucet rule modelled as in the contract (D4): a bot whose net worth (cash plus goods at base, cargo included) is under 5,000 fils may claim +50,000 fils, cooldown 60 ticks (1 h). Money check is "start + injected". Gini uses the standard definition on final net worth (the maximum for n bots is (n-1)/n).

**Table 2A. Gini of final bot net worth and bots under 50 dinars, K = 3000 (spec-v1.2 baseline), 10-seed means**

| rules | ticks | bots | PLAY faucet rule | Gini of final net worth | bots < 50 dinars at the end | share of bot-ticks < 50 dinars | faucet claims per bot | money injected (USDC-equivalent per run) | mean bot net worth at end (fils) | conserved (start + injected) |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 240 (4 h) | 2 | no faucet | 0.20 | 0% | 0.0% | 0.0 | 0.0 | 96,704 | 10/10 |
| A | 240 (4 h) | 2 | faucet on | 0.20 | 0% | 0.0% | 0.0 | 0.0 | 96,704 | 10/10 |
| A | 240 (4 h) | 5 | no faucet | 0.37 | 4% | 1.7% | 0.0 | 0.0 | 54,605 | 10/10 |
| A | 240 (4 h) | 5 | faucet on | 0.34 | 0% | 0.0% | 0.1 | 1.5 | 55,602 | 10/10 |
| A | 240 (4 h) | 10 | no faucet | 0.49 | 5% | 2.0% | 0.0 | 0.0 | 42,274 | 10/10 |
| A | 240 (4 h) | 10 | faucet on | 0.44 | 0% | 0.1% | 0.1 | 6.5 | 48,054 | 10/10 |
| A | 1440 (24 h) | 2 | no faucet | 0.24 | 5% | 3.8% | 0.0 | 0.0 | 138,034 | 10/10 |
| A | 1440 (24 h) | 2 | faucet on | 0.17 | 0% | 0.0% | 0.2 | 2.0 | 140,909 | 10/10 |
| A | 1440 (24 h) | 5 | no faucet | 0.44 | 24% | 10.3% | 0.0 | 0.0 | 59,971 | 10/10 |
| A | 1440 (24 h) | 5 | faucet on | 0.30 | 0% | 0.0% | 0.4 | 9.5 | 69,615 | 10/10 |
| A | 1440 (24 h) | 10 | no faucet | 0.64 | 43% | 24.9% | 0.0 | 0.0 | 44,230 | 10/10 |
| A | 1440 (24 h) | 10 | faucet on | 0.39 | 0% | 0.1% | 0.7 | 37.0 | 52,295 | 10/10 |
| C | 240 (4 h) | 2 | no faucet | 0.14 | 0% | 0.0% | 0.0 | 0.0 | 121,032 | 10/10 |
| C | 240 (4 h) | 2 | faucet on | 0.14 | 0% | 0.0% | 0.0 | 0.0 | 121,032 | 10/10 |
| C | 240 (4 h) | 5 | no faucet | 0.27 | 2% | 0.4% | 0.0 | 0.0 | 83,209 | 10/10 |
| C | 240 (4 h) | 5 | faucet on | 0.25 | 0% | 0.0% | 0.0 | 1.0 | 84,957 | 10/10 |
| C | 240 (4 h) | 10 | no faucet | 0.45 | 7% | 3.1% | 0.0 | 0.0 | 64,229 | 10/10 |
| C | 240 (4 h) | 10 | faucet on | 0.40 | 0% | 0.0% | 0.1 | 5.0 | 70,009 | 10/10 |
| C | 1440 (24 h) | 2 | no faucet | 0.12 | 0% | 0.0% | 0.0 | 0.0 | 122,822 | 10/10 |
| C | 1440 (24 h) | 2 | faucet on | 0.12 | 0% | 0.0% | 0.0 | 0.0 | 122,822 | 10/10 |
| C | 1440 (24 h) | 5 | no faucet | 0.29 | 4% | 3.1% | 0.0 | 0.0 | 84,477 | 10/10 |
| C | 1440 (24 h) | 5 | faucet on | 0.25 | 0% | 0.0% | 0.1 | 2.5 | 89,319 | 10/10 |
| C | 1440 (24 h) | 10 | no faucet | 0.45 | 12% | 10.2% | 0.0 | 0.0 | 67,118 | 10/10 |
| C | 1440 (24 h) | 10 | faucet on | 0.37 | 0% | 0.0% | 0.6 | 27.5 | 89,775 | 10/10 |

**Table 2B. Per-seed final net worth (fils), Appendix B rules, K = 3000 (spec-v1.2 baseline), 5 bots, 240 ticks**

| rule | seed | final net worth, richest first | Gini | bots < 5,000 fils | claims |
|---|---|---|---|---|---|
| no faucet | 7 | 68,025, 64,404, 46,522, 30,924, 15,897 | 0.24 | 0 | 0 |
| no faucet | 11 | 96,321, 52,167, 36,274, 15,436, 11,250 | 0.39 | 0 | 0 |
| no faucet | 13 | 90,663, 48,924, 24,365, 14,776, 12,021 | 0.40 | 0 | 0 |
| faucet on | 7 | 68,025, 64,404, 46,522, 30,924, 15,897 | 0.24 | 0 | 0 |
| faucet on | 11 | 96,321, 52,167, 36,274, 15,436, 11,250 | 0.39 | 0 | 0 |
| faucet on | 13 | 90,663, 48,924, 24,365, 14,776, 12,021 | 0.40 | 0 | 0 |

Reading (**conclusion unchanged; numbers moved**):

* Concentration: Gini 0.20 (2 bots), 0.37 (5), 0.49 (10) after 4 h under A without a faucet (0.14, 0.27, 0.45 under C; 0.23, 0.35, 0.50 under A at K = 4000). Per seed (Table 2B) the richest bot ends with 4.3x-8.6x the net worth of the poorest (5.6x-12x at K = 4000).
* Bankruptcy: without a faucet, 5% of bots are under 50 dinars after 4 h with 10 bots (A; 11% at K = 4000) and **43% after 24 h** (A, 10 bots; 24.9% of all bot-time; 12% under C). With the faucet rule: 0% after 4 h and 0% after 24 h, Gini 0.64 to 0.39 (24 h, 10 bots, A).
* The faucet is cheap: 0.1 claims per bot in 4 h and 0.6-0.7 claims per bot in 24 h with 10 bots (27.5-37.0 USDC-equivalents of PLAY money across the 10 bots, which is play money by definition).
* Caveat: in set A many "bankruptcies" are cargo destroyed by truncated sales (section 2.4), so the figure is pessimistic for A and optimistic for contract semantics, where players keep goods and the problem is merchants' cash. The faucet rule as written (net worth, not cash) does what the plan asks; no change is proposed.

## 4. Question 3 - price clamp saturation and MULT_K_BP (**changed with K = 3000**)

Method: `python scripts/analysis/run_exp.py q3`. Share of time = share of (city, good, tick) samples at the end of each tick with the multiplier at its 13,500 (high) or 7,500 (low) clamp. K = 3000 is the spec baseline; K = 4000 is shown for the evidence behind the change.

**Table 3A. Where the multiplier clamps bind (analytic, from `mult_bp`)**

| MULT_K_BP | high clamp (13,500) when stock is at or below | low clamp (7,500) when stock is at or above | mult at stock 0 | mult at stock = 2 x target |
|---|---|---|---|---|
| 2000 | never (multiplier cannot reach 13,500) | never (above the 200% cap) | 12000 | 8000 |
| 3000 (spec-v1.2 baseline) | never (multiplier cannot reach 13,500) | 183.3% of target | 13000 | 7500 |
| 3500 | only at stock 0 (no effect) | 171.4% of target | 13500 | 7500 |
| 4000 (spec-v1.1, previous) | 12.5% of target | 162.5% of target | 13500 | 7500 |
| 6000 | 41.7% of target | 141.7% of target | 13500 | 7500 |
| 8000 | 56.2% of target | 131.2% of target | 13500 | 7500 |

**Table 3B-A. Share of time the multiplier sits at the HIGH clamp / LOW clamp, per good (all 4 cities pooled), Appendix B (`pnpm sim`), K = 3000 (spec-v1.2 baseline) and K = 4000 (spec-v1.1), 10-seed means**

| MULT_K_BP | bots | ticks | grain (high / low) | salt (high / low) | iron (high / low) | spice (high / low) | silk (high / low) | all goods at either clamp | conserved |
|---|---|---|---|---|---|---|---|---|---|
| 3000 (spec-v1.2 baseline) | 0 | 240 | 0% / 22% | 0% / 17% | 0% / 29% | 0% / 24% | 0% / 24% | 23% | 10/10 |
| 3000 (spec-v1.2 baseline) | 0 | 1440 | 0% / 24% | 0% / 45% | 0% / 46% | 0% / 25% | 0% / 25% | 33% | 10/10 |
| 3000 (spec-v1.2 baseline) | 2 | 240 | 0% / 4% | 0% / 2% | 0% / 15% | 0% / 24% | 0% / 24% | 14% | 10/10 |
| 3000 (spec-v1.2 baseline) | 2 | 1440 | 0% / 18% | 0% / 37% | 0% / 44% | 0% / 25% | 0% / 25% | 30% | 10/10 |
| 3000 (spec-v1.2 baseline) | 5 | 240 | 0% / 0% | 0% / 0% | 0% / 0% | 0% / 21% | 0% / 24% | 9% | 10/10 |
| 3000 (spec-v1.2 baseline) | 5 | 1440 | 0% / 1% | 0% / 2% | 0% / 3% | 0% / 22% | 0% / 25% | 11% | 10/10 |
| 3000 (spec-v1.2 baseline) | 10 | 240 | 0% / 0% | 0% / 0% | 0% / 0% | 0% / 12% | 0% / 21% | 7% | 10/10 |
| 3000 (spec-v1.2 baseline) | 10 | 1440 | 0% / 0% | 0% / 0% | 0% / 0% | 0% / 17% | 0% / 23% | 8% | 10/10 |
| 4000 (spec-v1.1, previous) | 0 | 240 | 35% / 23% | 15% / 27% | 25% / 34% | 66% / 24% | 66% / 24% | 68% | 10/10 |
| 4000 (spec-v1.1, previous) | 0 | 1440 | 68% / 25% | 44% / 46% | 46% / 47% | 73% / 25% | 74% / 25% | 95% | 10/10 |
| 4000 (spec-v1.1, previous) | 2 | 240 | 1% / 10% | 11% / 11% | 17% / 21% | 65% / 24% | 66% / 24% | 50% | 10/10 |
| 4000 (spec-v1.1, previous) | 2 | 1440 | 56% / 22% | 43% / 41% | 44% / 45% | 73% / 25% | 74% / 25% | 90% | 10/10 |
| 4000 (spec-v1.1, previous) | 5 | 240 | 0% / 0% | 0% / 0% | 0% / 0% | 60% / 24% | 64% / 24% | 34% | 10/10 |
| 4000 (spec-v1.1, previous) | 5 | 1440 | 5% / 1% | 3% / 2% | 5% / 3% | 71% / 25% | 72% / 25% | 42% | 10/10 |
| 4000 (spec-v1.1, previous) | 10 | 240 | 0% / 0% | 0% / 0% | 0% / 0% | 35% / 19% | 55% / 24% | 27% | 10/10 |
| 4000 (spec-v1.1, previous) | 10 | 1440 | 0% / 0% | 0% / 0% | 1% / 0% | 64% / 22% | 68% / 25% | 36% | 10/10 |

**Table 3B-C. Share of time the multiplier sits at the HIGH clamp / LOW clamp, per good (all 4 cities pooled), contract rules (D1-D3, D25 ship limits, warehouse cap), K = 3000 (spec-v1.2 baseline) and K = 4000 (spec-v1.1), 10-seed means**

| MULT_K_BP | bots | ticks | grain (high / low) | salt (high / low) | iron (high / low) | spice (high / low) | silk (high / low) | all goods at either clamp | conserved |
|---|---|---|---|---|---|---|---|---|---|
| 3000 (spec-v1.2 baseline) | 0 | 240 | 0% / 22% | 0% / 27% | 0% / 39% | 0% / 24% | 0% / 24% | 27% | 10/10 |
| 3000 (spec-v1.2 baseline) | 0 | 1440 | 0% / 24% | 0% / 46% | 0% / 48% | 0% / 25% | 0% / 25% | 34% | 10/10 |
| 3000 (spec-v1.2 baseline) | 2 | 240 | 0% / 8% | 0% / 26% | 0% / 33% | 0% / 24% | 0% / 24% | 23% | 10/10 |
| 3000 (spec-v1.2 baseline) | 2 | 1440 | 0% / 22% | 0% / 46% | 0% / 47% | 0% / 25% | 0% / 25% | 33% | 10/10 |
| 3000 (spec-v1.2 baseline) | 5 | 240 | 0% / 2% | 0% / 9% | 0% / 15% | 0% / 23% | 0% / 24% | 15% | 10/10 |
| 3000 (spec-v1.2 baseline) | 5 | 1440 | 0% / 20% | 0% / 42% | 0% / 43% | 0% / 25% | 0% / 25% | 31% | 10/10 |
| 3000 (spec-v1.2 baseline) | 10 | 240 | 0% / 0% | 0% / 1% | 0% / 3% | 0% / 22% | 0% / 23% | 10% | 10/10 |
| 3000 (spec-v1.2 baseline) | 10 | 1440 | 0% / 11% | 0% / 24% | 0% / 27% | 0% / 24% | 0% / 24% | 22% | 10/10 |
| 4000 (spec-v1.1, previous) | 0 | 240 | 35% / 23% | 26% / 38% | 42% / 42% | 66% / 24% | 67% / 24% | 77% | 10/10 |
| 4000 (spec-v1.1, previous) | 0 | 1440 | 68% / 25% | 46% / 48% | 49% / 49% | 74% / 25% | 74% / 25% | 96% | 10/10 |
| 4000 (spec-v1.1, previous) | 2 | 240 | 16% / 13% | 30% / 33% | 37% / 39% | 65% / 24% | 66% / 24% | 70% | 10/10 |
| 4000 (spec-v1.1, previous) | 2 | 1440 | 65% / 23% | 47% / 47% | 48% / 48% | 73% / 25% | 74% / 25% | 95% | 10/10 |
| 4000 (spec-v1.1, previous) | 5 | 240 | 5% / 4% | 15% / 15% | 25% / 24% | 64% / 24% | 66% / 24% | 53% | 10/10 |
| 4000 (spec-v1.1, previous) | 5 | 1440 | 57% / 20% | 42% / 42% | 46% / 45% | 73% / 25% | 73% / 25% | 90% | 10/10 |
| 4000 (spec-v1.1, previous) | 10 | 240 | 0% / 0% | 2% / 1% | 5% / 5% | 60% / 24% | 62% / 24% | 37% | 10/10 |
| 4000 (spec-v1.1, previous) | 10 | 1440 | 44% / 14% | 33% / 31% | 37% / 34% | 72% / 25% | 73% / 25% | 78% | 10/10 |

Reading (**changed**): a higher `MULT_K_BP` narrows the unclamped band, so it cannot reduce clamp time. At the old K = 4000 the band was 12.5%-162.5% of target stock, which for spice (target 40) is 5 to 65 units and for silk (target 30) 4 to 49 units; one stock unit moved silk's price by 1.33% of base and spice's by 1%. At the spec K = 3000 the multiplier ranges from 13,000 (stock 0) down to the 7,500 floor, the high clamp is never reached, and the low clamp binds only at 183.3% of target or more: spice (cap 80) at 74 units or more, silk (cap 60) at 55 units or more, so the clamped band is the last 7 and 6 units below the cap. One stock unit moves silk's price by 1.00% of base and spice's by 0.75% (Table 5-7). With bots in the world the high clamp share is 0% for every good (Table 3B), grain, salt and iron stay inside the band under A (0% at 5 and 10 bots, 4 h) and are at the low clamp 2-15% under C with 5 bots, and spice and silk sit at the low clamp 21-24% of the 4 hours with 5 bots (A: 21% and 24%), against 60-64% high plus 24% low at K = 4000. 24% of all (city, good, tick) samples is close to one city of four, consistent with the producing city accumulating stock at the cap (Table 5C: little silk or spice is shipped out); that reading is not separately tested. In a world with no players every good is at a clamp 23% of the first 4 hours (A; 27% under C) and 33% of 24 hours (34% under C), against 68%, 77%, 95% and 96% at K = 4000 (rows with 0 bots): the clamps are a property of the production/consumption design, not of bots, and K = 3000 removes most of them.

**Table 3C-A. MULT_K_BP sweep (3000 = spec-v1.2 baseline, 4000 = spec-v1.1), Appendix B (`pnpm sim`), 10-seed means, 240 ticks (clamps 7,500 / 13,500)**

| bots | MULT_K_BP | all goods at a clamp | spice+silk at a clamp | grain+salt+iron at a clamp | trips | median profit/trip (fils) | mean profit/trip (fils) | truncated sales | truncated share | merchant-ticks < 20% | mean bot net worth at end (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 2000 | 0% | 0% | 0% | 178.3 | 1,288 | 17 | 29.4 | 16.8% | 3.0% | 52,291 | 10/10 |
| 5 | 3000 (spec-v1.2 baseline) | 9% | 22% | 0% | 175.0 | 1,231 | 45 | 39.9 | 23.1% | 3.4% | 54,605 | 10/10 |
| 5 | 4000 (spec-v1.1, previous) | 34% | 86% | 0% | 181.6 | 1,432 | 76 | 42.2 | 23.5% | 2.5% | 56,095 | 10/10 |
| 5 | 6000 | 39% | 91% | 4% | 183.5 | 2,013 | 394 | 44.0 | 24.4% | 5.4% | 66,981 | 10/10 |
| 5 | 8000 | 48% | 93% | 17% | 168.8 | 2,861 | 801 | 44.8 | 26.8% | 14.3% | 78,679 | 10/10 |
| 10 | 2000 | 0% | 0% | 0% | 305.0 | 734 | -439 | 37.7 | 12.6% | 2.8% | 37,639 | 10/10 |
| 10 | 3000 (spec-v1.2 baseline) | 7% | 17% | 0% | 318.8 | 768 | -294 | 62.4 | 19.9% | 3.8% | 42,274 | 10/10 |
| 10 | 4000 (spec-v1.1, previous) | 27% | 66% | 0% | 334.9 | 857 | -24 | 66.6 | 20.3% | 3.5% | 51,009 | 10/10 |
| 10 | 6000 | 33% | 82% | 0% | 356.0 | 1,275 | 53 | 70.3 | 20.1% | 3.4% | 53,639 | 10/10 |
| 10 | 8000 | 36% | 86% | 3% | 354.5 | 1,630 | 304 | 76.1 | 21.8% | 4.5% | 60,977 | 10/10 |

**Table 3C-C. MULT_K_BP sweep (3000 = spec-v1.2 baseline, 4000 = spec-v1.1), contract rules (D1-D3, D25 ship limits, warehouse cap), 10-seed means, 240 ticks (clamps 7,500 / 13,500)**

| bots | MULT_K_BP | all goods at a clamp | spice+silk at a clamp | grain+salt+iron at a clamp | trips | median profit/trip (fils) | mean profit/trip (fils) | truncated sales | truncated share | merchant-ticks < 20% | mean bot net worth at end (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 2000 | 0% | 0% | 0% | 159.7 | 2,107 | 632 | 33.1 | 20.7% | 8.9% | 71,702 | 10/10 |
| 5 | 3000 (spec-v1.2 baseline) | 15% | 24% | 9% | 143.9 | 2,687 | 1,103 | 45.6 | 31.7% | 15.6% | 83,209 | 10/10 |
| 5 | 4000 (spec-v1.1, previous) | 53% | 89% | 29% | 130.4 | 2,722 | 1,074 | 46.0 | 35.3% | 19.0% | 79,638 | 10/10 |
| 5 | 6000 | 65% | 93% | 46% | 119.8 | 3,298 | 1,234 | 43.2 | 36.1% | 25.8% | 80,791 | 10/10 |
| 5 | 8000 | 73% | 95% | 58% | 102.6 | 3,987 | 1,530 | 39.3 | 38.3% | 29.8% | 81,971 | 10/10 |
| 10 | 2000 | 0% | 0% | 0% | 293.7 | 1,009 | 216 | 55.6 | 18.9% | 4.0% | 58,133 | 10/10 |
| 10 | 3000 (spec-v1.2 baseline) | 10% | 22% | 1% | 296.1 | 1,161 | 382 | 76.1 | 25.7% | 7.2% | 64,229 | 10/10 |
| 10 | 4000 (spec-v1.1, previous) | 37% | 85% | 4% | 307.7 | 1,378 | 452 | 80.6 | 26.2% | 8.4% | 66,408 | 10/10 |
| 10 | 6000 | 45% | 91% | 15% | 297.3 | 1,924 | 591 | 80.9 | 27.2% | 14.3% | 69,301 | 10/10 |
| 10 | 8000 | 49% | 94% | 20% | 311.2 | 2,249 | 583 | 95.4 | 30.7% | 15.4% | 71,038 | 10/10 |

**Table 3D. Clamp widening together with MULT_K_BP (3000 = spec-v1.2 baseline, 4000 = spec-v1.1), Appendix B rules, 10-seed means, 240 ticks**

| bots | MULT_K_BP | MULT_MIN_BP | MULT_MAX_BP | all goods at a clamp | spice+silk at a clamp | trips | median profit/trip | mean profit/trip | truncated sales | truncated share | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 3000 (spec-v1.2 baseline) | 7500 | 13500 | 9% | 22% | 175.0 | 1,231 | 45 | 39.9 | 23.1% | 10/10 |
| 5 | 3000 (spec-v1.2 baseline) | 6000 | 15000 | 0% | 0% | 171.2 | 1,375 | 269 | 38.5 | 22.8% | 10/10 |
| 5 | 4000 (spec-v1.1, previous) | 7500 | 13500 | 34% | 86% | 181.6 | 1,432 | 76 | 42.2 | 23.5% | 10/10 |
| 5 | 4000 (spec-v1.1, previous) | 6000 | 15000 | 8% | 16% | 150.7 | 1,490 | 663 | 43.0 | 28.9% | 10/10 |
| 5 | 6000 | 6000 | 15000 | 41% | 88% | 157.4 | 2,638 | 806 | 55.8 | 35.7% | 10/10 |
| 5 | 6000 | 5000 | 17000 | 13% | 23% | 144.0 | 2,157 | 915 | 60.6 | 42.6% | 10/10 |
| 5 | 8000 | 5000 | 17000 | 51% | 87% | 123.8 | 2,756 | 1,329 | 58.1 | 47.3% | 10/10 |
| 10 | 3000 (spec-v1.2 baseline) | 7500 | 13500 | 7% | 17% | 318.8 | 768 | -294 | 62.4 | 19.9% | 10/10 |
| 10 | 3000 (spec-v1.2 baseline) | 6000 | 15000 | 0% | 0% | 299.2 | 787 | -187 | 63.5 | 21.8% | 10/10 |
| 10 | 4000 (spec-v1.1, previous) | 7500 | 13500 | 27% | 66% | 334.9 | 857 | -24 | 66.6 | 20.3% | 10/10 |
| 10 | 4000 (spec-v1.1, previous) | 6000 | 15000 | 3% | 6% | 336.4 | 866 | 52 | 92.1 | 27.9% | 10/10 |
| 10 | 6000 | 6000 | 15000 | 32% | 79% | 332.9 | 1,535 | 291 | 104.4 | 31.8% | 10/10 |
| 10 | 6000 | 5000 | 17000 | 7% | 19% | 328.1 | 1,162 | 384 | 123.1 | 38.1% | 10/10 |
| 10 | 8000 | 5000 | 17000 | 38% | 80% | 292.2 | 1,367 | 567 | 114.5 | 39.7% | 10/10 |

**Table 3E. Spice and silk target stock scaled (cap = 2 x target), clamps unchanged, at K = 3000 (spec-v1.2 baseline) and K = 4000 (spec-v1.1), 10-seed means, 240 ticks**

| rules | MULT_K_BP | bots | spice / silk target stock | spice+silk at a clamp | trips | median profit/trip | mean profit/trip | truncated sales | truncated share | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 3000 (spec-v1.2 baseline) | 5 | spec (40 / 30) | 22% | 175.0 | 1,231 | 45 | 39.9 | 23.1% | 3.4% | 10/10 |
| A | 3000 (spec-v1.2 baseline) | 5 | x2 (80 / 60) | 22% | 175.2 | 1,220 | 123 | 37.1 | 21.5% | 3.7% | 10/10 |
| A | 3000 (spec-v1.2 baseline) | 5 | x3 (120 / 90) | 21% | 176.0 | 1,284 | 226 | 34.5 | 19.9% | 2.6% | 10/10 |
| A | 3000 (spec-v1.2 baseline) | 10 | spec (40 / 30) | 17% | 318.8 | 768 | -294 | 62.4 | 19.9% | 3.8% | 10/10 |
| A | 3000 (spec-v1.2 baseline) | 10 | x2 (80 / 60) | 18% | 316.1 | 800 | -202 | 51.7 | 16.7% | 3.4% | 10/10 |
| A | 3000 (spec-v1.2 baseline) | 10 | x3 (120 / 90) | 13% | 317.5 | 684 | -338 | 40.2 | 13.0% | 2.6% | 10/10 |
| A | 4000 (spec-v1.1, previous) | 5 | spec (40 / 30) | 86% | 181.6 | 1,432 | 76 | 42.2 | 23.5% | 2.5% | 10/10 |
| A | 4000 (spec-v1.1, previous) | 5 | x2 (80 / 60) | 74% | 167.3 | 1,642 | 443 | 37.6 | 22.8% | 7.7% | 10/10 |
| A | 4000 (spec-v1.1, previous) | 5 | x3 (120 / 90) | 61% | 177.0 | 1,435 | 205 | 35.3 | 20.2% | 3.8% | 10/10 |
| A | 4000 (spec-v1.1, previous) | 10 | spec (40 / 30) | 66% | 334.9 | 857 | -24 | 66.6 | 20.3% | 3.5% | 10/10 |
| A | 4000 (spec-v1.1, previous) | 10 | x2 (80 / 60) | 44% | 340.7 | 914 | -37 | 60.5 | 18.1% | 3.2% | 10/10 |
| A | 4000 (spec-v1.1, previous) | 10 | x3 (120 / 90) | 28% | 341.1 | 1,026 | -146 | 51.7 | 15.5% | 2.8% | 10/10 |
| C | 3000 (spec-v1.2 baseline) | 5 | spec (40 / 30) | 24% | 143.9 | 2,687 | 1,103 | 45.6 | 31.7% | 15.6% | 10/10 |
| C | 3000 (spec-v1.2 baseline) | 5 | x2 (80 / 60) | 23% | 131.9 | 2,237 | 1,019 | 38.5 | 29.2% | 18.7% | 10/10 |
| C | 3000 (spec-v1.2 baseline) | 5 | x3 (120 / 90) | 22% | 132.9 | 2,222 | 1,040 | 37.6 | 28.3% | 18.6% | 10/10 |
| C | 3000 (spec-v1.2 baseline) | 10 | spec (40 / 30) | 22% | 296.1 | 1,161 | 382 | 76.1 | 25.7% | 7.2% | 10/10 |
| C | 3000 (spec-v1.2 baseline) | 10 | x2 (80 / 60) | 22% | 298.5 | 1,227 | 358 | 70.4 | 23.6% | 7.0% | 10/10 |
| C | 3000 (spec-v1.2 baseline) | 10 | x3 (120 / 90) | 21% | 310.2 | 1,301 | 302 | 68.7 | 22.1% | 5.5% | 10/10 |
| C | 4000 (spec-v1.1, previous) | 5 | spec (40 / 30) | 89% | 130.4 | 2,722 | 1,074 | 46.0 | 35.3% | 19.0% | 10/10 |
| C | 4000 (spec-v1.1, previous) | 5 | x2 (80 / 60) | 78% | 135.5 | 2,714 | 1,074 | 42.6 | 31.4% | 18.8% | 10/10 |
| C | 4000 (spec-v1.1, previous) | 5 | x3 (120 / 90) | 67% | 137.1 | 2,926 | 1,167 | 43.7 | 31.9% | 16.5% | 10/10 |
| C | 4000 (spec-v1.1, previous) | 10 | spec (40 / 30) | 85% | 307.7 | 1,378 | 452 | 80.6 | 26.2% | 8.4% | 10/10 |
| C | 4000 (spec-v1.1, previous) | 10 | x2 (80 / 60) | 73% | 301.8 | 1,349 | 419 | 75.4 | 25.0% | 8.7% | 10/10 |
| C | 4000 (spec-v1.1, previous) | 10 | x3 (120 / 90) | 59% | 312.1 | 1,330 | 367 | 76.3 | 24.4% | 7.5% | 10/10 |

Reading:

* **K = 6000 / 8000** (unchanged, evidence for not going the other way): median profit per trip rises (A, 5 bots: 1,432 to 2,013 to 2,861 fils; C: 2,722 to 3,298 to 3,987) but clamp time rises (spice+silk 86% to 91% to 93%; grain+salt+iron 0% to 4% to 17%, A), truncation rises (23.5% to 24.4% to 26.8% A; 35.3% to 36.1% to 38.3% C), merchants go dry more often (merchant-ticks under 20%: 2.5% to 5.4% to 14.3%, A; 19.0% to 25.8% to 29.8%, C) and trips fall (C: 130 to 120 to 103). More profit comes out of the same four treasuries, faster.
* **K = 3000 versus 4000** (the evidence for the adopted change): spice+silk at a clamp 86% to 22% (A, 5 bots), 66% to 17% (A, 10 bots), 89% to 24% (C, 5 bots) and 85% to 22% (C, 10 bots). Median profit per trip 1,231 versus 1,432 (A, 5 bots), 768 versus 857 (A, 10 bots), 2,687 versus 2,722 (C, 5 bots), 1,161 versus 1,378 (C, 10 bots); fewer dry merchants under C (15.6% versus 19.0% with 5 bots, 7.2% versus 8.4% with 10). Cost: under A with 10 bots the mean profit per trip is -294 fils instead of -24, i.e. a greedy bot swarm loses slightly more per trip when the price signal is weaker. K = 2000 removes clamping entirely but 10 bots then lose money on average (mean -439 fils per trip, A) and under C the median profit per trip falls to 2,107 (5 bots) and 1,009 (10 bots).
* **Wider clamps** (Table 3D). At K = 4000, 6,000/15,000: clamp time 34% to 8% (A, 5 bots) and mean profit 76 to 663, but truncation rises (23.5% to 28.9%) and trips fall (182 to 151). At K = 3000 the high clamp is unreachable anyway, so only the floor matters: lowering `MULT_MIN_BP` to 6,000 takes the remaining clamp time to 0% (A, 5 bots: 9% to 0%) with 171.2 trips instead of 175.0, truncated share 22.8% instead of 23.1% and mean profit per trip 269 instead of 45; with 10 bots trips fall 318.8 to 299.2 and truncation rises 19.9% to 21.8%. The effect is small and mixed; it is not proposed.
* **Larger spice/silk targets** (Table 3E): **changed**: at K = 4000 x2 gave 86% to 74% (A, 5 bots) and 66% to 44% (A, 10 bots) at a clamp, x3 61% and 28%; at K = 3000 spice+silk are at a clamp 22%, 22%, 21% (A, 5 bots; spec, x2, x3) and 24%, 23%, 22% (C, 5 bots), so the extra targets buy nothing while still costing spec changes to the goods table.

## 5. Question 4 - the first profitable trade

Three different questions are mixed in "first profitable trade in under a minute": when can the player start, when does profit appear, and how large is it. Method: `python scripts/analysis/run_q4.py`. Expected profit (EP) for a 500-dinar newcomer = one journey chosen with full knowledge of the current prices and treasuries, exact integer prices, 1% fees, ambush risk, guards chosen optimally (cost 2% of the cargo base value each, truncated), unsold goods valued at 0. EP is therefore an upper bound for a player who acts first; Table 4F is the realised outcome of a competing bot. All tables except 4C and 4E run at K = 3000 (4C and 4E are analytic and do not depend on K).

**Table 4E. Journey times and ambush odds (game data); the shortest possible journey is 180 s, so a REALISED profit cannot appear in 60 s**

| route | travel time | sim ticks (ceil) | ambush risk, no guards | as % | P(at least one ambush in 3 trips) |
|---|---|---|---|---|---|
| bandar-shahr | 180 s | 3 ticks | 800 bp | 8% | 22.1% |
| shahr-dasht | 240 s | 4 ticks | 1200 bp | 12% | 31.9% |
| dasht-madan | 300 s | 5 ticks | 1500 bp | 15% | 38.6% |
| madan-bandar | 360 s | 6 ticks | 2000 bp | 20% | 48.8% |
| bandar-dasht | 270 s | 5 ticks | 1000 bp | 10% | 27.1% |
| shahr-madan | 330 s | 6 ticks | 1800 bp | 18% | 44.9% |

**Time to first profit.** The shortest journey takes 180 s, so a realised profit cannot appear in 60 s on any route. What can happen inside the first minute is the purchase and departure.

**Table 4A. Fresh world (no players, nothing traded yet), K = 3000 (spec-v1.2 baseline): first tick at which a positive expected-profit trade exists for a 500-dinar player (0 guards)**

| rules | first positive trade, shortest route bandar-shahr | first positive trade, any route | best EP at 0 min: short / any (fils) | 10 min | 30 min | 60 min | 120 min |
|---|---|---|---|---|---|---|---|
| A | tick 3 (3 min): 805 fils on bandar>shahr 3 spice | tick 3 (3 min): 805 fils on bandar>shahr 3 spice | -99 / -99 | 3,320 / 14,889 | 5,374 / 24,012 | 9,367 / 26,293 | 9,611 / 26,293 |
| C | tick 3 (3 min): 805 fils on bandar>shahr 3 spice | tick 3 (3 min): 805 fils on bandar>shahr 3 spice | -99 / -99 | 6,982 / 14,889 | 5,374 / 25,723 | 10,574 / 26,293 | 10,150 / 26,293 |
| A, no NPC | tick 3 (3 min): 805 fils on bandar>shahr 3 spice | tick 3 (3 min): 805 fils on bandar>shahr 3 spice | -99 / -99 | 10,729 / 10,729 | 17,529 / 17,529 | 17,529 / 17,529 | 17,529 / 17,529 |

**Table 4F. Realised first journey of a newcomer (K = 3000 (spec-v1.2 baseline); greedy bot with 50,000 fils joining at minute J into a world of bots-1 active bots; 10 seeds; sim ticks = minutes)**

| rules | bots in world (incl. newcomer) | joins at minute J | newcomers that completed a first journey within 120 min | first journey profitable | median first-journey profit (fils, % of capital) | mean first-journey profit (fils) | median minutes join to first purchase | median minutes join to first arrival | newcomers with any profitable arrival | median minutes join to first profitable arrival |
|---|---|---|---|---|---|---|---|---|---|---|
| A (Appendix B) | 5 | 0 | 10/10 | 40% | -3,156 (-6.3%) | -9,559 | 8 min | 11 min | 10/10 | 15 min |
| A (Appendix B) | 5 | 60 | 10/10 | 80% | 3,961 (7.9%) | 1,363 | 0 min | 6 min | 10/10 | 8 min |
| A (Appendix B) | 5 | 120 | 10/10 | 80% | 1,912 (3.8%) | 339 | 0 min | 6 min | 10/10 | 6 min |
| A (Appendix B) | 5 | 180 | 10/10 | 70% | 3,800 (7.6%) | -1,474 | 0 min | 5 min | 10/10 | 9 min |
| A (Appendix B) | 10 | 0 | 10/10 | 30% | -16,596 (-33.2%) | -12,332 | 8 min | 11 min | 10/10 | 22 min |
| A (Appendix B) | 10 | 60 | 10/10 | 60% | 8,955 (17.9%) | -2,287 | 5 min | 8 min | 10/10 | 11 min |
| A (Appendix B) | 10 | 120 | 10/10 | 70% | 13,042 (26.1%) | 949 | 5 min | 8 min | 10/10 | 9 min |
| A (Appendix B) | 10 | 180 | 10/10 | 60% | 8,955 (17.9%) | 4,237 | 5 min | 8 min | 10/10 | 9 min |
| C (contract rules) | 5 | 0 | 10/10 | 80% | 5,724 (11.4%) | 839 | 8 min | 13 min | 10/10 | 14 min |
| C (contract rules) | 5 | 60 | 10/10 | 60% | 872 (1.7%) | 941 | 0 min | 5 min | 10/10 | 6 min |
| C (contract rules) | 5 | 120 | 10/10 | 50% | 4,448 (8.9%) | 2,441 | 0 min | 6 min | 10/10 | 12 min |
| C (contract rules) | 5 | 180 | 10/10 | 80% | 11,242 (22.5%) | 6,978 | 5 min | 11 min | 10/10 | 11 min |
| C (contract rules) | 10 | 0 | 10/10 | 50% | 3,093 (6.2%) | -8,140 | 8 min | 11 min | 10/10 | 17 min |
| C (contract rules) | 10 | 60 | 10/10 | 80% | 15,605 (31.2%) | 7,612 | 5 min | 8 min | 10/10 | 9 min |
| C (contract rules) | 10 | 120 | 10/10 | 70% | 5,678 (11.4%) | 205 | 3 min | 6 min | 10/10 | 9 min |
| C (contract rules) | 10 | 180 | 10/10 | 70% | 8,955 (17.9%) | 1,430 | 0 min | 5 min | 10/10 | 8 min |
| C + unsold goods kept | 5 | 0 | 10/10 | 100% | 4,693 (9.4%) | 4,632 | 8 min | 13 min | 10/10 | 13 min |
| C + unsold goods kept | 5 | 60 | 8/10 | 100% | 8,955 (17.9%) | 7,986 | 3 min | 8 min | 8/10 | 8 min |
| C + unsold goods kept | 5 | 120 | 0/10 | 0% | n/a | n/a | n/a | n/a | 0/10 | n/a |
| C + unsold goods kept | 5 | 180 | 0/10 | 0% | n/a | n/a | n/a | n/a | 0/10 | n/a |
| C + unsold goods kept | 10 | 0 | 10/10 | 100% | 4,034 (8.1%) | 3,435 | 8 min | 11 min | 10/10 | 11 min |
| C + unsold goods kept | 10 | 60 | 5/10 | 100% | 13,121 (26.2%) | 12,721 | 0 min | 5 min | 5/10 | 5 min |
| C + unsold goods kept | 10 | 120 | 0/10 | 0% | n/a | n/a | n/a | n/a | 0/10 | n/a |
| C + unsold goods kept | 10 | 180 | 0/10 | 0% | n/a | n/a | n/a | n/a | 0/10 | n/a |

Reading (**numbers changed slightly, conclusion unchanged**): in a running world (joins at minute 60 to 180) a newcomer's median first purchase is 0 to 5 minutes after joining (0 in 6 of the 12 A/C rows), its first arrival 5-11 minutes after joining and its first profitable arrival after a median 6-12 minutes; 50-80% of first journeys are profitable under A and C (40-80% at K = 4000), with a median first-journey profit between 872 and 15,605 fils (1.7% to 31.2% of capital). In a brand-new world (J = 0) nothing is profitable at first: all prices equal base and a round trip costs the 8% spread plus 2% fees (EP -99 fils at minute 0); the first positive EP appears after 3 minutes of world time (805 fils, 3 spice; at K = 4000 it was minute 2, 266 fils) and is small, 3,320-10,729 fils (6.6-21.5%) on the short route at 10 minutes. Newcomers in the fresh world buy after a median 8 minutes and are profitable after 14-22. Under the contract semantics with unsold goods kept (last rows) the stalled market means late newcomers often never complete a journey in the next 2 hours (Table 4F: 0/10 completed at J = 120 and 180 with 5 and 10 bots, and 8/10 and 5/10 at J = 60), a consequence of the liquidity problem in section 2.4.

**Typical profit per trip.**

**Table 4B. Established worlds (K = 3000 (spec-v1.2 baseline); state after 60, 80, ..., 240 ticks; seeds 7, 11, 13 pooled): best expected profit of one journey for a 500-dinar newcomer (guards chosen optimally)**

| rules | bots in world | snapshots | short route: positive EP | short route: median EP (fils, % of 50,000) | short route: mean EP | any route: positive EP | any route: median EP (% of capital) | any route: mean EP | most common best route | snapshots where >= 1 guard is optimal |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 0 | 30 | 100% | 9,611 (19.2%) | 9,696 | 100% | 26,293 (52.6%) | 26,293 | bandar>madan (30/30) | 0% |
| A | 2 | 30 | 83% | 8,955 (17.9%) | 8,234 | 100% | 26,293 (52.6%) | 21,322 | bandar>madan (20/30) | 3% |
| A | 5 | 30 | 100% | 10,574 (21.1%) | 11,729 | 100% | 18,031 (36.1%) | 20,111 | bandar>madan (15/30) | 10% |
| A | 10 | 30 | 100% | 16,769 (33.5%) | 15,407 | 100% | 24,403 (48.8%) | 22,929 | bandar>madan (13/30) | 0% |
| C | 0 | 30 | 100% | 11,514 (23.0%) | 11,002 | 100% | 26,293 (52.6%) | 26,293 | bandar>madan (30/30) | 0% |
| C | 2 | 30 | 67% | 5,537 (11.1%) | 6,077 | 100% | 17,529 (35.1%) | 16,517 | bandar>madan (19/30) | 10% |
| C | 5 | 30 | 90% | 5,374 (10.7%) | 6,495 | 100% | 17,529 (35.1%) | 15,818 | bandar>madan (15/30) | 10% |
| C | 10 | 30 | 93% | 15,861 (31.7%) | 13,512 | 100% | 25,153 (50.3%) | 21,612 | bandar>dasht (12/30) | 3% |

Reading (**changed a little**): on the cheapest route (bandar-shahr, 180 s, 8% risk) the best available single journey is worth a median 5,374-16,769 fils (10.7-33.5% of the 50,000-fils capital) in all 8 world types (positive in 67-100% of snapshots), mostly spice/silk bought where it is cheap and sold dear; over all routes 17,529-26,293 fils (35-53%) and bandar-madan is usually best (bandar-dasht for C with 10 bots). That is the hindsight upper bound for the first mover; competing bots realise a median 1,231-2,687 fils per trip (2.5-5.4% of capital, Table 1B, 5 bots) and a newcomer's median first journey, joining at minute 60 or later, is between 872 and 15,605 fils (1.7% to 31.2%) (Table 4F). Plan the UX around about 5% of capital per 3-6 minute trip as the sober figure and 10-30% as what a first-mover on the best lane can see.

**Table 4D. Ambush-immune cargo (at most 3 units of each good, floor(30% x 3) = 0) vs the best single-good cargo, K = 3000 (spec-v1.2 baseline), mean expected profit, snapshots at 60/120/180/240 ticks, seeds 7, 11, 13**

| rules | bots | snapshots | short route: best single good (guards optimal) | short route: best immune bundle | any route: best single good | any route: best immune bundle |
|---|---|---|---|---|---|---|
| A | 0 | 12 | 10,123 (20.2%) | 7,164 (14.3%) | 26,293 (52.6%) | 26,293 (52.6%) |
| A | 5 | 12 | 12,043 (24.1%) | 12,526 (25.1%) | 19,281 (38.6%) | 21,472 (42.9%) |
| C | 0 | 12 | 10,938 (21.9%) | 9,764 (19.5%) | 26,293 (52.6%) | 26,293 (52.6%) |
| C | 5 | 12 | 5,770 (11.5%) | 5,866 (11.7%) | 14,231 (28.5%) | 15,176 (30.4%) |

**Guards versus ambush risk.**

**Table 4C. Marginal value of each guard (40-unit cargo, loss 12 of 40 units = 30%): risk after the guard, expected saving vs the 2% price**

| route | seconds | base risk (bp) | guard 1 | guard 2 | guard 3 |
|---|---|---|---|---|---|
| bandar-shahr | 180 | 800 | 520 bp; saves 0.84% of cargo vs costs 2.00% | 338 bp; saves 0.55% of cargo vs costs 2.00% | 219 bp; saves 0.36% of cargo vs costs 2.00% |
| shahr-dasht | 240 | 1200 | 780 bp; saves 1.26% of cargo vs costs 2.00% | 507 bp; saves 0.82% of cargo vs costs 2.00% | 329 bp; saves 0.53% of cargo vs costs 2.00% |
| dasht-madan | 300 | 1500 | 975 bp; saves 1.57% of cargo vs costs 2.00% | 633 bp; saves 1.03% of cargo vs costs 2.00% | 411 bp; saves 0.67% of cargo vs costs 2.00% |
| madan-bandar | 360 | 2000 | 1300 bp; saves 2.10% of cargo vs costs 2.00% | 845 bp; saves 1.36% of cargo vs costs 2.00% | 549 bp; saves 0.89% of cargo vs costs 2.00% |
| bandar-dasht | 270 | 1000 | 650 bp; saves 1.05% of cargo vs costs 2.00% | 422 bp; saves 0.68% of cargo vs costs 2.00% | 274 bp; saves 0.44% of cargo vs costs 2.00% |
| shahr-madan | 330 | 1800 | 1170 bp; saves 1.89% of cargo vs costs 2.00% | 760 bp; saves 1.23% of cargo vs costs 2.00% | 494 bp; saves 0.80% of cargo vs costs 2.00% |

A guard costs 2% of the cargo base value (e.g. 800 fils for 40 grain) and removes, in expectation, 0.84% of the cargo on the shortest route; on five of six routes every guard is a pure cost, and only the first guard on madan-bandar (2.10% saved versus 2.00%) is marginally positive (unchanged: analytic). The optimiser chose at least one guard in 0-10% of snapshots (Table 4B, last column; 0-20% at K = 4000). The first trip has an 8% ambush chance on the shortest route and a 22.1% chance of at least one ambush in the first three trips; with the floor rule an ambush destroys 12 of 40 units (30%) but nothing at all for a good carried in lots of 3 or fewer (Table 5-5), which is why the best "immune" bundle (Table 4D) earns about the same as the best single-good cargo (5 bots: 12,526 versus 12,043 on the short route under A, 5,866 versus 5,770 under C). For a new player the right advice is to skip guards, and guards as designed give a risk-averse player almost nothing for 2%.

## 6. Question 5 - exploit loops and conservation

Method: `packages/shared/node_modules/.bin/tsx scripts/analysis/exploits.ts` (exhaustive, uses the real `tradeCost()`, K = 3000), `python scripts/analysis/run_q5.py`.

**Round trips and closed loops against one merchant.**

| check | cases | profitable cases | best net result (fils) | where | smallest loss as share of outlay | where |
|---|---|---|---|---|---|---|
| buy q then sell q back, and sell q then buy q back, same merchant; 5 goods x every stock 0..cap x q 1..40 x spread {400, 800, 2000} x bias {-1500, 0, +1500} | 635,400 | 0 | -35 | grain sell-then-buy stock=358 q=1 spread=400 bias=-1500 | 4.56% | silk sell-then-buy stock=54 q=1 spread=400 bias=0 |

| check | closed loops tested | profitable | best net result (fils) | where |
|---|---|---|---|---|
| sequences of 2-4 trades (sizes 1, 2, 3, 5, 10, 20, 40) that return the player's inventory to its start, spread 400, 18-20 start stocks per good incl. the clamp edges of both the K = 3000 and the K = 4000 curve, both from empty hands and from a full 40-unit hold | 30,917 | 0 | -44 | grain start=366 B1,S1 |

No loop makes money; the best is a loss of 35 fils (grain, 1 unit, spread 400, bias -1500) for a round trip and 44 fils for a closed loop (loops tested: 30,917, was 25,952 because the start stocks now also cover the K = 3000 clamp edge), and the smallest loss is 4.56% of the outlay, i.e. the spread and fees always dominate the integer rounding and the midpoint-pricing asymmetry for odd quantities (one stock unit moves a price by 0.10-1.00% of base, Table 5-7, much less than the 6% a round trip costs at the minimum spread). **Unchanged**: no profitable loop.

**Splitting a trade.**

| check | cases (good x start stock) | split better in | largest edge (fils) | where | largest edge as share of the trade | where |
|---|---|---|---|---|---|---|
| buy 40 as 40 one-unit buys instead of one 40-unit buy (spread 800) | 785 | 731 | 4,222 | silk stock=45 | 0.53% | silk stock=55 |
| sell 40 as 40 one-unit sells instead of one 40-unit sell (spread 800) | 785 | 785 | 5,720 | silk stock=20 | 1.77% | salt stock=200 |

**Changed with K = 3000.** Splitting still wins in most cases, up to 0.53% cheaper on buys (silk, stock 55) and up to 1.77% better on sells (salt, stock 200; 5,720 fils at silk stock 20), against 0.83% and 3.91% at K = 4000. At K = 4000 the previous version attributed the edge to the clamps; at K = 3000 the high clamp cannot be reached and the edge persists in 731 of 785 buy cases and all 785 sell cases, so it follows from the integer midpoint rule instead (a 40-unit trade is priced at stock +/- 20, while 40 one-unit trades walk through an average of 19.5 units; that arithmetic is the likely cause and was not separately tested). It is not a loop (it improves one leg of an arbitrage by at most 1.77%) but it costs the relayer 40 transactions per trade. If transaction cost matters, `MAX_QTY_PER_TRADE` or a per-player rate limit bounds it.

**Merchant policy drift (D24).**

| merchant policy path (start bias -1500; player buys 10 at tick 0, sells 10 after k ticks, no travel) | grain | salt | iron | spice | silk |
|---|---|---|---|---|---|
| bias +300/tick, spread fixed 400 | 2 | 2 | 2 | 2 | 2 |
| bias +300/tick, spread fixed 800 | 3 | 4 | 3 | 3 | 3 |
| bias +300/tick and spread -300/tick from 800 (floor 400) | 3 | 3 | 3 | 3 | 3 |

(cells: smallest k, in ticks = minutes, at which the hold-and-sell is profitable after both 1% fees)

D24 allows 300 bp per tick. A merchant (the AI) that walks its bias upward at that rate while keeping the spread low lets any player in the city buy now and sell 2 minutes later at a profit, without travelling; with spread 800 it takes 3 ticks (4 for salt at K = 3000). The AI baseline does not do this by design, but nothing in the contract forbids it, and a persona that "raises prices when stock is low" will do it gradually. **Unchanged.**

**Ambush rounding and stall fee.**

| units of a good in the cargo | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lost, contract (floor 30%) | 0 | 0 | 0 | 1 | 1 | 1 | 2 | 2 | 2 | 3 | 3 | 3 |
| lost, Appendix B / `sim.ts` (ceil 30%) | 1 | 1 | 1 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |

A cargo of 3 units of each of the 5 goods (15 units) has a base value of 115,500 fils and loses nothing in an ambush under the contract rule.

| check | result |
|---|---|
| lowest effective stall fee rate over prices 1..200,000 fils | 2.00% (first reached at price 50 fils) |
| highest effective rate | 100% (price 1 fil: minimum fee of 1 fils) |
| splitting a sale into 2, 3, 5 or 10 stalls (prices 2..5,000 fils) | 0 of 19,996 cases had a lower total fee |

The stall fee `ceil(2% x price)`, minimum 1 fils, cannot be evaded by splitting (0 of 19,996 cases cheaper) and is never below 2%. Two accounts can still move cash between them at the 2% price (the seller pays): with D4 (faucet when net worth is under 5,000 fils) and D5 (seller pays) one account that tops up 50,000 fils from the faucet each hour can buy a 1-grain stall priced at 49,990 fils from a second account, ending below the 5,000-fils threshold again and handing the other account 48,990 fils (fee `ceil(2% x 49,990) = 1,000` fils) per hour. That arithmetic follows from the rules, it was not simulated. In PLAY it only distorts the leaderboard; in LIVE the faucet is disabled. **Unchanged.**

**Arbitrage between two cities "forever" and operator exposure.** Players' profit comes only from the merchants' cash, because production and consumption create and destroy goods, not money. So an unbounded loop cannot exist, and the question is how much of the merchants' pool a strong player can take. Goods created per tick are valued at 143,500 fils at base prices (861 USDC-equivalent per hour), which is why arbitrage opportunities keep reappearing; the cash pool that pays for them is 200,000 fils.

**Table 5B. Goods created per tick at base price (the only thing that is not conserved; money is)**

| good | produced / tick (world) | consumed / tick (world) | base (fils) | value created / tick (fils) |
|---|---|---|---|---|
| grain | 8 | 8 | 1,000 | 8,000 |
| salt | 5 | 5 | 1,500 | 7,500 |
| iron | 5 | 5 | 4,000 | 20,000 |
| spice | 4 | 4 | 12,000 | 48,000 |
| silk | 3 | 3 | 20,000 | 60,000 |
| all goods |  |  |  | 143,500 fils/tick = 861 USDC-equivalent per hour of goods created |

**Table 5A. Operator exposure (K = 3000 (spec-v1.2 baseline)): merchants + house cash vs their 200,000-fils seed (10 seeds). Whales hold the 200,000-fils LIVE deposit cap in cash**

| rules | players x starting cash (fils) | ticks | operator P&L at end (mean, fils) | worst operator P&L over time (mean of seeds) | worst single seed (fils) | worst seed as % of the 200,000 seed capital | players' cash gain at end (mean, fils) | money conserved |
|---|---|---|---|---|---|---|---|---|
| A (Appendix B) | 1 x 200,000 | 240 | -34,843 | -73,968 | -119,723 | 60% | 34,843 | 10/10 |
| A (Appendix B) | 1 x 200,000 | 1440 | -161,467 | -161,467 | -168,305 | 84% | 161,467 | 10/10 |
| A (Appendix B) | 2 x 200,000 | 240 | 32,729 | -15,189 | -45,790 | 23% | -32,729 | 10/10 |
| A (Appendix B) | 2 x 200,000 | 1440 | -48,230 | -96,921 | -182,221 | 91% | 48,230 | 10/10 |
| A (Appendix B) | 4 x 200,000 | 240 | 147,512 | -10,416 | -51,406 | 26% | -147,512 | 10/10 |
| A (Appendix B) | 4 x 200,000 | 1440 | 280,552 | -23,674 | -72,556 | 36% | -280,552 | 10/10 |
| A (Appendix B) | 5 x 50,000 | 240 | 87,776 | -55,639 | -115,057 | 58% | -87,776 | 10/10 |
| A (Appendix B) | 5 x 50,000 | 1440 | 38,446 | -119,137 | -186,280 | 93% | -38,446 | 10/10 |
| A (Appendix B) | 10 x 50,000 | 240 | 202,761 | -7,544 | -50,116 | 25% | -202,761 | 10/10 |
| A (Appendix B) | 10 x 50,000 | 1440 | 145,846 | -61,475 | -105,594 | 53% | -145,846 | 10/10 |
| C (contract rules) | 1 x 200,000 | 240 | -41,084 | -59,305 | -98,069 | 49% | 41,084 | 10/10 |
| C (contract rules) | 1 x 200,000 | 1440 | -139,464 | -139,464 | -143,127 | 72% | 139,464 | 10/10 |
| C (contract rules) | 2 x 200,000 | 240 | 14,956 | -16,629 | -40,981 | 20% | -14,956 | 10/10 |
| C (contract rules) | 2 x 200,000 | 1440 | -73,095 | -102,043 | -139,260 | 70% | 73,095 | 10/10 |
| C (contract rules) | 4 x 200,000 | 240 | 78,108 | -7,299 | -17,680 | 9% | -78,108 | 10/10 |
| C (contract rules) | 4 x 200,000 | 1440 | -43,377 | -67,424 | -118,439 | 59% | 43,377 | 10/10 |
| C (contract rules) | 5 x 50,000 | 240 | -107,243 | -156,165 | -177,147 | 89% | 107,243 | 10/10 |
| C (contract rules) | 5 x 50,000 | 1440 | -172,384 | -173,780 | -189,650 | 95% | 172,384 | 10/10 |
| C (contract rules) | 10 x 50,000 | 240 | 47,665 | -101,830 | -169,187 | 85% | -47,665 | 10/10 |
| C (contract rules) | 10 x 50,000 | 1440 | -161,778 | -184,088 | -192,019 | 96% | 161,778 | 10/10 |

Reading (**unchanged**): in every run of Table 5A the operator's P&L stayed above -200,000 fils (worst observed -192,019, 96% of the seed, 10 players x 50,000 fils for 24 h under C), which confirms the plan's statement that the operator's maximum loss equals the merchants' treasuries. It also shows the cap is not a theoretical limit: one 20-USDC whale alone takes a mean 139,464-161,467 fils (70-81%) in 24 hours, and 5-10 ordinary greedy players take about 162,000-172,000 (C, 24 h). Operator risk is a practical number, not a remote one.

**Money conservation.** Every run asserts `merchants + house + bots' cash == start (+ faucet injections)` after every tick. Results: 2,164 runs of `run_exp.py` (q1 1,018, q2 246, q3 900), 279 of `run_q4.py`, 340 of `run_q5.py`, 62 of `validate.py`: 2,845 variant runs in all, all conserved. The 25 TypeScript `runSim()` configurations checked in validation also conserved on every tick. The tables' "conserved" columns show the per-row count.

**Table 5C. NPC shipping per good, K = 3000 (spec-v1.2 baseline), 5 bots, 240 ticks, 10-seed means: units shipped per run / ticks where the gap test passed but the receiving treasury (A) or its 25% budget (C) could not pay**

| rules | treasury per merchant (fils) | grain | salt | iron | spice | silk |
|---|---|---|---|---|---|---|
| A (Appendix B) | 50,000 | 914 / 3 | 889 / 8 | 920 / 3 | 404 / 136 | 40 / 227 |
| A (Appendix B) | 100,000 | 915 / 2 | 899 / 6 | 927 / 1 | 573 / 94 | 151 / 199 |
| A (Appendix B) | 200,000 | 915 / 0 | 919 / 0 | 931 / 0 | 920 / 6 | 655 / 36 |
| C (contract rules) | 50,000 | 779 / 15 | 550 / 63 | 508 / 45 | 67 / 171 | 6 / 231 |
| C (contract rules) | 100,000 | 822 / 8 | 533 / 65 | 651 / 22 | 111 / 147 | 16 / 222 |
| C (contract rules) | 200,000 | 870 / 6 | 732 / 27 | 827 / 4 | 228 / 102 | 56 / 189 |

Table 5C still explains Table 3B: at the spec treasury the house caravans ship 40 silk units per 4-hour run under A and 6 under C (231 ticks blocked; 227 under A), against 655 with 200,000-fils treasuries under A. K = 3000 does not make silk shippable; it only makes the clamp saturation that came with it much smaller.

## 7. Recommendations (proposals; each needs the owner's decision and a spec version)

Ranked by expected benefit divided by risk. Proposal 3 is **adopted** (spec-v1.2); the rest are not applied. Evidence cells quote the K = 3000 tables above, and the K = 4000 figure where the conclusion changed.

| # | Proposal | Evidence | Trade-off |
|---|---|---|---|
| 1 | **Re-baseline spec 2.9 and the sim with contract semantics** (unsold goods kept, D25 ship limits, warehouse cap, no negative treasury) before freezing any parameter. No parameter change. | Tables 1G, 5D: the reference shows 23.1% truncated and healthy treasuries; contract semantics show 43-51% truncated and merchants at 9,300 of 200,000 fils (A, 5 bots). Artefact list in section 1. Still true at K = 3000. | Costs sim work only. Without it, every tuning decision rests on a model that hides the main risk. |
| 2 | **Make spice and silk shippable and keep merchants liquid.** Options: (a) let `ship` and house caravans pay from the `house` balance or in partial units whenever one unit is affordable (today silk needs about 60,000 fils for 4 units, above a 50,000 treasury and far above the 12,500-fils 25% budget); (b) raise the D25 budget from 25% to 50% for goods whose single-unit mid exceeds it; (c) a small recurring top-up of merchants from the house (it already recycles 10% of its balance) funded by a higher trade fee. | Table 5C (silk shipped 6 per run, C, at K = 3000), Table 1G/5D (merchants run dry). The clamp part of the old evidence is gone at K = 3000 (spice/silk at a clamp 66-86% at K = 4000, 17-24% now), so the case now rests on liquidity, not on price saturation. | (a)-(b) weaken the 25% drain protection of audit finding 6 (a compromised merchant key could drain more per tick); (c) raises player costs. Tuning must be re-run under proposal 1. |
| 3 | **`MULT_K_BP` 4000 to 3000 (or 3500).** ADOPTED as spec-v1.2 on 2026-11-03. Do **not** raise it to 6000/8000. | Tables 3C-A, 3C-C: K = 3000 gives spice+silk at a clamp 22-24% instead of 86-89% (5 bots) with nearly the same median profit per trip (1,231 vs 1,432 A; 2,687 vs 2,722 C); K = 6000/8000 raises profit but increases clamp time, truncation and dry merchants. K = 3500 was only computed analytically (Table 3A: the high clamp binds only at stock 0). | Price band shrinks to 75%-130% of base, so a little less price signal for the UI and the AI; under A with 10 bots the mean profit per trip falls from -24 to -294 fils (Tables 1B, 1H). |
| 4 | **Keep treasuries at 50,000 fils; do not raise them to fix "merchant broke".** If more headroom is wanted for a demo with LIVE money, 75,000 fils (30 USDC risk) is the most that the data support. | Table 1C-A/1C-C: 4x treasury gives -10 percentage points truncation (C, 5 bots: 31.7% to 21.6%) and 4.1x the worst-case loss (177,147 to 722,256 fils); A's 200k row removes the profit. | None to keep. A bigger treasury raises operator risk linearly (Table 5A: the seed is nearly consumed anyway). |
| 5 | **Fix the first-minute UX goal.** Reword it as "first purchase and departure in under a minute in a running world, first realised profit usually within about 10 minutes", show projected profit when the player picks a route, and (optional, spec change) add a first-journey-only intro route of 60 s with no ambush risk. | Table 4E (180 s minimum), 4F (median 0-5 min to first purchase in a running world; 6-12 min to first profitable arrival), 4A (fresh world has no price gaps: first positive trade at minute 3, small until about minute 10). Changed slightly from the K = 4000 text ("within 5-6 minutes"): the median first profitable arrival is now 6-12 minutes. | Intro route is new content and a new special case in the contract; the rewording costs nothing. |
| 6 | **Re-price guards**: `GUARD_COST_BP` 200 to 50-100, or `GUARD_RISK_FACTOR_BP` 6500 to about 4000, or `ceil` loss with a minimum of 1 unit. | Table 4C: with today's numbers a guard only pays on madan-bandar; Table 5-5: nothing is lost in lots of 3 or fewer. Unchanged by K. | Changing the loss rule re-opens D1 (floor) of spec-v1.1; cheaper guards reduce `house` income that funds recycling. |
| 7 | ~~Raise spice and silk target stock x2~~ **Moot at K = 3000.** It was the fallback if proposal 3 were rejected. | Table 3E: at K = 3000 x2 and x3 leave spice+silk at a clamp 22%, 22%, 21% (A, 5 bots); the 86% to 74% improvement existed only at K = 4000. | Would change the goods table and golden vectors for no gain. |
| 8 | **Keep the faucet rule** (net worth under 5,000 fils, 1 h cooldown) and the rebalance (30%) and recycle (10%) percentages. | Tables 2A (43% to 0% of bots under 50 dinars after 24 h with 10 bots, A), 1D, 1E (switching either off raises dry merchants from 3.4% to 38.2% or 7.2%, A, 5 bots). | None. |
| 9 | **Close small leaks** (any order): a worker-side rule that the AI never moves bias in one direction for more than one tick in a row (or lower the D24 step from 300 to 100 bp); optionally rate-limit trades per player per minute; optionally make a trade priced by the sum of unit prices instead of the midpoint. | Tables 5-4 (profitable after 2 ticks), 5-3 (up to 1.77% from splitting sells, 0.53% buys at K = 3000; was 3.91% and 0.83%): the pricing leak is smaller now. | Slower policy response for the AI; extra contract complexity for the pricing change. |

Not recommended: more or fewer house caravan units (Table 1F: profit falls with units, truncation does not), wider clamps alone (Table 3D: at K = 4000 fewer trips and more truncation; at K = 3000 a lower floor is harmless but gains little), and changing the 1% fee or spread without first fixing liquidity (the 1% fee funds the only inflow to merchants other than purchases).

## 8. How to reproduce

From the repository root (Python 3.12, Node 20+, `pnpm install` done). The commands are the same as for the K = 4000 version; the scripts take K = 3000 as the default and print both K where they compare:

```
python scripts/analysis/validate.py        # section 1: K = 3000 and K = 4000 (about 10 s)
python scripts/analysis/run_exp.py         # tables 1x, 2x, 3x (sequential: sum of the three parts below)
python scripts/analysis/run_exp.py q1      # the parts can be run in parallel as separate processes
python scripts/analysis/run_exp.py q2
python scripts/analysis/run_exp.py q3
python scripts/analysis/run_q4.py          # tables 4x
python scripts/analysis/run_q5.py          # tables 5A-5D
packages/shared/node_modules/.bin/tsx scripts/analysis/exploits.ts > scripts/analysis/results/q5_exploits.txt
python scripts/analysis/validate.py > scripts/analysis/results/validate.txt
python scripts/analysis/build_doc.py       # regenerates this file
```

Timing of the 2026-11-05 run (16 cores, the five parts as parallel processes, written by file timestamps): about 2-4 minutes per part, all done within about 5 minutes. Run sequentially, add the parts up. `pnpm sim --bots 5 --ticks 240 --seed 7` prints the reference row that the variant reproduces (190 trips, median 1,392, 47 broke).

## 9. Limits of this evidence

* Greedy bots are neither humans nor the LLM merchants. Treat percentages as ranges and signs as the finding.
* Rule set C models D25 from the decision log, not the Rust code; D1-D3 are validated against the CHANGELOG (both spec-v1.1 at K = 4000 and spec-v1.2 at K = 3000).
* The merchants' own policy (spread and bias set by the AI) is fixed at the default 800 bp spread and bias 0 in all runs, as in the reference sim. A policy that raises the spread when poor would change Q1.
* Expected-profit figures in Question 4 assume the newcomer acts alone on the current snapshot; Table 4F is the competing-bot counterpart.
* The worst case of Question 5 uses bots that never withdraw or stop; real players can leave with the cash, which only makes the operator's loss permanent.
* The K = 3000 versus K = 4000 comparison is paired by seed, but the sim is chaotic: a row-to-row difference of a few points (for example truncated share) is not evidence of an effect; the clamp-time and Table 5-3 differences are large and structural.
* K = 3500 appears only in the analytic Table 3A; it was not simulated.
