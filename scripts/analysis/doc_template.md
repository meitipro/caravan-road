# Economy tuning evidence (Phase 8 input)

> **Status: regenerated on 2026-11-05 with the spec-v1.2 baseline `MULT_K_BP = 3000`** (merged 2026-11-03, tag `spec-v1.2`, PROGRESS decision D5). Every table is a real run of the scripts in `scripts/analysis/`; tables that carry the evidence for the change from K = 4000 (spec-v1.1) to K = 3000 show both values and are labelled with the K they use. Tables without a K in the title use K = 3000. The previous version of this file (K = 4000 baseline) is in git history (`4b4567c`); its K = 4000 numbers are reproduced exactly by the K = 4000 rows below (Tables 1H, 3B, 3C, 3D, 3E), which is a consistency check of the regeneration.
> Nothing in `spec/`, `packages/shared/` or `contracts/` is changed by this file. Proposal 3 of section 7 (K 4000 to 3000) is now adopted; proposals 1, 2 and 4-9 are still open and need the owner's decision and a new spec version.
> This file is generated: `python scripts/analysis/build_doc.py` fills the tables from `scripts/analysis/results/`, which the scripts in `scripts/analysis/` produce. Every number in a table comes from a run; sentences quote those tables. **Sections whose conclusions changed with the new baseline are marked "Changed with K = 3000" and summarised in section 0.1.**

## 0. Top findings (K = 3000 baseline)

1. **Merchant treasuries are still the binding constraint, and the published sim hides how badly (conclusion unchanged).** With the reference semantics 20-32% of cargo sales (ten-seed means; 14-36% for single seeds) are cut short by the merchant's treasury and 14-24% of the sale revenue is lost (Tables 1A, 1B). In the reference sim the unsold goods are *destroyed*; the contract instead rejects the sale and the player keeps the goods. With that contract-faithful behaviour, 5-10 greedy players drain the four merchants from 200,000 fils to between 4,200 and 9,300 fils in 4 hours, 58-74% of merchant-ticks are below 20% of the seed, and trips fall to between a third and a half (Tables 1G and 5D). At K = 4000 the corresponding figures were 3,500-10,600 fils and 64-74%; the move to K = 3000 did not fix this.
2. **Bigger treasuries still do not fix it and scale operator risk linearly (unchanged).** Going from 50,000 to 200,000 fils per merchant lowers the truncated share only from 31.7% to 21.6% (contract rules, 5 bots, Table 1C-C) while the worst operator loss grows from 177,147 to 722,256 fils. At the spec treasury the operator's seed capital is nearly fully consumed in the runs: worst observed loss 192,019 of 200,000 fils (96%, Table 5A) and never above it.
3. **Changed with K = 3000: spice and silk no longer live on the clamps.** At K = 4000 they were at a price clamp 66-89% of the 4 hours; at K = 3000 they are at a clamp 17-24%, and only at the LOW clamp (the high clamp cannot be reached because the multiplier tops out at 13,000; Tables 3B, 3C). All goods together: 7-15% of the time at a clamp (5 and 10 bots, 4 h) instead of 27-53%. The root cause of the clamp saturation, that the house caravans cannot pay for 4 units of silk out of a 50,000-fils treasury or its 25% budget, is unchanged: 6 silk units shipped per run under the contract rules versus 655 with 200,000-fils treasuries under the reference rules (Table 5C). The cost of the change is small: median profit per trip 1,231 versus 1,432 (A, 5 bots) and 2,687 versus 2,722 (C, 5 bots); under A with 10 bots the mean profit per trip falls from -24 to -294 fils (Tables 1B, 1H).
4. **"First profitable trade under one minute" still cannot be met for realised profit**: the shortest journey is 180 s (Table 4E). A first journey can start inside the first minutes (median 0-5 minutes after joining a running world, Table 4F), and the first realised profit arrives a median 6-12 minutes after joining; a brand-new world has no price gaps for the first minutes (Table 4A: first positive trade at minute 3, 805 fils, was minute 2 and 266 fils at K = 4000) so the first profitable arrival takes a median 14-22 minutes there (13-20 at K = 4000).
5. **No exploit loop found in the integer math, and money is conserved in every one of the {{C:total}} variant runs** (plus the shared TypeScript sim on every tick in validation). 635,400 same-merchant round trips and 30,917 closed multi-trade loops: none profitable (Tables 5-1, 5-2). Real but bounded edges: 1-unit trades beat one 40-unit trade by up to 1.77% on sells and 0.53% on buys (Table 5-3; **changed**: up to 3.91% and 0.83% at K = 4000); a merchant that drifts its bias at the allowed 300 bp per tick gives a risk-free hold-and-sell after 2 ticks (Table 5-4); an ambush destroys nothing when a good is carried in lots of 3 or fewer (Table 5-5), and guards are a pure cost on 5 of 6 routes (Table 4C).

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

