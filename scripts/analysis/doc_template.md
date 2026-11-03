# Economy tuning evidence (Phase 8 input)

> **Status: analysis and PROPOSALS only.** Nothing in `spec/`, `packages/shared/` or `contracts/` was changed (spec-v1.1 stays locked).
> **Branch note (`proposal/spec-v1.2-mult-k-3000`):** proposal 3 of section 7 (`MULT_K_BP` 4000 to 3000) is applied on that branch only. Every table below was produced with the spec-v1.1 code (K = 4000 in `packages/shared`) and is the evidence for the proposal; it was not regenerated. On that branch `python scripts/analysis/validate.py` sections 1-2 report the K = 4000 variant as different from `runSim()` (the shared sim now uses K = 3000), by design; section 3 still passes.
> Every recommendation below needs the owner's decision and, if accepted, a new spec version (spec-v1.2) applied to `packages/shared` and the contract together, as master plan section 11 step 2 requires.
> This file is generated: `python scripts/analysis/build_doc.py` fills the tables from `scripts/analysis/results/`, which the scripts in `scripts/analysis/` produce. Every number in a table comes from a run; sentences quote those tables.

## 0. Top findings

1. **Merchant treasuries are the binding constraint, and the published sim hides how badly.** With the reference semantics 20-35% of cargo sales are cut short by the merchant's treasury and 14-25% of the sale revenue is lost (Table 1B). In the reference sim the unsold goods are *destroyed*; the contract instead rejects the sale and the player keeps the goods. With that contract-faithful behaviour, 5-10 greedy players drain the four merchants from 200,000 fils to between 3,500 and 10,600 fils in 4 hours, 64-74% of merchant-ticks are below 20% of the seed, and trips fall by two thirds (Tables 1G and 5D).
2. **Bigger treasuries do not fix it and scale operator risk linearly.** Going from 50,000 to 200,000 fils per merchant lowers the truncated share only from 35.3% to 23.9% (contract rules, 5 bots, Table 1C-C) while the worst operator loss grows from 179,029 to 669,258 fils. At the spec treasury the operator's seed capital is nearly fully consumed in the runs: worst observed loss 191,308 of 200,000 fils (96%, Table 5A) and never above it.
3. **Spice and silk live on the clamps because the house caravans cannot pay for them.** Spice and silk are at a price clamp 66-89% of the time in 4 hours (Tables 3B, 3C); the root cause is that shipping 4 units of silk costs more than a 50,000-fils treasury (or its 25% budget) can pay: 5 silk units shipped per run under the contract rules versus 613 with 200,000-fils treasuries under the reference rules (Table 5C). `MULT_K_BP = 3000` removes most of the saturation (spice+silk at a clamp 86% to 22%) at nearly the same player profit (Tables 3C-A, 3C-C); raising it to 6000 or 8000 makes saturation worse.
4. **"First profitable trade under one minute" cannot be met for realised profit**: the shortest journey is 180 s (Table 4E). A first journey can start inside the first minute (median 0 minutes after joining a running world, Table 4F), and the first realised profit arrives about 5-11 minutes after joining; a brand-new world has no price gaps for the first minutes (Table 4A) so the first profitable arrival takes a median 13-20 minutes there.
5. **No exploit loop found in the integer math, and money is conserved in every one of the 2,400+ runs.** 635,400 same-merchant round trips and 25,952 closed multi-trade loops: none profitable (Tables 5-1, 5-2). Real but bounded edges: 1-unit trades beat one 40-unit trade by up to 3.91% on sells (Table 5-3); a merchant that drifts its bias at the allowed 300 bp per tick gives a risk-free hold-and-sell after 2 ticks (Table 5-4); an ambush destroys nothing when a good is carried in lots of 3 or fewer (Table 5-5), and guards are a pure cost on 5 of 6 routes (Table 4C).

Ranked proposals are in section 7.

## 1. Method and validation

**Tools** (all new files are under `scripts/analysis/`; `scripts/ref` and `packages/shared` are only read):