{{V}}

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

{{T:q1:1A-A}}

{{T:q1:1A-C}}

{{T:q1:1B}}

{{T:q1:1H}}

Reading (**conclusion unchanged by K = 3000**): at the spec treasury, 14-36% of single-seed cargo sales are truncated (mean 20-32%) and the merchant's inability to pay removes 14-24% of the sale revenue (means). A typical cargo would earn 6,465-9,613 fils if the merchant could pay (13-19% of a 50,000-fils capital) but realises -294 to 3,117 fils on average. The share falls only a little as bots are added (25.2%, 23.1%, 19.9% under A): the loss is a per-sale ceiling, not only a crowding effect. Against K = 4000 (Table 1H) the truncated share moves by at most 4.8 points (A: 30.0, 23.5, 20.3 to 25.2, 23.1, 19.9; C: 27.5, 35.3, 26.2 to 26.3, 31.7, 25.7), within the seed noise of Table 1B. A single merchant treasury of 50,000 fils caps one visit's revenue at 500 dinars; a 40-unit cargo of silk is worth 800,000 fils at base.

### 2.2 Sensitivity to treasury size (operator risk grows with it)

Operator seed capital = 4 x treasury (LIVE cap today: 4 x 5 USDC = 20 USDC). "Operator P&L" = merchants' cash plus house balance minus 4 x treasury.

{{T:q1:1C-A}}

{{T:q1:1C-C}}

Reading (**unchanged**): under the contract rules (C) 4x the treasury (50k to 200k) cuts the truncated share only from 31.7% to 21.6% and lost revenue from 20.4% to 16.5%, because players grow richer in step (mean profit per trip 1,103 to 3,504 fils) and drain whatever is there; the worst operator loss rises from 177,147 to 722,256 fils (89% of a 200k seed at 50k; 90% of an 800k seed at 200k). Under A the 200k row looks "fixed" (0.4% truncated) but only because the profit disappears too (potential profit per sale 3 versus 6,916 at 50k): at 200k the house caravans can finally pay for silk and spice (Table 5C) and compete the arbitrage away. At 75k and 100k the improvement is small (23.1% to 19.8% and 19.6% truncated, A, 5 bots). **Larger treasuries mean more operator risk for little relief.**

### 2.3 REBALANCE_PCT, HOUSE_RECYCLE_PCT, NPC ship units

{{T:q1:1D-A}}

{{T:q1:1D-C}}

{{T:q1:1E-A}}

{{T:q1:1E-C}}

{{T:q1:1F-A}}

{{T:q1:1F-C}}

Reading (**unchanged**):

* **REBALANCE_PCT**: switching it off is clearly bad (merchant-ticks under 20% jump to 38.2% from 3.4%, A, 5 bots; 30.9% from 15.6%, C). Between 10 and 100 there is no robust winner: A, 10 bots improves at 100 (truncated 19.9% to 10.4%) but C gets worse (25.7% to 26.8%), and the improvement under A coincides with the potential profit per sale falling from 6,465 to 2,670. Keep 30 or move to 50 at most.
* **HOUSE_RECYCLE_PCT**: off versus on matters for liquidity (merchant-ticks under 20%: 7.2% at 0 versus 3.4-3.9% at 5-50, A, 5 bots; 34.4% versus 14.4-19.0%, C), but the fee pool is small so percentages from 5 to 50 are indistinguishable. Keep 10.
* **NPC_SHIP_UNITS**: more shipping does **not** reduce truncation (A, 5 bots: 30.1% at 0, 23.1% at 4, 30.4% at 16) and it competes the players' profit away: the median profit per trip falls from 3,297 (no shipping) to 1,231 (4) to 782 (8) fils. Under C the quantity hardly matters because the 25% budget binds first (Table 5C; C, 5 bots truncated 31.8%, 31.7%, 35.5%, 33.8% for 0, 4, 8, 16 units).