| file | purpose |
|---|---|
| `econ_variant.py` | line-by-line port of `scripts/ref/economy_sim.py` with extra knobs (treasury size, `MULT_K_BP` and clamps, `NPC_SHIP_UNITS`, rebalance/recycle percentages, target stock, faucet, contract rule switches) and counters (truncated sales, revenue shortfall, clamp time, treasury time, Gini, operator profit and loss, money conservation on every tick) |
| `ts_runsim.ts`, `validate.py` | run the shared TypeScript `runSim()` and the Python reference script as subprocesses and compare them with the variant |
| `run_exp.py` | questions 1-3 (tables 1x, 2x, 3x) |
| `run_q4.py` | question 4 (tables 4x) |
| `run_q5.py`, `exploits.ts` | question 5 (tables 5A-5D and 5-1 to 5-7); `exploits.ts` calls the real `tradeCost()` / `quoteBig()` from `packages/shared/src/quote.ts` |
| `build_doc.py`, `doc_template.md` | generate this file |

**Why a Python variant:** `runSim()` exposes only `bots`, `ticks`, `seed`, `npc`, `rebalPct` and `housePct`. Treasury size, `MULT_K_BP` and `NPC_SHIP_UNITS_PER_TICK` are constants in `packages/shared` that I must not change, and the counters I need are not exported. The variant is checked against both implementations before use:

{{V}}