### 2.4 What the contract does with the unsold goods

{{T:q1:1G}}

{{T:q5:5D}}

Reading (**unchanged in direction, somewhat milder in size**): when the player keeps the goods (the contract behaviour), 43-51% of all sales are truncated (51-55% at K = 4000), only a third to under a half as many trips are completed (66 versus 175, 147 versus 319, 46 versus 144, 102 versus 296), the merchants end the 4 hours holding 4,248-9,300 fils of their 200,000 (58-74% of merchant-ticks under 20%), and the greedy players hold the cash (441k-696k) and unsellable goods. The market stalls rather than the merchants "staying broke for a while". The reference sim looks healthier only because destroying the unsold goods happens to leave the merchant's cash in place. Humans will behave less mechanically than these bots (they will buy more and sell elsewhere), but the direction, cash flowing from the four merchants to the players until the merchants cannot pay, follows from conservation of money and the arbitrage design, not from the bot's stupidity.

### 2.5 Q1 summary

* About a fifth to a third of sales are cut short at today's parameters, losing roughly a fifth of sale revenue; with contract semantics the economy also loses most of its liquidity within hours. K = 3000 does not change this.
* Treasury size, rebalancing, recycling and ship units are weak levers; what pays out the merchants is the arbitrage itself. The levers that matter are the ones that change how much cash the arbitrage can pull out of a single merchant (goods that can be shipped at all: see section 4 and Table 5C; price slope was the other lever and has now been moved to K = 3000 without relieving this).

## 3. Question 2 - wealth concentration and bankruptcies

Method: `python scripts/analysis/run_exp.py q2`. Faucet rule modelled as in the contract (D4): a bot whose net worth (cash plus goods at base, cargo included) is under 5,000 fils may claim +50,000 fils, cooldown 60 ticks (1 h). Money check is "start + injected". Gini uses the standard definition on final net worth (the maximum for n bots is (n-1)/n).

{{T:q2:2A}}

{{T:q2:2B}}

Reading (**conclusion unchanged; numbers moved**):

* Concentration: Gini 0.20 (2 bots), 0.37 (5), 0.49 (10) after 4 h under A without a faucet (0.14, 0.27, 0.45 under C; 0.23, 0.35, 0.50 under A at K = 4000). Per seed (Table 2B) the richest bot ends with 4.3x-8.6x the net worth of the poorest (5.6x-12x at K = 4000).
* Bankruptcy: without a faucet, 5% of bots are under 50 dinars after 4 h with 10 bots (A; 11% at K = 4000) and **43% after 24 h** (A, 10 bots; 24.9% of all bot-time; 12% under C). With the faucet rule: 0% after 4 h and 0% after 24 h, Gini 0.64 to 0.39 (24 h, 10 bots, A).
* The faucet is cheap: 0.1 claims per bot in 4 h and 0.6-0.7 claims per bot in 24 h with 10 bots (27.5-37.0 USDC-equivalents of PLAY money across the 10 bots, which is play money by definition).
* Caveat: in set A many "bankruptcies" are cargo destroyed by truncated sales (section 2.4), so the figure is pessimistic for A and optimistic for contract semantics, where players keep goods and the problem is merchants' cash. The faucet rule as written (net worth, not cash) does what the plan asks; no change is proposed.

## 4. Question 3 - price clamp saturation and MULT_K_BP (**changed with K = 3000**)

Method: `python scripts/analysis/run_exp.py q3`. Share of time = share of (city, good, tick) samples at the end of each tick with the multiplier at its 13,500 (high) or 7,500 (low) clamp. K = 3000 is the spec baseline; K = 4000 is shown for the evidence behind the change.

{{T:q3:3A}}

{{T:q3:3B-A}}

{{T:q3:3B-C}}