(`validate.py` compares trips, median, p10, p90, broke events, house balance, every bot's net worth and every merchant treasury, for 2/5/10 bots x seeds 7/11/13 plus REBALANCE_PCT 0/10/50/100, HOUSE_RECYCLE_PCT 0/25/50, no NPC, and 0 bots; and it reproduces the spec-v1.1 CHANGELOG figures 61/6,714/26, 132/933/44, 344/958/74 with the three contract decisions switched on.)

**Two rule sets are used in every table:**

* **A** = Appendix B, exactly what `pnpm sim` and spec section 2.9 print (ceil ambush loss, house caravans before rebalancing, float gap test, house caravans automatic, unsold goods of a truncated sale destroyed).
* **C** = contract-faithful: floor ambush loss, tick order production, rebalancing, recycling, ship (D1-D3, which match the CHANGELOG exactly), plus two contract rules the reference sim lacks: merchant-driven `ship` with the D25 limits (destination below target stock, at most 25% of its treasury per tick; I fit the quantity to that budget, snapshot taken after recycling) and the warehouse cap (`2 x target`). D25 is modelled from `contracts/caravan/DECISIONS.md`, not from the Rust code; it is the only unvalidated piece. Warehouse-cap hits were 0 in every run, so that rule never mattered.

**Seeds:** per-seed tables use seeds 7, 11, 13. Averages use **ten** seeds, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41 (the requested five are the first five). The sim is chaotic (spec CHANGELOG says medians swing 2x for one changed rounding), so differences of a few percentage points between rows are noise; sd across seeds is shown in Table 1B.

**Bots** are the reference greedy bots: one good per trip, at most half the merchant's stock, start with 50,000 fils, no guards. They are a stress model, not a forecast of human play.

**Known artefacts of the reference sim** that the tables expose (none is changed here):

1. A truncated sale destroys the unsold goods (`b.inv = {}`); the contract rejects the sale and the player keeps the goods (`try_trade`, `MERCHANT_BROKE`, all-or-nothing per trade). Variant switch `keep_unsold` models the contract behaviour (leftover goods are retried at the same city, then carried to the city that can pay most).
2. After a truncated sale the recomputed price can exceed the treasury, so the treasury goes negative (column "overdrafts": 0.4-4.1 events per run).
3. Sales may push a merchant above `2 x target` (the contract refuses); the count was 0.
4. The reference runs house caravans inside the tick; the contract only does so with `auto_ship = true` (default false), otherwise the worker's merchants call `ship` under D25.

## 2. Question 1 - merchant treasuries and truncated sales

**Definitions.** *Truncated* = at arrival the merchant cannot pay the full price (the reference's "merchant broke" event). *Net revenue lost* = (what the cargo would have fetched at the same prices if the merchant could always pay, after the 1% fee) minus what was paid, as a share of the former. *Profit per cargo sale* = net proceeds minus the buy outlay, averaged per sale: "if the merchant always paid" versus actual. *Merchant-ticks < 20%* = share of (merchant, tick) pairs with a treasury under 20% of the seed.

### 2.1 How often, and how much is lost

Commands: `python scripts/analysis/run_exp.py q1` (tables 1A, 1B). The TypeScript sim gives the same truncated counts for rule set A (e.g. 23/43/86 for 2/5/10 bots at seed 7, equal to the "broke" column of spec 2.9).

{{T:q1:1A-A}}

{{T:q1:1A-C}}

{{T:q1:1B}}

Reading: at the spec treasury, 17-39% of single-seed cargo sales are truncated (mean 20-35%) and the merchant's inability to pay removes 14-25% of the sale revenue (means). A typical cargo would earn 6,900-11,100 fils if the merchant could pay (14-22% of a 50,000-fils capital) but realises -25 to 4,300 fils on average. The share does not fall as bots are added (30.0%, 23.5%, 20.3% under A): the loss is a per-sale ceiling, not only a crowding effect. A single merchant treasury of 50,000 fils caps one visit's revenue at 500 dinars; a 40-unit cargo of silk is worth 800,000 fils at base.

### 2.2 Sensitivity to treasury size (operator risk grows with it)

Operator seed capital = 4 x treasury (LIVE cap today: 4 x 5 USDC = 20 USDC). "Operator P&L" = merchants' cash plus house balance minus 4 x treasury.

{{T:q1:1C-A}}

{{T:q1:1C-C}}

Reading: under the contract rules (C) 4x the treasury (50k to 200k) cuts the truncated share only from 35.3% to 23.9% and lost revenue from 23.2% to 19.2%, because players grow richer in step (mean profit per trip 1,074 to 3,610 fils) and drain whatever is there; the worst operator loss rises from 179,029 to 669,258 fils (90% of a 200k seed at 50k; 84% of an 800k seed at 200k). Under A the 200k row looks "fixed" (1.6% truncated) but only because the profit disappears too (potential profit per sale 706 versus 7,794 at 50k): at 200k the house caravans can finally pay for silk and spice (Table 5C) and compete the arbitrage away. At 75k and 100k the improvement is small (23.5% to 23.3% and 20.8% truncated, A, 5 bots). **Larger treasuries mean more operator risk for little relief.**

### 2.3 REBALANCE_PCT, HOUSE_RECYCLE_PCT, NPC ship units

{{T:q1:1D-A}}

{{T:q1:1D-C}}

{{T:q1:1E-A}}

{{T:q1:1E-C}}

{{T:q1:1F-A}}

{{T:q1:1F-C}}

Reading:

* **REBALANCE_PCT**: switching it off is clearly bad (merchant-ticks under 20% jump to 40.7% from 2.5%, A, 5 bots; 43.8% from 19.0%, C). Between 10 and 100 there is no robust winner: A, 10 bots improves at 100 (truncated 20.3% to 11.3%) but C gets worse (26.2% to 29.7%), and the improvement under A coincides with the potential profit per sale falling from 6,868 to 2,842. Keep 30 or move to 50 at most.
* **HOUSE_RECYCLE_PCT**: off versus on matters for liquidity (merchant-ticks under 20%: 8.9% at 0 versus 2.5-4.6% at 5-50, A, 5 bots; 33.0% versus 14.6-20.9%, C), but the fee pool is small so percentages from 5 to 50 are indistinguishable. Keep 10.
* **NPC_SHIP_UNITS**: more shipping does **not** reduce truncation (A, 5 bots: 33.3% at 0, 23.5% at 4, 28.6% at 16) and it competes the players' profit away: the median profit per trip falls from 3,421 (no shipping) to 1,432 (4) to 787 (8) fils. Under C the quantity hardly matters because the 25% budget binds first (Table 5C).

### 2.4 What the contract does with the unsold goods

{{T:q1:1G}}

{{T:q5:5D}}

Reading: when the player keeps the goods (the contract behaviour), more than half of all sales are truncated (51-55%), only a third as many trips are completed, the merchants end the 4 hours holding 3,488-10,526 fils of their 200,000 (64-74% of merchant-ticks under 20%), and the greedy players hold the cash (442k-696k) and unsellable goods. The market stalls rather than the merchants "staying broke for a while". The reference sim looks healthier only because destroying the unsold goods happens to leave the merchant's cash in place. Humans will behave less mechanically than these bots (they will buy more and sell elsewhere), but the direction, cash flowing from the four merchants to the players until the merchants cannot pay, follows from conservation of money and the arbitrage design, not from the bot's stupidity.

### 2.5 Q1 summary

* About a quarter to a third of sales are cut short at today's parameters, losing roughly a fifth of sale revenue; with contract semantics the economy also loses most of its liquidity within hours.
* Treasury size, rebalancing, recycling and ship units are weak levers; what pays out the merchants is the arbitrage itself. The levers that matter are the ones that change how much cash the arbitrage can pull out of a single merchant (price slope, clamps, goods that can be shipped at all: see section 4).

## 3. Question 2 - wealth concentration and bankruptcies

Method: `python scripts/analysis/run_exp.py q2`. Faucet rule modelled as in the contract (D4): a bot whose net worth (cash plus goods at base, cargo included) is under 5,000 fils may claim +50,000 fils, cooldown 60 ticks (1 h). Money check is "start + injected". Gini uses the standard definition on final net worth (the maximum for n bots is (n-1)/n).

{{T:q2:2A}}

{{T:q2:2B}}

Reading:

* Concentration: Gini 0.23 (2 bots), 0.35 (5), 0.50 (10) after 4 h under A without a faucet (0.08, 0.27, 0.40 under C). Per seed (Table 2B) the richest bot ends with 5.6x-12x the net worth of the poorest.
* Bankruptcy: without a faucet, 11% of bots are under 50 dinars after 4 h with 10 bots (A) and **39% after 24 h** (A, 10 bots; 19.2% of all bot-time; 13% under C). With the faucet rule: 1% after 4 h and 0% after 24 h, Gini 0.59 to 0.41 (24 h, 10 bots, A).
* The faucet is cheap: 0.1 claims per bot in 4 h and 0.6-0.8 claims per bot in 24 h with 10 bots (28-41 USDC-equivalents of PLAY money across the 10 bots, which is play money by definition).
* Caveat: in set A many "bankruptcies" are cargo destroyed by truncated sales (section 2.4), so the figure is pessimistic for A and optimistic for contract semantics, where players keep goods and the problem is merchants' cash. The faucet rule as written (net worth, not cash) does what the plan asks; no change is proposed.

## 4. Question 3 - price clamp saturation and MULT_K_BP

Method: `python scripts/analysis/run_exp.py q3`. Share of time = share of (city, good, tick) samples at the end of each tick with the multiplier at its 13,500 (high) or 7,500 (low) clamp.

{{T:q3:3A}}

{{T:q3:3B-A}}

{{T:q3:3B-C}}

Reading: a higher `MULT_K_BP` narrows the unclamped band, so it cannot reduce clamp time. At the spec K=4000 the band is 12.5%-162.5% of target stock, which for spice (target 40) is 5 to 65 units and for silk (target 30) 4 to 49 units; one stock unit moves silk's price by 1.33% of base and spice's by 1% (Table 5-7). With bots in the world grain, salt and iron stay inside the band under A (0% at 5 and 10 bots), but spice and silk sit at a clamp 66-86% of the 4 hours (A, 5 bots: 60% high plus 24% low for spice, 64% plus 24% for silk). In a world with no players, every good is on a clamp 68% of the first 4 hours and 95% of 24 hours (rows with 0 bots): the clamps are a property of the production/consumption design, not of bots.

{{T:q3:3C-A}}

{{T:q3:3C-C}}

{{T:q3:3D}}

{{T:q3:3E}}

Reading:

* **K = 6000 / 8000**: median profit per trip rises (A, 5 bots: 1,432 to 2,013 to 2,861 fils; C: 2,722 to 3,298 to 3,987) but clamp time rises (spice+silk 86% to 91% to 93%; grain+salt+iron 0% to 4% to 17%, A), truncation rises (23.5% to 24.4% to 26.8% A; 35.3% to 36.1% to 38.3% C), merchants go dry more often (merchant-ticks under 20%: 2.5% to 5.4% to 14.3%, A; 19.0% to 25.8% to 29.8%, C) and trips fall (C: 130 to 120 to 103). More profit comes out of the same four treasuries, faster.
* **K = 3000**: spice+silk at a clamp 86% to 22% (A, 5 bots) and 89% to 24% (C), with median profit per trip 1,231 versus 1,432 (A) and 2,687 versus 2,722 (C), and fewer dry merchants under C (15.6% versus 19.0%). K = 2000 removes clamping entirely but 10 bots then lose money on average (mean -439 fils per trip, A).
* **Wider clamps** (3D, 6,000/15,000 at K=4000): clamp time 34% to 8% (A, 5 bots) and mean profit 76 to 663, but truncation rises (23.5% to 28.9%) and trips fall (182 to 151).
* **Larger spice/silk targets** (3E): x2 gives 86% to 74% (A, 5 bots) and 66% to 44% (A, 10 bots) at a clamp, x3 61% and 28%; economics otherwise unchanged. It costs spec changes to the goods table.

## 5. Question 4 - the first profitable trade

Three different questions are mixed in "first profitable trade in under a minute": when can the player start, when does profit appear, and how large is it. Method: `python scripts/analysis/run_q4.py`. Expected profit (EP) for a 500-dinar newcomer = one journey chosen with full knowledge of the current prices and treasuries, exact integer prices, 1% fees, ambush risk, guards chosen optimally (cost 2% of the cargo base value each, truncated), unsold goods valued at 0. EP is therefore an upper bound for a player who acts first; Table 4F is the realised outcome of a competing bot.

{{T:q4:4E}}

**Time to first profit.** The shortest journey takes 180 s, so a realised profit cannot appear in 60 s on any route. What can happen inside the first minute is the purchase and departure.

{{T:q4:4A}}

{{T:q4:4F}}

Reading: in a running world (joins at minute 60 to 180) a newcomer's median first purchase is 0 to 5 minutes after joining (0 in 8 of the 12 A/C rows), its first arrival 5-9 minutes after joining and its first profitable arrival after a median 6-11 minutes; 40-80% of first journeys are profitable under A and C. In a brand-new world (J = 0) nothing is profitable at first: all prices equal base and a round trip costs the 8% spread plus 2% fees (EP -99 fils at minute 0); the first positive EP appears after 2 minutes of world time and is small (266 fils, 1 spice), 3,777-12,353 fils (7.6-24.7%) on the short route at 10 minutes. Newcomers in the fresh world buy after a median 7 minutes and are profitable after 13-20. Under the contract semantics with unsold goods kept (last rows) the stalled market means late newcomers often never complete a journey in the next 2 hours (Table 4F: 0/10 completed at J = 120 and 180 with 10 bots), a consequence of the liquidity problem in section 2.4.

**Typical profit per trip.**

{{T:q4:4B}}

Reading: on the cheapest route (bandar-shahr, 180 s, 8% risk) the best available single journey is worth a median 9,312-17,830 fils (18.6-35.7% of the 50,000-fils capital) in 7 of 8 world types, mostly spice/silk bought where it is cheap and sold at a clamp; over all routes 11,886-29,715 fils (24-59%) and bandar-madan or bandar-dasht is usually best. That is the hindsight upper bound for the first mover; competing bots realise a median 1,432-2,722 fils per trip (2.9-5.4% of capital, Table 1B, 5 bots) and a newcomer's median first journey, joining at minute 60 or later, is between -170 and 9,905 fils (-0.3% to 19.8%) (Table 4F). Plan the UX around about 5% of capital per 3-6 minute trip as the sober figure and 20-30% as what a first-mover with the best spice/silk lane can see.

{{T:q4:4D}}

**Guards versus ambush risk.**

{{T:q4:4C}}

A guard costs 2% of the cargo base value (e.g. 800 fils for 40 grain) and removes, in expectation, 0.84% of the cargo on the shortest route; on five of six routes every guard is a pure cost, and only the first guard on madan-bandar (2.10% saved versus 2.00%) is marginally positive. The optimiser chose at least one guard in 0-20% of snapshots (Table 4B, last column). The first trip has an 8% ambush chance on the shortest route and a 22.1% chance of at least one ambush in the first three trips; with the floor rule an ambush destroys 12 of 40 units (30%) but nothing at all for a good carried in lots of 3 or fewer (Table 5-5), which is why the best "immune" bundle (Table 4D) earns about the same as the best single-good cargo. For a new player the right advice is to skip guards, and guards as designed give a risk-averse player almost nothing for 2%.

## 6. Question 5 - exploit loops and conservation

Method: `packages/shared/node_modules/.bin/tsx scripts/analysis/exploits.ts` (exhaustive, uses the real `tradeCost()`), `python scripts/analysis/run_q5.py`.

**Round trips and closed loops against one merchant.**

{{X:5-1}}

{{X:5-2}}

No loop makes money; the best is a loss of 35 fils (grain, 1 unit, spread 400, bias -1500) and the smallest loss is 4.16% of the outlay, i.e. the spread and fees always dominate the integer rounding and the midpoint-pricing asymmetry for odd quantities (one stock unit moves a price by 0.2-1.33% of base, Table 5-7, much less than the 6% a round trip costs at the minimum spread).

**Splitting a trade.**

{{X:5-3}}

Midpoint pricing is exact only while the price is linear in stock. Near the clamps it is not, so 40 one-unit trades beat one 40-unit trade in most cases: up to 0.83% cheaper on buys and 3.91% better on sells (spice at stock 40). It is not a loop (it improves one leg of an arbitrage by at most 3.91%) but it costs the relayer 40 transactions per trade. If transaction cost matters, `MAX_QTY_PER_TRADE` or a per-player rate limit bounds it.

**Merchant policy drift (D24).**

{{X:5-4}}

D24 allows 300 bp per tick. A merchant (the AI) that walks its bias upward at that rate while keeping the spread low lets any player in the city buy now and sell 2 minutes later at a profit, without travelling; with spread 800 it takes 3 ticks. The AI baseline does not do this by design, but nothing in the contract forbids it, and a persona that "raises prices when stock is low" will do it gradually.

**Ambush rounding and stall fee.**

{{X:5-5}}

{{X:5-6}}

The stall fee `ceil(2% x price)`, minimum 1 fils, cannot be evaded by splitting (0 of 19,996 cases cheaper) and is never below 2%. Two accounts can still move cash between them at the 2% price (the seller pays): with D4 (faucet when net worth is under 5,000 fils) and D5 (seller pays) one account that tops up 50,000 fils from the faucet each hour can buy a 1-grain stall priced at 49,990 fils from a second account, ending below the 5,000-fils threshold again and handing the other account 48,990 fils (fee `ceil(2% x 49,990) = 1,000` fils) per hour. That arithmetic follows from the rules, it was not simulated. In PLAY it only distorts the leaderboard; in LIVE the faucet is disabled.

**Arbitrage between two cities "forever" and operator exposure.** Players' profit comes only from the merchants' cash, because production and consumption create and destroy goods, not money. So an unbounded loop cannot exist, and the question is how much of the merchants' pool a strong player can take. Goods created per tick are valued at 143,500 fils at base prices (861 USDC-equivalent per hour), which is why arbitrage opportunities keep reappearing; the cash pool that pays for them is 200,000 fils.

{{T:q5:5B}}

{{T:q5:5A}}

Reading: in every run of Table 5A the operator's P&L stayed above -200,000 fils (worst observed -191,308, 96% of the seed, 10 players x 50,000 fils for 24 h under C), which confirms the plan's statement that the operator's maximum loss equals the merchants' treasuries. It also shows the cap is not a theoretical limit: one 20-USDC whale alone takes a mean 136,774-166,660 fils (68-83%) in 24 hours, and 5-10 ordinary greedy players take about 170,000-186,000 (C, 24 h). Operator risk is a practical number, not a remote one.

**Money conservation.** Every run asserts `merchants + house + bots' cash == start (+ faucet injections)` after every tick. Results: 1,784 runs of `run_exp.py`, 279 of `run_q4.py`, 340 of `run_q5.py`, 28 of `validate.py`; all conserved. The 25 TypeScript `runSim()` configurations checked in validation also conserved on every tick. The tables' "conserved" columns show the per-row count.

{{T:q5:5C}}

Table 5C also explains Table 3B: at the spec treasury the house caravans ship 42 silk units per 4-hour run under A and 5 under C (232 ticks blocked; 226 under A), against 613 with 200,000-fils treasuries.

## 7. Recommendations (proposals; each needs the owner's decision and a spec-v1.2)

Ranked by expected benefit divided by risk. None is applied.

| # | Proposal | Evidence | Trade-off |
|---|---|---|---|
| 1 | **Re-baseline spec 2.9 and the sim with contract semantics** (unsold goods kept, D25 ship limits, warehouse cap, no negative treasury) before freezing any parameter. No parameter change. | Tables 1G, 5D: the reference shows 23.5% truncated and healthy treasuries; contract semantics show 51-55% truncated and merchants at 8,041 of 200,000 fils (A, 5 bots). Artefact list in section 1. | Costs sim work only. Without it, every tuning decision rests on a model that hides the main risk. |
| 2 | **Make spice and silk shippable and keep merchants liquid.** Options: (a) let `ship` and house caravans pay from the `house` balance or in partial units whenever one unit is affordable (today silk needs about 60,000 fils for 4 units, above a 50,000 treasury and far above the 12,500-fils 25% budget); (b) raise the D25 budget from 25% to 50% for goods whose single-unit mid exceeds it; (c) a small recurring top-up of merchants from the house (it already recycles 10% of its balance) funded by a higher trade fee. | Table 5C (silk shipped 5 per run, C), Table 3B (spice/silk on a clamp 66-86%), Table 1F (units barely matter once the budget binds). | (a)-(b) weaken the 25% drain protection of audit finding 6 (a compromised merchant key could drain more per tick); (c) raises player costs. Tuning must be re-run under proposal 1. |
| 3 | **`MULT_K_BP` 4000 to 3000 (or 3500).** Do **not** raise it to 6000/8000. | Tables 3C-A, 3C-C: K=3000 gives spice+silk at a clamp 22-24% instead of 86-89% with the same median profit per trip (1,231 vs 1,432 A; 2,687 vs 2,722 C); K=6000/8000 raises profit but increases clamp time, truncation and dry merchants. | Price band shrinks to 75%-130% of base at K=3000, so a little less price signal for the UI and the AI; the golden vectors (spec 2.7) and the contract constant change. |
| 4 | **Keep treasuries at 50,000 fils; do not raise them to fix "merchant broke".** If more headroom is wanted for a demo with LIVE money, 75,000 fils (30 USDC risk) is the most that the data supports. | Table 1C-A/1C-C: 4x treasury gives -11 percentage points truncation and 3.7x the worst-case loss; A's 200k row removes the profit. | None to keep. A bigger treasury raises operator risk linearly (Table 5A: the seed is nearly consumed anyway). |
| 5 | **Fix the first-minute UX goal.** Reword it as "first purchase and departure in under a minute, first realised profit within 5-6 minutes", show projected profit when the player picks a route, and (optional, spec change) add a first-journey-only intro route of 60 s with no ambush risk. | Table 4E (180 s minimum), 4F (median 0-3 min to first purchase in a running world; 6-11 min to first profitable arrival), 4A (fresh world has no price gaps: first positive trade at minute 2, small until about minute 10). | Intro route is new content and a new special case in the contract; the rewording costs nothing. |
| 6 | **Re-price guards**: `GUARD_COST_BP` 200 to 50-100, or `GUARD_RISK_FACTOR_BP` 6500 to about 4000, or `ceil` loss with a minimum of 1 unit. | Table 4C: with today's numbers a guard only pays on madan-bandar; Table 5-5: nothing is lost in lots of 3 or fewer. | Changing the loss rule re-opens D1 (floor) of spec-v1.1; cheaper guards reduce `house` income that funds recycling. |
| 7 | **Raise spice and silk target stock x2** (80/60, cap 160/120) if proposal 3 is rejected. | Table 3E: spice+silk at a clamp 86% to 74% (A, 5 bots), 66% to 44% (A, 10 bots). | Weaker effect than proposal 3, changes the goods table and golden vectors, doubles the goods needed to move price. |
| 8 | **Keep the faucet rule** (net worth under 5,000 fils, 1 h cooldown) and the rebalance (30%) and recycle (10%) percentages. | Tables 2A (39% to 0% of bots under 50 dinars after 24 h with 10 bots, A), 1D, 1E (switching either off raises dry merchants from 2.5% to 40.7% or 8.9%). | None. |
| 9 | **Close small leaks** (any order): a worker-side rule that the AI never moves bias in one direction for more than one tick in a row (or lower the D24 step from 300 to 100 bp); optionally rate-limit trades per player per minute; optionally make a trade priced by the sum of unit prices instead of the midpoint. | Tables 5-4 (profitable after 2 ticks), 5-3 (up to 3.91% from splitting). | Slower policy response for the AI; extra contract complexity for the pricing change. |

Not recommended: more or fewer house caravan units (Table 1F: profit falls with units, truncation does not), wider clamps alone (Table 3D: fewer trips, more truncation), and changing the 1% fee or spread without first fixing liquidity (the 1% fee funds the only inflow to merchants other than purchases).

## 8. How to reproduce

From the repository root (Python 3.12, Node 20+, `pnpm install` done):

```
python scripts/analysis/validate.py        # section 1 (about 20 s)
python scripts/analysis/run_exp.py         # tables 1x, 2x, 3x (about 5 min)
python scripts/analysis/run_q4.py          # tables 4x (about 1 min)
python scripts/analysis/run_q5.py          # tables 5A-5D (about 3 min)
packages/shared/node_modules/.bin/tsx scripts/analysis/exploits.ts > scripts/analysis/results/q5_exploits.txt
python scripts/analysis/build_doc.py       # regenerates this file
```

`pnpm sim --bots 5 --ticks 240 --seed 7` prints the reference row that the variant reproduces (177 trips, median 1,088, 43 broke).

## 9. Limits of this evidence

* Greedy bots are neither humans nor the LLM merchants. Treat percentages as ranges and signs as the finding.
* Rule set C models D25 from the decision log, not the Rust code; D1-D3 are validated against the CHANGELOG.
* The merchants' own policy (spread and bias set by the AI) is fixed at the default 800 bp spread and bias 0 in all runs, as in the reference sim. A policy that raises the spread when poor would change Q1.
* Expected-profit figures in Question 4 assume the newcomer acts alone on the current snapshot; Table 4F is the competing-bot counterpart.
* The worst case of Question 5 uses bots that never withdraw or stop; real players can leave with the cash, which only makes the operator's loss permanent.