Reading (**changed**): a higher `MULT_K_BP` narrows the unclamped band, so it cannot reduce clamp time. At the old K = 4000 the band was 12.5%-162.5% of target stock, which for spice (target 40) is 5 to 65 units and for silk (target 30) 4 to 49 units; one stock unit moved silk's price by 1.33% of base and spice's by 1%. At the spec K = 3000 the multiplier ranges from 13,000 (stock 0) down to the 7,500 floor, the high clamp is never reached, and the low clamp binds only at 183.3% of target or more: spice (cap 80) at 74 units or more, silk (cap 60) at 55 units or more, so the clamped band is the last 7 and 6 units below the cap. One stock unit moves silk's price by 1.00% of base and spice's by 0.75% (Table 5-7). With bots in the world the high clamp share is 0% for every good (Table 3B), grain, salt and iron stay inside the band under A (0% at 5 and 10 bots, 4 h) and are at the low clamp 2-15% under C with 5 bots, and spice and silk sit at the low clamp 21-24% of the 4 hours with 5 bots (A: 21% and 24%), against 60-64% high plus 24% low at K = 4000. 24% of all (city, good, tick) samples is close to one city of four, consistent with the producing city accumulating stock at the cap (Table 5C: little silk or spice is shipped out); that reading is not separately tested. In a world with no players every good is at a clamp 23% of the first 4 hours (A; 27% under C) and 33% of 24 hours (34% under C), against 68%, 77%, 95% and 96% at K = 4000 (rows with 0 bots): the clamps are a property of the production/consumption design, not of bots, and K = 3000 removes most of them.

{{T:q3:3C-A}}

{{T:q3:3C-C}}

{{T:q3:3D}}

{{T:q3:3E}}

Reading:

* **K = 6000 / 8000** (unchanged, evidence for not going the other way): median profit per trip rises (A, 5 bots: 1,432 to 2,013 to 2,861 fils; C: 2,722 to 3,298 to 3,987) but clamp time rises (spice+silk 86% to 91% to 93%; grain+salt+iron 0% to 4% to 17%, A), truncation rises (23.5% to 24.4% to 26.8% A; 35.3% to 36.1% to 38.3% C), merchants go dry more often (merchant-ticks under 20%: 2.5% to 5.4% to 14.3%, A; 19.0% to 25.8% to 29.8%, C) and trips fall (C: 130 to 120 to 103). More profit comes out of the same four treasuries, faster.
* **K = 3000 versus 4000** (the evidence for the adopted change): spice+silk at a clamp 86% to 22% (A, 5 bots), 66% to 17% (A, 10 bots), 89% to 24% (C, 5 bots) and 85% to 22% (C, 10 bots). Median profit per trip 1,231 versus 1,432 (A, 5 bots), 768 versus 857 (A, 10 bots), 2,687 versus 2,722 (C, 5 bots), 1,161 versus 1,378 (C, 10 bots); fewer dry merchants under C (15.6% versus 19.0% with 5 bots, 7.2% versus 8.4% with 10). Cost: under A with 10 bots the mean profit per trip is -294 fils instead of -24, i.e. a greedy bot swarm loses slightly more per trip when the price signal is weaker. K = 2000 removes clamping entirely but 10 bots then lose money on average (mean -439 fils per trip, A) and under C the median profit per trip falls to 2,107 (5 bots) and 1,009 (10 bots).
* **Wider clamps** (Table 3D). At K = 4000, 6,000/15,000: clamp time 34% to 8% (A, 5 bots) and mean profit 76 to 663, but truncation rises (23.5% to 28.9%) and trips fall (182 to 151). At K = 3000 the high clamp is unreachable anyway, so only the floor matters: lowering `MULT_MIN_BP` to 6,000 takes the remaining clamp time to 0% (A, 5 bots: 9% to 0%) with 171.2 trips instead of 175.0, truncated share 22.8% instead of 23.1% and mean profit per trip 269 instead of 45; with 10 bots trips fall 318.8 to 299.2 and truncation rises 19.9% to 21.8%. The effect is small and mixed; it is not proposed.
* **Larger spice/silk targets** (Table 3E): **changed**: at K = 4000 x2 gave 86% to 74% (A, 5 bots) and 66% to 44% (A, 10 bots) at a clamp, x3 61% and 28%; at K = 3000 spice+silk are at a clamp 22%, 22%, 21% (A, 5 bots; spec, x2, x3) and 24%, 23%, 22% (C, 5 bots), so the extra targets buy nothing while still costing spec changes to the goods table.

## 5. Question 4 - the first profitable trade

Three different questions are mixed in "first profitable trade in under a minute": when can the player start, when does profit appear, and how large is it. Method: `python scripts/analysis/run_q4.py`. Expected profit (EP) for a 500-dinar newcomer = one journey chosen with full knowledge of the current prices and treasuries, exact integer prices, 1% fees, ambush risk, guards chosen optimally (cost 2% of the cargo base value each, truncated), unsold goods valued at 0. EP is therefore an upper bound for a player who acts first; Table 4F is the realised outcome of a competing bot. All tables except 4C and 4E run at K = 3000 (4C and 4E are analytic and do not depend on K).

{{T:q4:4E}}

**Time to first profit.** The shortest journey takes 180 s, so a realised profit cannot appear in 60 s on any route. What can happen inside the first minute is the purchase and departure.

{{T:q4:4A}}

{{T:q4:4F}}

Reading (**numbers changed slightly, conclusion unchanged**): in a running world (joins at minute 60 to 180) a newcomer's median first purchase is 0 to 5 minutes after joining (0 in 6 of the 12 A/C rows), its first arrival 5-11 minutes after joining and its first profitable arrival after a median 6-12 minutes; 50-80% of first journeys are profitable under A and C (40-80% at K = 4000), with a median first-journey profit between 872 and 15,605 fils (1.7% to 31.2% of capital). In a brand-new world (J = 0) nothing is profitable at first: all prices equal base and a round trip costs the 8% spread plus 2% fees (EP -99 fils at minute 0); the first positive EP appears after 3 minutes of world time (805 fils, 3 spice; at K = 4000 it was minute 2, 266 fils) and is small, 3,320-10,729 fils (6.6-21.5%) on the short route at 10 minutes. Newcomers in the fresh world buy after a median 8 minutes and are profitable after 14-22. Under the contract semantics with unsold goods kept (last rows) the stalled market means late newcomers often never complete a journey in the next 2 hours (Table 4F: 0/10 completed at J = 120 and 180 with 5 and 10 bots, and 8/10 and 5/10 at J = 60), a consequence of the liquidity problem in section 2.4.

**Typical profit per trip.**

{{T:q4:4B}}

Reading (**changed a little**): on the cheapest route (bandar-shahr, 180 s, 8% risk) the best available single journey is worth a median 5,374-16,769 fils (10.7-33.5% of the 50,000-fils capital) in all 8 world types (positive in 67-100% of snapshots), mostly spice/silk bought where it is cheap and sold dear; over all routes 17,529-26,293 fils (35-53%) and bandar-madan is usually best (bandar-dasht for C with 10 bots). That is the hindsight upper bound for the first mover; competing bots realise a median 1,231-2,687 fils per trip (2.5-5.4% of capital, Table 1B, 5 bots) and a newcomer's median first journey, joining at minute 60 or later, is between 872 and 15,605 fils (1.7% to 31.2%) (Table 4F). Plan the UX around about 5% of capital per 3-6 minute trip as the sober figure and 10-30% as what a first-mover on the best lane can see.

{{T:q4:4D}}

**Guards versus ambush risk.**

{{T:q4:4C}}

A guard costs 2% of the cargo base value (e.g. 800 fils for 40 grain) and removes, in expectation, 0.84% of the cargo on the shortest route; on five of six routes every guard is a pure cost, and only the first guard on madan-bandar (2.10% saved versus 2.00%) is marginally positive (unchanged: analytic). The optimiser chose at least one guard in 0-10% of snapshots (Table 4B, last column; 0-20% at K = 4000). The first trip has an 8% ambush chance on the shortest route and a 22.1% chance of at least one ambush in the first three trips; with the floor rule an ambush destroys 12 of 40 units (30%) but nothing at all for a good carried in lots of 3 or fewer (Table 5-5), which is why the best "immune" bundle (Table 4D) earns about the same as the best single-good cargo (5 bots: 12,526 versus 12,043 on the short route under A, 5,866 versus 5,770 under C). For a new player the right advice is to skip guards, and guards as designed give a risk-averse player almost nothing for 2%.

## 6. Question 5 - exploit loops and conservation

Method: `packages/shared/node_modules/.bin/tsx scripts/analysis/exploits.ts` (exhaustive, uses the real `tradeCost()`, K = 3000), `python scripts/analysis/run_q5.py`.

**Round trips and closed loops against one merchant.**

{{X:5-1}}

{{X:5-2}}

No loop makes money; the best is a loss of 35 fils (grain, 1 unit, spread 400, bias -1500) for a round trip and 44 fils for a closed loop (loops tested: 30,917, was 25,952 because the start stocks now also cover the K = 3000 clamp edge), and the smallest loss is 4.56% of the outlay, i.e. the spread and fees always dominate the integer rounding and the midpoint-pricing asymmetry for odd quantities (one stock unit moves a price by 0.10-1.00% of base, Table 5-7, much less than the 6% a round trip costs at the minimum spread). **Unchanged**: no profitable loop.

**Splitting a trade.**

{{X:5-3}}

**Changed with K = 3000.** Splitting still wins in most cases, up to 0.53% cheaper on buys (silk, stock 55) and up to 1.77% better on sells (salt, stock 200; 5,720 fils at silk stock 20), against 0.83% and 3.91% at K = 4000. At K = 4000 the previous version attributed the edge to the clamps; at K = 3000 the high clamp cannot be reached and the edge persists in 731 of 785 buy cases and all 785 sell cases, so it follows from the integer midpoint rule instead (a 40-unit trade is priced at stock +/- 20, while 40 one-unit trades walk through an average of 19.5 units; that arithmetic is the likely cause and was not separately tested). It is not a loop (it improves one leg of an arbitrage by at most 1.77%) but it costs the relayer 40 transactions per trade. If transaction cost matters, `MAX_QTY_PER_TRADE` or a per-player rate limit bounds it.

**Merchant policy drift (D24).**

{{X:5-4}}

D24 allows 300 bp per tick. A merchant (the AI) that walks its bias upward at that rate while keeping the spread low lets any player in the city buy now and sell 2 minutes later at a profit, without travelling; with spread 800 it takes 3 ticks (4 for salt at K = 3000). The AI baseline does not do this by design, but nothing in the contract forbids it, and a persona that "raises prices when stock is low" will do it gradually. **Unchanged.**

**Ambush rounding and stall fee.**

{{X:5-5}}

{{X:5-6}}

The stall fee `ceil(2% x price)`, minimum 1 fils, cannot be evaded by splitting (0 of 19,996 cases cheaper) and is never below 2%. Two accounts can still move cash between them at the 2% price (the seller pays): with D4 (faucet when net worth is under 5,000 fils) and D5 (seller pays) one account that tops up 50,000 fils from the faucet each hour can buy a 1-grain stall priced at 49,990 fils from a second account, ending below the 5,000-fils threshold again and handing the other account 48,990 fils (fee `ceil(2% x 49,990) = 1,000` fils) per hour. That arithmetic follows from the rules, it was not simulated. In PLAY it only distorts the leaderboard; in LIVE the faucet is disabled. **Unchanged.**

**Arbitrage between two cities "forever" and operator exposure.** Players' profit comes only from the merchants' cash, because production and consumption create and destroy goods, not money. So an unbounded loop cannot exist, and the question is how much of the merchants' pool a strong player can take. Goods created per tick are valued at 143,500 fils at base prices (861 USDC-equivalent per hour), which is why arbitrage opportunities keep reappearing; the cash pool that pays for them is 200,000 fils.

{{T:q5:5B}}

{{T:q5:5A}}

Reading (**unchanged**): in every run of Table 5A the operator's P&L stayed above -200,000 fils (worst observed -192,019, 96% of the seed, 10 players x 50,000 fils for 24 h under C), which confirms the plan's statement that the operator's maximum loss equals the merchants' treasuries. It also shows the cap is not a theoretical limit: one 20-USDC whale alone takes a mean 139,464-161,467 fils (70-81%) in 24 hours, and 5-10 ordinary greedy players take about 162,000-172,000 (C, 24 h). Operator risk is a practical number, not a remote one.

**Money conservation.** Every run asserts `merchants + house + bots' cash == start (+ faucet injections)` after every tick. Results: {{C}} The tables' "conserved" columns show the per-row count.

{{T:q5:5C}}

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
