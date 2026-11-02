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

```
== 1. Python variant (default Cfg) vs scripts/ref/economy_sim.py, and 2. vs TypeScript runSim ==
python-variant == python-reference: 25/25 configs; python-variant == TypeScript runSim: 25/25 configs
== 3. contract_d123() vs spec/CHANGELOG.md spec-v1.1 numbers (seed 7, 240 ticks) ==
  OK  bots=2: changelog 61/6714/26  variant 61/6714/26  conserved=True
  OK  bots=5: changelog 132/933/44  variant 132/933/44  conserved=True
  OK  bots=10: changelog 344/958/74  variant 344/958/74  conserved=True
VALIDATION PASSED
```

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

**Table 1A-A. Truncated sales per run, Appendix B (`pnpm sim`), 240 ticks**

| bots | seed | trips | cargo sales | truncated (= 'broke') | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip (fils) | merchant-ticks with treasury < 20% | overdrafts | warehouse-cap hits | money conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 7 | 64 | 64 | 23 | 35.9% | 21.5% | 12,569 / 2,391 | 5,944 | 16.4% | 5 | 0 | yes |
| 2 | 11 | 79 | 79 | 21 | 26.6% | 18.0% | 8,585 / 771 | 3,138 | 8.4% | 1 | 0 | yes |
| 2 | 13 | 86 | 85 | 26 | 30.6% | 23.0% | 11,484 / 1,248 | 5,538 | 5.0% | 3 | 0 | yes |
| 5 | 7 | 177 | 176 | 43 | 24.4% | 22.7% | 7,574 / -339 | 1,088 | 2.7% | 2 | 0 | yes |
| 5 | 11 | 173 | 169 | 37 | 21.9% | 20.0% | 7,614 / 302 | 1,388 | 2.6% | 0 | 0 | yes |
| 5 | 13 | 186 | 184 | 44 | 23.9% | 23.3% | 7,701 / -50 | 1,336 | 1.9% | 0 | 0 | yes |
| 10 | 7 | 342 | 337 | 86 | 25.5% | 25.8% | 8,641 / -262 | 1,099 | 3.4% | 2 | 0 | yes |
| 10 | 11 | 326 | 318 | 62 | 19.5% | 23.0% | 6,557 / -29 | 743 | 4.1% | 0 | 0 | yes |
| 10 | 13 | 342 | 333 | 57 | 17.1% | 22.7% | 5,742 / -448 | 675 | 2.8% | 0 | 0 | yes |

**Table 1A-C. Truncated sales per run, contract rules (D1-D3, D25 ship limits, warehouse cap), 240 ticks**

| bots | seed | trips | cargo sales | truncated (= 'broke') | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip (fils) | merchant-ticks with treasury < 20% | overdrafts | warehouse-cap hits | money conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 7 | 26 | 26 | 6 | 23.1% | 14.0% | 12,760 / 6,005 | 7,225 | 32.6% | 1 | 0 | yes |
| 2 | 11 | 43 | 43 | 6 | 14.0% | 6.8% | 5,831 / 3,085 | 3,138 | 21.1% | 0 | 0 | yes |
| 2 | 13 | 30 | 30 | 10 | 33.3% | 15.2% | 11,845 / 4,928 | 5,419 | 32.0% | 0 | 0 | yes |
| 5 | 7 | 127 | 127 | 49 | 38.6% | 23.5% | 12,534 / 1,227 | 2,499 | 17.2% | 4 | 0 | yes |
| 5 | 11 | 181 | 181 | 58 | 32.0% | 21.3% | 9,180 / 804 | 2,278 | 4.9% | 1 | 0 | yes |
| 5 | 13 | 122 | 122 | 39 | 32.0% | 21.6% | 9,497 / 1,467 | 2,178 | 34.3% | 4 | 0 | yes |
| 10 | 7 | 307 | 307 | 80 | 26.1% | 25.5% | 9,102 / 381 | 1,218 | 5.6% | 1 | 0 | yes |
| 10 | 11 | 320 | 320 | 77 | 24.1% | 23.7% | 8,090 / 336 | 1,492 | 7.7% | 0 | 0 | yes |
| 10 | 13 | 333 | 333 | 81 | 24.3% | 27.3% | 10,619 / 422 | 1,106 | 2.7% | 2 | 0 | yes |

**Table 1B. Ten-seed means (seeds 7, 11, 13, 17, 19, 23, 29, 31, 37, 41), 240 ticks**

| rules | bots | trips | cargo sales | truncated | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip (fils) | mean profit/trip (fils) | merchant-ticks < 20% treasury | overdrafts | warehouse hits | conserved runs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 2 | 68.7 | 68.1 | 20.4 | 30.0% (sd 4.8%) | 19.2% | 9,355 / 1,444 | 4,231 | 1,431 | 13.3% | 2.1 | 0.0 | 10/10 |
| A | 5 | 181.6 | 179.2 | 42.2 | 23.5% (sd 2.0%) | 21.7% | 7,794 / 77 | 1,432 | 76 | 2.5% | 1.0 | 0.0 | 10/10 |
| A | 10 | 334.9 | 328.0 | 66.6 | 20.3% (sd 2.2%) | 23.5% | 6,868 / -25 | 857 | -24 | 3.5% | 1.1 | 0.0 | 10/10 |
| C | 2 | 33.8 | 33.8 | 9.3 | 27.5% (sd 7.0%) | 13.9% | 10,832 / 4,304 | 4,630 | 4,304 | 26.8% | 0.4 | 0.0 | 10/10 |
| C | 5 | 130.4 | 130.4 | 46.0 | 35.3% (sd 4.4%) | 23.2% | 11,115 / 1,074 | 2,722 | 1,074 | 19.0% | 4.1 | 0.0 | 10/10 |
| C | 10 | 307.7 | 307.7 | 80.6 | 26.2% (sd 2.3%) | 25.2% | 9,559 / 452 | 1,378 | 452 | 8.4% | 1.9 | 0.0 | 10/10 |

Reading: at the spec treasury, 17-39% of single-seed cargo sales are truncated (mean 20-35%) and the merchant's inability to pay removes 14-25% of the sale revenue (means). A typical cargo would earn 6,900-11,100 fils if the merchant could pay (14-22% of a 50,000-fils capital) but realises -25 to 4,300 fils on average. The share does not fall as bots are added (30.0%, 23.5%, 20.3% under A): the loss is a per-sale ceiling, not only a crowding effect. A single merchant treasury of 50,000 fils caps one visit's revenue at 500 dinars; a 40-unit cargo of silk is worth 800,000 fils at base.

### 2.2 Sensitivity to treasury size (operator risk grows with it)

Operator seed capital = 4 x treasury (LIVE cap today: 4 x 5 USDC = 20 USDC). "Operator P&L" = merchants' cash plus house balance minus 4 x treasury.

**Table 1C-A. Merchant treasury sweep, Appendix B (`pnpm sim`), 10-seed means, 240 ticks (bot start cash stays 50,000)**

| bots | treasury per merchant (fils) | operator seed capital (USDC) | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | operator P&L at end (fils, mean) | worst operator P&L seen (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 50,000 | 20 | 42.2 | 23.5% | 21.7% | 7,794 / 77 | 1,432 | 76 | 2.5% | 106,875 | -87,498 | 10/10 |
| 5 | 75,000 | 30 | 39.8 | 23.3% | 20.9% | 8,789 / 459 | 1,658 | 454 | 5.1% | -16,500 | -182,057 | 10/10 |
| 5 | 100,000 | 40 | 35.3 | 20.8% | 19.6% | 8,722 / 836 | 1,876 | 825 | 7.3% | -17,858 | -229,365 | 10/10 |
| 5 | 150,000 | 60 | 35.7 | 19.8% | 19.2% | 9,476 / 1,026 | 2,429 | 1,011 | 8.0% | -70,998 | -323,219 | 10/10 |
| 5 | 200,000 | 80 | 3.0 | 1.6% | 1.3% | 706 / 304 | 1,497 | 297 | 2.0% | 46,540 | -148,238 | 10/10 |
| 10 | 50,000 | 20 | 66.6 | 20.3% | 23.5% | 6,868 / -25 | 857 | -24 | 3.5% | 123,711 | -53,273 | 10/10 |
| 10 | 75,000 | 30 | 63.9 | 19.2% | 23.2% | 7,648 / 24 | 1,186 | 24 | 5.7% | 130,576 | -105,968 | 10/10 |
| 10 | 100,000 | 40 | 55.8 | 16.7% | 20.3% | 6,782 / 243 | 1,078 | 238 | 6.4% | 78,702 | -183,829 | 10/10 |
| 10 | 150,000 | 60 | 10.5 | 3.1% | 2.8% | 544 / -172 | 1,158 | -167 | 2.7% | 189,334 | -58,870 | 10/10 |
| 10 | 200,000 | 80 | 1.5 | 0.5% | 0.4% | -54 / -145 | 1,084 | -140 | 1.1% | 186,041 | -120,334 | 10/10 |

**Table 1C-C. Merchant treasury sweep, contract rules (D1-D3, D25 ship limits, warehouse cap), 10-seed means, 240 ticks (bot start cash stays 50,000)**

| bots | treasury per merchant (fils) | operator seed capital (USDC) | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | operator P&L at end (fils, mean) | worst operator P&L seen (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 50,000 | 20 | 46.0 | 35.3% | 23.2% | 11,115 / 1,074 | 2,722 | 1,074 | 19.0% | -69,892 | -179,029 | 10/10 |
| 5 | 75,000 | 30 | 36.9 | 29.4% | 20.5% | 11,038 / 1,894 | 2,392 | 1,894 | 26.2% | -185,320 | -281,302 | 10/10 |
| 5 | 100,000 | 40 | 39.2 | 26.9% | 20.3% | 12,895 / 2,085 | 2,841 | 2,085 | 20.4% | -248,450 | -367,713 | 10/10 |
| 5 | 150,000 | 60 | 37.2 | 24.3% | 20.2% | 14,649 / 2,263 | 3,339 | 2,263 | 16.1% | -230,466 | -537,211 | 10/10 |
| 5 | 200,000 | 80 | 36.1 | 23.9% | 19.2% | 16,251 / 3,610 | 3,624 | 3,610 | 15.6% | -353,271 | -669,258 | 10/10 |
| 10 | 50,000 | 20 | 80.6 | 26.2% | 25.2% | 9,559 / 452 | 1,378 | 452 | 8.4% | 14,724 | -169,696 | 10/10 |
| 10 | 75,000 | 30 | 79.6 | 26.3% | 24.5% | 10,505 / 721 | 1,467 | 721 | 11.3% | -57,074 | -274,607 | 10/10 |
| 10 | 100,000 | 40 | 75.0 | 25.3% | 24.8% | 11,100 / 876 | 1,571 | 876 | 17.1% | -120,457 | -382,683 | 10/10 |
| 10 | 150,000 | 60 | 74.6 | 24.8% | 24.4% | 12,511 / 1,060 | 1,886 | 1,060 | 14.7% | -121,666 | -403,761 | 10/10 |
| 10 | 200,000 | 80 | 69.1 | 23.1% | 23.1% | 13,094 / 1,559 | 2,156 | 1,559 | 15.1% | -237,238 | -580,434 | 10/10 |

Reading: under the contract rules (C) 4x the treasury (50k to 200k) cuts the truncated share only from 35.3% to 23.9% and lost revenue from 23.2% to 19.2%, because players grow richer in step (mean profit per trip 1,074 to 3,610 fils) and drain whatever is there; the worst operator loss rises from 179,029 to 669,258 fils (90% of a 200k seed at 50k; 84% of an 800k seed at 200k). Under A the 200k row looks "fixed" (1.6% truncated) but only because the profit disappears too (potential profit per sale 706 versus 7,794 at 50k): at 200k the house caravans can finally pay for silk and spice (Table 5C) and compete the arbitrage away. At 75k and 100k the improvement is small (23.5% to 23.3% and 20.8% truncated, A, 5 bots). **Larger treasuries mean more operator risk for little relief.**

### 2.3 REBALANCE_PCT, HOUSE_RECYCLE_PCT, NPC ship units

**Table 1D-A. REBALANCE_PCT sweep (0 = rebalancing off, other NPC steps on), Appendix B (`pnpm sim`), 10-seed means, 240 ticks**

| bots | rebal_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 118.8 | 32.8 | 28.3% | 20.1% | 8,767 / 1,060 | 2,295 | 1,033 | 40.7% | 10/10 |
| 5 | 10 | 173.9 | 37.8 | 22.0% | 18.3% | 6,290 / 451 | 1,436 | 444 | 8.8% | 10/10 |
| 5 | 30 | 181.6 | 42.2 | 23.5% | 21.7% | 7,794 / 77 | 1,432 | 76 | 2.5% | 10/10 |
| 5 | 50 | 176.6 | 39.9 | 22.9% | 21.0% | 7,836 / 297 | 1,690 | 293 | 3.1% | 10/10 |
| 5 | 100 | 164.6 | 39.1 | 24.1% | 21.2% | 8,135 / 419 | 1,940 | 413 | 8.8% | 10/10 |
| 10 | 0 | 264.1 | 59.5 | 23.2% | 18.7% | 5,934 / 140 | 691 | 136 | 25.2% | 10/10 |
| 10 | 10 | 317.4 | 64.6 | 20.7% | 23.8% | 6,332 / -234 | 748 | -231 | 3.8% | 10/10 |
| 10 | 30 | 334.9 | 66.6 | 20.3% | 23.5% | 6,868 / -25 | 857 | -24 | 3.5% | 10/10 |
| 10 | 50 | 327.3 | 65.0 | 20.2% | 22.4% | 7,154 / 64 | 1,038 | 63 | 3.4% | 10/10 |
| 10 | 100 | 348.6 | 38.6 | 11.3% | 11.6% | 2,842 / -248 | 1,016 | -242 | 2.6% | 10/10 |

**Table 1D-C. REBALANCE_PCT sweep (0 = rebalancing off, other NPC steps on), contract rules (D1-D3, D25 ship limits, warehouse cap), 10-seed means, 240 ticks**

| bots | rebal_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 97.8 | 31.5 | 32.2% | 19.0% | 8,875 / 1,776 | 2,716 | 1,776 | 43.8% | 10/10 |
| 5 | 10 | 100.9 | 32.5 | 32.2% | 20.1% | 9,223 / 1,618 | 2,482 | 1,618 | 36.7% | 10/10 |
| 5 | 30 | 130.4 | 46.0 | 35.3% | 23.2% | 11,115 / 1,074 | 2,722 | 1,074 | 19.0% | 10/10 |
| 5 | 50 | 150.0 | 52.1 | 34.7% | 23.8% | 11,410 / 875 | 2,920 | 875 | 11.8% | 10/10 |
| 5 | 100 | 163.1 | 63.5 | 38.9% | 24.6% | 12,645 / 619 | 3,032 | 619 | 7.2% | 10/10 |
| 10 | 0 | 315.6 | 75.9 | 24.0% | 20.7% | 7,026 / 430 | 1,135 | 430 | 21.1% | 10/10 |
| 10 | 10 | 303.2 | 75.9 | 25.0% | 23.9% | 8,346 / 332 | 1,067 | 332 | 9.9% | 10/10 |
| 10 | 30 | 307.7 | 80.6 | 26.2% | 25.2% | 9,559 / 452 | 1,378 | 452 | 8.4% | 10/10 |
| 10 | 50 | 303.3 | 84.1 | 27.7% | 25.6% | 10,384 / 560 | 1,508 | 560 | 8.2% | 10/10 |
| 10 | 100 | 303.1 | 89.9 | 29.7% | 25.5% | 10,702 / 598 | 1,656 | 598 | 9.3% | 10/10 |

**Table 1E-A. HOUSE_RECYCLE_PCT sweep (0 = recycling off), Appendix B (`pnpm sim`), 10-seed means, 240 ticks**

| bots | house_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 172.7 | 41.9 | 24.7% | 20.1% | 6,673 / 93 | 1,513 | 91 | 8.9% | 10/10 |
| 5 | 5 | 177.5 | 41.4 | 23.7% | 19.7% | 7,244 / 349 | 1,579 | 344 | 4.1% | 10/10 |
| 5 | 10 | 181.6 | 42.2 | 23.5% | 21.7% | 7,794 / 77 | 1,432 | 76 | 2.5% | 10/10 |
| 5 | 25 | 172.7 | 42.9 | 25.1% | 21.0% | 8,112 / 326 | 1,628 | 323 | 4.6% | 10/10 |
| 5 | 50 | 176.5 | 42.9 | 24.5% | 21.4% | 8,366 / 246 | 1,784 | 244 | 3.2% | 10/10 |
| 10 | 0 | 332.5 | 69.6 | 21.4% | 24.2% | 6,615 / -335 | 840 | -328 | 3.7% | 10/10 |
| 10 | 5 | 333.0 | 67.7 | 20.7% | 23.9% | 7,099 / -122 | 918 | -119 | 4.0% | 10/10 |
| 10 | 10 | 334.9 | 66.6 | 20.3% | 23.5% | 6,868 / -25 | 857 | -24 | 3.5% | 10/10 |
| 10 | 25 | 331.5 | 66.4 | 20.4% | 23.6% | 7,080 / 27 | 942 | 26 | 3.5% | 10/10 |
| 10 | 50 | 335.2 | 71.0 | 21.7% | 24.8% | 7,849 / -140 | 934 | -137 | 3.6% | 10/10 |

**Table 1E-C. HOUSE_RECYCLE_PCT sweep (0 = recycling off), contract rules (D1-D3, D25 ship limits, warehouse cap), 10-seed means, 240 ticks**

| bots | house_pct | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 112.3 | 39.1 | 34.8% | 23.3% | 9,771 / 940 | 2,608 | 940 | 33.0% | 10/10 |
| 5 | 5 | 129.0 | 45.4 | 35.2% | 23.6% | 11,566 / 1,116 | 2,949 | 1,116 | 18.8% | 10/10 |
| 5 | 10 | 130.4 | 46.0 | 35.3% | 23.2% | 11,115 / 1,074 | 2,722 | 1,074 | 19.0% | 10/10 |
| 5 | 25 | 141.6 | 50.0 | 35.3% | 23.5% | 11,230 / 1,023 | 2,930 | 1,023 | 14.6% | 10/10 |
| 5 | 50 | 136.5 | 45.5 | 33.3% | 22.7% | 10,669 / 1,176 | 2,736 | 1,176 | 20.9% | 10/10 |
| 10 | 0 | 305.0 | 86.4 | 28.3% | 26.0% | 9,045 / 58 | 1,248 | 58 | 12.9% | 10/10 |
| 10 | 5 | 302.8 | 81.2 | 26.8% | 25.6% | 10,138 / 412 | 1,378 | 412 | 8.7% | 10/10 |
| 10 | 10 | 307.7 | 80.6 | 26.2% | 25.2% | 9,559 / 452 | 1,378 | 452 | 8.4% | 10/10 |
| 10 | 25 | 289.1 | 77.3 | 26.7% | 25.3% | 9,724 / 493 | 1,159 | 493 | 11.5% | 10/10 |
| 10 | 50 | 280.4 | 73.3 | 26.1% | 24.7% | 9,669 / 527 | 1,262 | 527 | 13.0% | 10/10 |

**Table 1F-A. NPC_SHIP_UNITS_PER_TICK sweep (0 = no house caravans), Appendix B (`pnpm sim`), 10-seed means, 240 ticks**

| bots | ship_units | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 156.9 | 51.8 | 33.3% | 22.3% | 10,807 / 925 | 3,421 | 917 | 18.4% | 10/10 |
| 5 | 2 | 183.0 | 49.5 | 27.4% | 18.7% | 7,630 / 795 | 2,240 | 784 | 13.5% | 10/10 |
| 5 | 4 | 181.6 | 42.2 | 23.5% | 21.7% | 7,794 / 77 | 1,432 | 76 | 2.5% | 10/10 |
| 5 | 8 | 145.2 | 37.8 | 26.5% | 26.4% | 9,938 / 184 | 787 | 181 | 8.0% | 10/10 |
| 5 | 16 | 124.4 | 34.9 | 28.6% | 25.9% | 11,018 / 910 | 1,827 | 892 | 17.0% | 10/10 |
| 10 | 0 | 338.9 | 90.9 | 27.2% | 21.7% | 9,966 / 381 | 2,120 | 375 | 6.1% | 10/10 |
| 10 | 2 | 351.7 | 72.5 | 20.9% | 19.5% | 6,896 / 50 | 1,568 | 49 | 3.6% | 10/10 |
| 10 | 4 | 334.9 | 66.6 | 20.3% | 23.5% | 6,868 / -25 | 857 | -24 | 3.5% | 10/10 |
| 10 | 8 | 310.8 | 74.1 | 24.2% | 28.6% | 10,641 / -110 | 670 | -108 | 3.3% | 10/10 |
| 10 | 16 | 278.4 | 67.9 | 24.7% | 29.0% | 11,125 / 47 | 446 | 47 | 6.8% | 10/10 |

**Table 1F-C. NPC_SHIP_UNITS_PER_TICK sweep (0 = no house caravans), contract rules (D1-D3, D25 ship limits, warehouse cap), 10-seed means, 240 ticks**

| bots | ship_units | trips | truncated sales | truncated share | net revenue lost | profit per cargo sale (fils): if merchant always paid / actual | median profit/trip | mean profit/trip | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 0 | 145.7 | 51.1 | 35.1% | 24.0% | 11,983 / 1,019 | 4,417 | 1,019 | 20.9% | 10/10 |
| 5 | 2 | 158.5 | 54.1 | 34.1% | 22.9% | 11,578 / 855 | 3,449 | 855 | 12.8% | 10/10 |
| 5 | 4 | 130.4 | 46.0 | 35.3% | 23.2% | 11,115 / 1,074 | 2,722 | 1,074 | 19.0% | 10/10 |
| 5 | 8 | 129.2 | 48.1 | 37.2% | 25.6% | 11,578 / 1,097 | 2,769 | 1,097 | 16.3% | 10/10 |
| 5 | 16 | 99.4 | 37.4 | 37.6% | 25.1% | 12,124 / 1,532 | 2,958 | 1,532 | 25.5% | 10/10 |
| 10 | 0 | 318.8 | 90.3 | 28.3% | 23.6% | 11,045 / 528 | 2,352 | 528 | 13.9% | 10/10 |
| 10 | 2 | 324.8 | 88.6 | 27.3% | 23.0% | 9,760 / 425 | 1,891 | 425 | 10.1% | 10/10 |
| 10 | 4 | 307.7 | 80.6 | 26.2% | 25.2% | 9,559 / 452 | 1,378 | 452 | 8.4% | 10/10 |
| 10 | 8 | 289.8 | 82.4 | 28.4% | 27.7% | 10,863 / 507 | 1,237 | 507 | 8.1% | 10/10 |
| 10 | 16 | 289.7 | 84.5 | 29.2% | 28.6% | 11,343 / 342 | 918 | 342 | 7.1% | 10/10 |

Reading:

* **REBALANCE_PCT**: switching it off is clearly bad (merchant-ticks under 20% jump to 40.7% from 2.5%, A, 5 bots; 43.8% from 19.0%, C). Between 10 and 100 there is no robust winner: A, 10 bots improves at 100 (truncated 20.3% to 11.3%) but C gets worse (26.2% to 29.7%), and the improvement under A coincides with the potential profit per sale falling from 6,868 to 2,842. Keep 30 or move to 50 at most.
* **HOUSE_RECYCLE_PCT**: off versus on matters for liquidity (merchant-ticks under 20%: 8.9% at 0 versus 2.5-4.6% at 5-50, A, 5 bots; 33.0% versus 14.6-20.9%, C), but the fee pool is small so percentages from 5 to 50 are indistinguishable. Keep 10.
* **NPC_SHIP_UNITS**: more shipping does **not** reduce truncation (A, 5 bots: 33.3% at 0, 23.5% at 4, 28.6% at 16) and it competes the players' profit away: the median profit per trip falls from 3,421 (no shipping) to 1,432 (4) to 787 (8) fils. Under C the quantity hardly matters because the 25% budget binds first (Table 5C).

### 2.4 What the contract does with the unsold goods

**Table 1G. What happens to the unsold part of a truncated cargo (10-seed means, 240 ticks)**

| rules | bots | policy | trips | truncated sales | truncated share | units unsold per run | median profit/trip | mean profit/trip | total bot net worth at end (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 5 | unsold goods destroyed (reference) | 181.6 | 42.2 | 23.5% | 117 | 1,432 | 76 | 280,475 | 10/10 |
| A | 5 | keeps unsold goods | 62.9 | 51.0 | 51.1% | 318 | 5,151 | 5,171 | 513,600 | 10/10 |
| A | 10 | unsold goods destroyed (reference) | 334.9 | 66.6 | 20.3% | 139 | 857 | -24 | 510,089 | 10/10 |
| A | 10 | keeps unsold goods | 138.9 | 117.4 | 52.0% | 586 | 4,817 | 4,749 | 906,753 | 10/10 |
| C | 5 | unsold goods destroyed (reference) | 130.4 | 46.0 | 35.3% | 276 | 2,722 | 1,074 | 398,192 | 10/10 |
| C | 5 | keeps unsold goods | 45.8 | 43.7 | 52.0% | 252 | 6,152 | 7,616 | 584,515 | 10/10 |
| C | 10 | unsold goods destroyed (reference) | 307.7 | 80.6 | 26.2% | 293 | 1,378 | 452 | 664,076 | 10/10 |
| C | 10 | keeps unsold goods | 101.3 | 110.3 | 54.5% | 572 | 5,590 | 6,975 | 1,143,940 | 10/10 |

**Table 5D. Cash location at the end of 240 ticks, 10-seed means (merchant seed capital 200,000; bots start with 50,000 each)**

| rules | bots | policy for the unsold part of a truncated cargo | trips | sum of merchant treasuries (fils) | lowest single treasury seen (mean) | merchant-ticks < 20% of seed | operator P&L (merchants + house - 200,000) | bots' cash (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|
| A (Appendix B) | 5 | unsold destroyed (reference) | 182 | 303,072 | -24 | 2.5% | 106,875 | 143,125 | 10/10 |
| A (Appendix B) | 5 | unsold kept by the player | 63 | 8,041 | 115 | 63.8% | -191,950 | 441,950 | 10/10 |
| A (Appendix B) | 10 | unsold destroyed (reference) | 335 | 318,229 | 17 | 3.5% | 123,711 | 376,289 | 10/10 |
| A (Appendix B) | 10 | unsold kept by the player | 139 | 3,488 | -79 | 63.6% | -196,503 | 696,503 | 10/10 |
| C (contract rules) | 5 | unsold destroyed (reference) | 130 | 127,517 | -322 | 19.0% | -69,892 | 319,892 | 10/10 |
| C (contract rules) | 5 | unsold kept by the player | 46 | 10,526 | -6 | 72.0% | -189,465 | 439,465 | 10/10 |
| C (contract rules) | 10 | unsold destroyed (reference) | 308 | 207,406 | -128 | 8.4% | 14,724 | 485,276 | 10/10 |
| C (contract rules) | 10 | unsold kept by the player | 101 | 4,101 | -45 | 73.9% | -195,890 | 695,890 | 10/10 |

Reading: when the player keeps the goods (the contract behaviour), more than half of all sales are truncated (51-55%), only a third as many trips are completed, the merchants end the 4 hours holding 3,488-10,526 fils of their 200,000 (64-74% of merchant-ticks under 20%), and the greedy players hold the cash (442k-696k) and unsellable goods. The market stalls rather than the merchants "staying broke for a while". The reference sim looks healthier only because destroying the unsold goods happens to leave the merchant's cash in place. Humans will behave less mechanically than these bots (they will buy more and sell elsewhere), but the direction, cash flowing from the four merchants to the players until the merchants cannot pay, follows from conservation of money and the arbitrage design, not from the bot's stupidity.

### 2.5 Q1 summary

* About a quarter to a third of sales are cut short at today's parameters, losing roughly a fifth of sale revenue; with contract semantics the economy also loses most of its liquidity within hours.
* Treasury size, rebalancing, recycling and ship units are weak levers; what pays out the merchants is the arbitrage itself. The levers that matter are the ones that change how much cash the arbitrage can pull out of a single merchant (price slope, clamps, goods that can be shipped at all: see section 4).

## 3. Question 2 - wealth concentration and bankruptcies

Method: `python scripts/analysis/run_exp.py q2`. Faucet rule modelled as in the contract (D4): a bot whose net worth (cash plus goods at base, cargo included) is under 5,000 fils may claim +50,000 fils, cooldown 60 ticks (1 h). Money check is "start + injected". Gini uses the standard definition on final net worth (the maximum for n bots is (n-1)/n).

**Table 2A. Gini of final bot net worth and bots under 50 dinars, 10-seed means**

| rules | ticks | bots | PLAY faucet rule | Gini of final net worth | bots < 50 dinars at the end | share of bot-ticks < 50 dinars | faucet claims per bot | money injected (USDC-equivalent per run) | mean bot net worth at end (fils) | conserved (start + injected) |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 240 (4 h) | 2 | no faucet | 0.23 | 5% | 1.3% | 0.0 | 0.0 | 105,561 | 10/10 |
| A | 240 (4 h) | 2 | faucet on | 0.20 | 0% | 0.2% | 0.1 | 1.0 | 110,236 | 10/10 |
| A | 240 (4 h) | 5 | no faucet | 0.35 | 0% | 0.3% | 0.0 | 0.0 | 56,095 | 10/10 |
| A | 240 (4 h) | 5 | faucet on | 0.31 | 0% | 0.2% | 0.1 | 2.0 | 61,182 | 10/10 |
| A | 240 (4 h) | 10 | no faucet | 0.50 | 11% | 3.4% | 0.0 | 0.0 | 51,009 | 10/10 |
| A | 240 (4 h) | 10 | faucet on | 0.47 | 1% | 0.1% | 0.1 | 4.5 | 53,312 | 10/10 |
| A | 1440 (24 h) | 2 | no faucet | 0.22 | 5% | 4.0% | 0.0 | 0.0 | 137,761 | 10/10 |
| A | 1440 (24 h) | 2 | faucet on | 0.17 | 0% | 0.0% | 0.1 | 1.5 | 143,967 | 10/10 |
| A | 1440 (24 h) | 5 | no faucet | 0.41 | 20% | 10.8% | 0.0 | 0.0 | 65,378 | 10/10 |
| A | 1440 (24 h) | 5 | faucet on | 0.37 | 0% | 0.1% | 0.5 | 12.5 | 74,772 | 10/10 |
| A | 1440 (24 h) | 10 | no faucet | 0.59 | 39% | 19.2% | 0.0 | 0.0 | 50,308 | 10/10 |
| A | 1440 (24 h) | 10 | faucet on | 0.41 | 0% | 0.1% | 0.8 | 41.0 | 59,095 | 10/10 |
| C | 240 (4 h) | 2 | no faucet | 0.08 | 0% | 0.0% | 0.0 | 0.0 | 122,736 | 10/10 |
| C | 240 (4 h) | 2 | faucet on | 0.08 | 0% | 0.0% | 0.0 | 0.0 | 122,736 | 10/10 |
| C | 240 (4 h) | 5 | no faucet | 0.27 | 2% | 3.3% | 0.0 | 0.0 | 79,638 | 10/10 |
| C | 240 (4 h) | 5 | faucet on | 0.25 | 0% | 0.2% | 0.1 | 2.5 | 83,681 | 10/10 |
| C | 240 (4 h) | 10 | no faucet | 0.40 | 4% | 1.7% | 0.0 | 0.0 | 66,408 | 10/10 |
| C | 240 (4 h) | 10 | faucet on | 0.36 | 1% | 0.1% | 0.1 | 5.5 | 73,507 | 10/10 |
| C | 1440 (24 h) | 2 | no faucet | 0.08 | 0% | 0.0% | 0.0 | 0.0 | 122,736 | 10/10 |
| C | 1440 (24 h) | 2 | faucet on | 0.08 | 0% | 0.0% | 0.0 | 0.0 | 122,736 | 10/10 |
| C | 1440 (24 h) | 5 | no faucet | 0.29 | 4% | 3.6% | 0.0 | 0.0 | 84,023 | 10/10 |
| C | 1440 (24 h) | 5 | faucet on | 0.25 | 0% | 0.0% | 0.1 | 3.5 | 90,794 | 10/10 |
| C | 1440 (24 h) | 10 | no faucet | 0.44 | 13% | 10.0% | 0.0 | 0.0 | 68,598 | 10/10 |
| C | 1440 (24 h) | 10 | faucet on | 0.33 | 0% | 0.1% | 0.6 | 28.0 | 93,998 | 10/10 |

**Table 2B. Per-seed final net worth (fils), Appendix B rules, 5 bots, 240 ticks**

| rule | seed | final net worth, richest first | Gini | bots < 5,000 fils | claims |
|---|---|---|---|---|---|
| no faucet | 7 | 122,925, 49,894, 18,568, 11,332, 10,243 | 0.50 | 0 | 0 |
| no faucet | 11 | 111,165, 90,778, 78,502, 18,928, 16,875 | 0.33 | 0 | 0 |
| no faucet | 13 | 95,725, 86,352, 35,959, 19,786, 16,945 | 0.35 | 0 | 0 |
| faucet on | 7 | 108,084, 102,720, 100,583, 57,887, 10,732 | 0.25 | 0 | 3 |
| faucet on | 11 | 111,165, 90,778, 78,502, 18,928, 16,875 | 0.33 | 0 | 0 |
| faucet on | 13 | 95,725, 86,352, 35,959, 19,786, 16,945 | 0.35 | 0 | 0 |

Reading:

* Concentration: Gini 0.23 (2 bots), 0.35 (5), 0.50 (10) after 4 h under A without a faucet (0.08, 0.27, 0.40 under C). Per seed (Table 2B) the richest bot ends with 5.6x-12x the net worth of the poorest.
* Bankruptcy: without a faucet, 11% of bots are under 50 dinars after 4 h with 10 bots (A) and **39% after 24 h** (A, 10 bots; 19.2% of all bot-time; 13% under C). With the faucet rule: 1% after 4 h and 0% after 24 h, Gini 0.59 to 0.41 (24 h, 10 bots, A).
* The faucet is cheap: 0.1 claims per bot in 4 h and 0.6-0.8 claims per bot in 24 h with 10 bots (28-41 USDC-equivalents of PLAY money across the 10 bots, which is play money by definition).
* Caveat: in set A many "bankruptcies" are cargo destroyed by truncated sales (section 2.4), so the figure is pessimistic for A and optimistic for contract semantics, where players keep goods and the problem is merchants' cash. The faucet rule as written (net worth, not cash) does what the plan asks; no change is proposed.

## 4. Question 3 - price clamp saturation and MULT_K_BP

Method: `python scripts/analysis/run_exp.py q3`. Share of time = share of (city, good, tick) samples at the end of each tick with the multiplier at its 13,500 (high) or 7,500 (low) clamp.

**Table 3A. Where the multiplier clamps bind (analytic, from `mult_bp`)**

| MULT_K_BP | high clamp (13,500) when stock is at or below | low clamp (7,500) when stock is at or above | mult at stock 0 | mult at stock = 2 x target |
|---|---|---|---|---|
| 2000 | never (multiplier cannot reach 13,500) | never (above the 200% cap) | 12000 | 8000 |
| 3000 | never (multiplier cannot reach 13,500) | 183.3% of target | 13000 | 7500 |
| 3500 | only at stock 0 (no effect) | 171.4% of target | 13500 | 7500 |
| 4000 | 12.5% of target | 162.5% of target | 13500 | 7500 |
| 6000 | 41.7% of target | 141.7% of target | 13500 | 7500 |
| 8000 | 56.2% of target | 131.2% of target | 13500 | 7500 |

**Table 3B-A. Share of time the multiplier sits at the HIGH clamp / LOW clamp, per good (all 4 cities pooled), Appendix B (`pnpm sim`), 10-seed means**

| bots | ticks | grain (high / low) | salt (high / low) | iron (high / low) | spice (high / low) | silk (high / low) | all goods at either clamp | conserved |
|---|---|---|---|---|---|---|---|---|
| 0 | 240 | 35% / 23% | 15% / 27% | 25% / 34% | 66% / 24% | 66% / 24% | 68% | 10/10 |
| 0 | 1440 | 68% / 25% | 44% / 46% | 46% / 47% | 73% / 25% | 74% / 25% | 95% | 10/10 |
| 2 | 240 | 1% / 10% | 11% / 11% | 17% / 21% | 65% / 24% | 66% / 24% | 50% | 10/10 |
| 2 | 1440 | 56% / 22% | 43% / 41% | 44% / 45% | 73% / 25% | 74% / 25% | 90% | 10/10 |
| 5 | 240 | 0% / 0% | 0% / 0% | 0% / 0% | 60% / 24% | 64% / 24% | 34% | 10/10 |
| 5 | 1440 | 5% / 1% | 3% / 2% | 5% / 3% | 71% / 25% | 72% / 25% | 42% | 10/10 |
| 10 | 240 | 0% / 0% | 0% / 0% | 0% / 0% | 35% / 19% | 55% / 24% | 27% | 10/10 |
| 10 | 1440 | 0% / 0% | 0% / 0% | 1% / 0% | 64% / 22% | 68% / 25% | 36% | 10/10 |

**Table 3B-C. Share of time the multiplier sits at the HIGH clamp / LOW clamp, per good (all 4 cities pooled), contract rules (D1-D3, D25 ship limits, warehouse cap), 10-seed means**

| bots | ticks | grain (high / low) | salt (high / low) | iron (high / low) | spice (high / low) | silk (high / low) | all goods at either clamp | conserved |
|---|---|---|---|---|---|---|---|---|
| 0 | 240 | 35% / 23% | 26% / 38% | 42% / 42% | 66% / 24% | 67% / 24% | 77% | 10/10 |
| 0 | 1440 | 68% / 25% | 46% / 48% | 49% / 49% | 74% / 25% | 74% / 25% | 96% | 10/10 |
| 2 | 240 | 16% / 13% | 30% / 33% | 37% / 39% | 65% / 24% | 66% / 24% | 70% | 10/10 |
| 2 | 1440 | 65% / 23% | 47% / 47% | 48% / 48% | 73% / 25% | 74% / 25% | 95% | 10/10 |
| 5 | 240 | 5% / 4% | 15% / 15% | 25% / 24% | 64% / 24% | 66% / 24% | 53% | 10/10 |
| 5 | 1440 | 57% / 20% | 42% / 42% | 46% / 45% | 73% / 25% | 73% / 25% | 90% | 10/10 |
| 10 | 240 | 0% / 0% | 2% / 1% | 5% / 5% | 60% / 24% | 62% / 24% | 37% | 10/10 |
| 10 | 1440 | 44% / 14% | 33% / 31% | 37% / 34% | 72% / 25% | 73% / 25% | 78% | 10/10 |

Reading: a higher `MULT_K_BP` narrows the unclamped band, so it cannot reduce clamp time. At the spec K=4000 the band is 12.5%-162.5% of target stock, which for spice (target 40) is 5 to 65 units and for silk (target 30) 4 to 49 units; one stock unit moves silk's price by 1.33% of base and spice's by 1% (Table 5-7). With bots in the world grain, salt and iron stay inside the band under A (0% at 5 and 10 bots), but spice and silk sit at a clamp 66-86% of the 4 hours (A, 5 bots: 60% high plus 24% low for spice, 64% plus 24% for silk). In a world with no players, every good is on a clamp 68% of the first 4 hours and 95% of 24 hours (rows with 0 bots): the clamps are a property of the production/consumption design, not of bots.

**Table 3C-A. MULT_K_BP sweep, Appendix B (`pnpm sim`), 10-seed means, 240 ticks (clamps 7,500 / 13,500)**

| bots | MULT_K_BP | all goods at a clamp | spice+silk at a clamp | grain+salt+iron at a clamp | trips | median profit/trip (fils) | mean profit/trip (fils) | truncated sales | truncated share | merchant-ticks < 20% | mean bot net worth at end (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 2000 | 0% | 0% | 0% | 178.3 | 1,288 | 17 | 29.4 | 16.8% | 3.0% | 52,291 | 10/10 |
| 5 | 3000 | 9% | 22% | 0% | 175.0 | 1,231 | 45 | 39.9 | 23.1% | 3.4% | 54,605 | 10/10 |
| 5 | 4000 | 34% | 86% | 0% | 181.6 | 1,432 | 76 | 42.2 | 23.5% | 2.5% | 56,095 | 10/10 |
| 5 | 6000 | 39% | 91% | 4% | 183.5 | 2,013 | 394 | 44.0 | 24.4% | 5.4% | 66,981 | 10/10 |
| 5 | 8000 | 48% | 93% | 17% | 168.8 | 2,861 | 801 | 44.8 | 26.8% | 14.3% | 78,679 | 10/10 |
| 10 | 2000 | 0% | 0% | 0% | 305.0 | 734 | -439 | 37.7 | 12.6% | 2.8% | 37,639 | 10/10 |
| 10 | 3000 | 7% | 17% | 0% | 318.8 | 768 | -294 | 62.4 | 19.9% | 3.8% | 42,274 | 10/10 |
| 10 | 4000 | 27% | 66% | 0% | 334.9 | 857 | -24 | 66.6 | 20.3% | 3.5% | 51,009 | 10/10 |
| 10 | 6000 | 33% | 82% | 0% | 356.0 | 1,275 | 53 | 70.3 | 20.1% | 3.4% | 53,639 | 10/10 |
| 10 | 8000 | 36% | 86% | 3% | 354.5 | 1,630 | 304 | 76.1 | 21.8% | 4.5% | 60,977 | 10/10 |

**Table 3C-C. MULT_K_BP sweep, contract rules (D1-D3, D25 ship limits, warehouse cap), 10-seed means, 240 ticks (clamps 7,500 / 13,500)**

| bots | MULT_K_BP | all goods at a clamp | spice+silk at a clamp | grain+salt+iron at a clamp | trips | median profit/trip (fils) | mean profit/trip (fils) | truncated sales | truncated share | merchant-ticks < 20% | mean bot net worth at end (fils) | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 2000 | 0% | 0% | 0% | 159.7 | 2,107 | 632 | 33.1 | 20.7% | 8.9% | 71,702 | 10/10 |
| 5 | 3000 | 15% | 24% | 9% | 143.9 | 2,687 | 1,103 | 45.6 | 31.7% | 15.6% | 83,209 | 10/10 |
| 5 | 4000 | 53% | 89% | 29% | 130.4 | 2,722 | 1,074 | 46.0 | 35.3% | 19.0% | 79,638 | 10/10 |
| 5 | 6000 | 65% | 93% | 46% | 119.8 | 3,298 | 1,234 | 43.2 | 36.1% | 25.8% | 80,791 | 10/10 |
| 5 | 8000 | 73% | 95% | 58% | 102.6 | 3,987 | 1,530 | 39.3 | 38.3% | 29.8% | 81,971 | 10/10 |
| 10 | 2000 | 0% | 0% | 0% | 293.7 | 1,009 | 216 | 55.6 | 18.9% | 4.0% | 58,133 | 10/10 |
| 10 | 3000 | 10% | 22% | 1% | 296.1 | 1,161 | 382 | 76.1 | 25.7% | 7.2% | 64,229 | 10/10 |
| 10 | 4000 | 37% | 85% | 4% | 307.7 | 1,378 | 452 | 80.6 | 26.2% | 8.4% | 66,408 | 10/10 |
| 10 | 6000 | 45% | 91% | 15% | 297.3 | 1,924 | 591 | 80.9 | 27.2% | 14.3% | 69,301 | 10/10 |
| 10 | 8000 | 49% | 94% | 20% | 311.2 | 2,249 | 583 | 95.4 | 30.7% | 15.4% | 71,038 | 10/10 |

**Table 3D. Clamp widening together with MULT_K_BP, Appendix B rules, 10-seed means, 240 ticks**

| bots | MULT_K_BP | MULT_MIN_BP | MULT_MAX_BP | all goods at a clamp | spice+silk at a clamp | trips | median profit/trip | mean profit/trip | truncated sales | truncated share | conserved |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 4000 | 7500 | 13500 | 34% | 86% | 181.6 | 1,432 | 76 | 42.2 | 23.5% | 10/10 |
| 5 | 4000 | 6000 | 15000 | 8% | 16% | 150.7 | 1,490 | 663 | 43.0 | 28.9% | 10/10 |
| 5 | 6000 | 6000 | 15000 | 41% | 88% | 157.4 | 2,638 | 806 | 55.8 | 35.7% | 10/10 |
| 5 | 6000 | 5000 | 17000 | 13% | 23% | 144.0 | 2,157 | 915 | 60.6 | 42.6% | 10/10 |
| 5 | 8000 | 5000 | 17000 | 51% | 87% | 123.8 | 2,756 | 1,329 | 58.1 | 47.3% | 10/10 |
| 10 | 4000 | 7500 | 13500 | 27% | 66% | 334.9 | 857 | -24 | 66.6 | 20.3% | 10/10 |
| 10 | 4000 | 6000 | 15000 | 3% | 6% | 336.4 | 866 | 52 | 92.1 | 27.9% | 10/10 |
| 10 | 6000 | 6000 | 15000 | 32% | 79% | 332.9 | 1,535 | 291 | 104.4 | 31.8% | 10/10 |
| 10 | 6000 | 5000 | 17000 | 7% | 19% | 328.1 | 1,162 | 384 | 123.1 | 38.1% | 10/10 |
| 10 | 8000 | 5000 | 17000 | 38% | 80% | 292.2 | 1,367 | 567 | 114.5 | 39.7% | 10/10 |

**Table 3E. Spice and silk target stock scaled (cap = 2 x target), MULT_K 4000 and clamps unchanged, 10-seed means, 240 ticks**

| rules | bots | spice / silk target stock | spice+silk at a clamp | trips | median profit/trip | mean profit/trip | truncated sales | truncated share | merchant-ticks < 20% | conserved |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 5 | spec (40 / 30) | 86% | 181.6 | 1,432 | 76 | 42.2 | 23.5% | 2.5% | 10/10 |
| A | 5 | x2 (80 / 60) | 74% | 167.3 | 1,642 | 443 | 37.6 | 22.8% | 7.7% | 10/10 |
| A | 5 | x3 (120 / 90) | 61% | 177.0 | 1,435 | 205 | 35.3 | 20.2% | 3.8% | 10/10 |
| A | 10 | spec (40 / 30) | 66% | 334.9 | 857 | -24 | 66.6 | 20.3% | 3.5% | 10/10 |
| A | 10 | x2 (80 / 60) | 44% | 340.7 | 914 | -37 | 60.5 | 18.1% | 3.2% | 10/10 |
| A | 10 | x3 (120 / 90) | 28% | 341.1 | 1,026 | -146 | 51.7 | 15.5% | 2.8% | 10/10 |
| C | 5 | spec (40 / 30) | 89% | 130.4 | 2,722 | 1,074 | 46.0 | 35.3% | 19.0% | 10/10 |
| C | 5 | x2 (80 / 60) | 78% | 135.5 | 2,714 | 1,074 | 42.6 | 31.4% | 18.8% | 10/10 |
| C | 5 | x3 (120 / 90) | 67% | 137.1 | 2,926 | 1,167 | 43.7 | 31.9% | 16.5% | 10/10 |
| C | 10 | spec (40 / 30) | 85% | 307.7 | 1,378 | 452 | 80.6 | 26.2% | 8.4% | 10/10 |
| C | 10 | x2 (80 / 60) | 73% | 301.8 | 1,349 | 419 | 75.4 | 25.0% | 8.7% | 10/10 |
| C | 10 | x3 (120 / 90) | 59% | 312.1 | 1,330 | 367 | 76.3 | 24.4% | 7.5% | 10/10 |

Reading:

* **K = 6000 / 8000**: median profit per trip rises (A, 5 bots: 1,432 to 2,013 to 2,861 fils; C: 2,722 to 3,298 to 3,987) but clamp time rises (spice+silk 86% to 91% to 93%; grain+salt+iron 0% to 4% to 17%, A), truncation rises (23.5% to 24.4% to 26.8% A; 35.3% to 36.1% to 38.3% C), merchants go dry more often (merchant-ticks under 20%: 2.5% to 5.4% to 14.3%, A; 19.0% to 25.8% to 29.8%, C) and trips fall (C: 130 to 120 to 103). More profit comes out of the same four treasuries, faster.
* **K = 3000**: spice+silk at a clamp 86% to 22% (A, 5 bots) and 89% to 24% (C), with median profit per trip 1,231 versus 1,432 (A) and 2,687 versus 2,722 (C), and fewer dry merchants under C (15.6% versus 19.0%). K = 2000 removes clamping entirely but 10 bots then lose money on average (mean -439 fils per trip, A).
* **Wider clamps** (3D, 6,000/15,000 at K=4000): clamp time 34% to 8% (A, 5 bots) and mean profit 76 to 663, but truncation rises (23.5% to 28.9%) and trips fall (182 to 151).
* **Larger spice/silk targets** (3E): x2 gives 86% to 74% (A, 5 bots) and 66% to 44% (A, 10 bots) at a clamp, x3 61% and 28%; economics otherwise unchanged. It costs spec changes to the goods table.

## 5. Question 4 - the first profitable trade

Three different questions are mixed in "first profitable trade in under a minute": when can the player start, when does profit appear, and how large is it. Method: `python scripts/analysis/run_q4.py`. Expected profit (EP) for a 500-dinar newcomer = one journey chosen with full knowledge of the current prices and treasuries, exact integer prices, 1% fees, ambush risk, guards chosen optimally (cost 2% of the cargo base value each, truncated), unsold goods valued at 0. EP is therefore an upper bound for a player who acts first; Table 4F is the realised outcome of a competing bot.

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

**Table 4A. Fresh world (no players, nothing traded yet): first tick at which a positive expected-profit trade exists for a 500-dinar player (0 guards)**

| rules | first positive trade, shortest route bandar-shahr | first positive trade, any route | best EP at 0 min: short / any (fils) | 10 min | 30 min | 60 min | 120 min |
|---|---|---|---|---|---|---|---|
| A | tick 2 (2 min): 266 fils on bandar>shahr 1 spice | tick 2 (2 min): 266 fils on bandar>shahr 1 spice | -99 / -99 | 3,777 / 16,599 | 5,944 / 28,762 | 14,932 / 29,715 | 17,919 / 29,715 |
| C | tick 2 (2 min): 266 fils on bandar>shahr 1 spice | tick 2 (2 min): 266 fils on bandar>shahr 1 spice | -99 / -99 | 8,008 / 16,599 | 5,944 / 29,715 | 10,924 / 29,715 | 11,886 / 29,715 |
| A, no NPC | tick 2 (2 min): 266 fils on bandar>shahr 1 spice | tick 2 (2 min): 266 fils on bandar>shahr 1 spice | -99 / -99 | 12,353 / 12,353 | 17,830 / 17,830 | 17,830 / 17,830 | 17,830 / 17,830 |

**Table 4F. Realised first journey of a newcomer (greedy bot with 50,000 fils joining at minute J into a world of bots-1 active bots; 10 seeds; sim ticks = minutes)**

| rules | bots in world (incl. newcomer) | joins at minute J | newcomers that completed a first journey within 120 min | first journey profitable | median first-journey profit (fils, % of capital) | mean first-journey profit (fils) | median minutes join to first purchase | median minutes join to first arrival | newcomers with any profitable arrival | median minutes join to first profitable arrival |
|---|---|---|---|---|---|---|---|---|---|---|
| A (Appendix B) | 5 | 0 | 10/10 | 40% | -4,403 (-8.8%) | -8,483 | 7 min | 11 min | 10/10 | 18 min |
| A (Appendix B) | 5 | 60 | 10/10 | 70% | 2,433 (4.9%) | 5,020 | 0 min | 5 min | 10/10 | 8 min |
| A (Appendix B) | 5 | 120 | 10/10 | 70% | 2,958 (5.9%) | -701 | 0 min | 5 min | 10/10 | 9 min |
| A (Appendix B) | 5 | 180 | 10/10 | 60% | 2,449 (4.9%) | 774 | 0 min | 5 min | 10/10 | 6 min |
| A (Appendix B) | 10 | 0 | 10/10 | 30% | -11,306 (-22.6%) | -8,951 | 7 min | 10 min | 10/10 | 20 min |
| A (Appendix B) | 10 | 60 | 10/10 | 80% | 9,905 (19.8%) | 4,602 | 3 min | 6 min | 10/10 | 8 min |
| A (Appendix B) | 10 | 120 | 10/10 | 60% | 2,942 (5.9%) | -2,698 | 3 min | 8 min | 10/10 | 10 min |
| A (Appendix B) | 10 | 180 | 10/10 | 60% | 2,433 (4.9%) | -1,092 | 0 min | 6 min | 10/10 | 8 min |
| C (contract rules) | 5 | 0 | 10/10 | 70% | 6,038 (12.1%) | -663 | 7 min | 10 min | 10/10 | 13 min |
| C (contract rules) | 5 | 60 | 10/10 | 70% | 9,277 (18.6%) | 3,867 | 0 min | 5 min | 10/10 | 6 min |
| C (contract rules) | 5 | 120 | 10/10 | 70% | 7,206 (14.4%) | -2,266 | 0 min | 6 min | 10/10 | 11 min |
| C (contract rules) | 5 | 180 | 9/10 | 78% | 9,905 (19.8%) | 5,094 | 5 min | 9 min | 9/10 | 11 min |
| C (contract rules) | 10 | 0 | 10/10 | 30% | -10,736 (-21.5%) | -10,251 | 7 min | 10 min | 10/10 | 16 min |
| C (contract rules) | 10 | 60 | 10/10 | 70% | 2,433 (4.9%) | 3,314 | 0 min | 6 min | 10/10 | 9 min |
| C (contract rules) | 10 | 120 | 10/10 | 70% | 9,905 (19.8%) | 4,862 | 3 min | 8 min | 10/10 | 9 min |
| C (contract rules) | 10 | 180 | 10/10 | 40% | -170 (-0.3%) | -1,914 | 0 min | 5 min | 10/10 | 10 min |
| C + unsold goods kept | 5 | 0 | 10/10 | 100% | 5,828 (11.7%) | 5,220 | 7 min | 10 min | 10/10 | 10 min |
| C + unsold goods kept | 5 | 60 | 8/10 | 100% | 7,640 (15.3%) | 8,936 | 5 min | 10 min | 8/10 | 10 min |
| C + unsold goods kept | 5 | 120 | 1/10 | 100% | 4,244 (8.5%) | 4,244 | 6 min | 11 min | 1/10 | 11 min |
| C + unsold goods kept | 5 | 180 | 1/10 | 100% | 4,244 (8.5%) | 4,244 | 6 min | 11 min | 1/10 | 11 min |
| C + unsold goods kept | 10 | 0 | 10/10 | 100% | 4,244 (8.5%) | 3,749 | 7 min | 10 min | 10/10 | 10 min |
| C + unsold goods kept | 10 | 60 | 5/10 | 100% | 4,244 (8.5%) | 4,469 | 0 min | 6 min | 5/10 | 6 min |
| C + unsold goods kept | 10 | 120 | 0/10 | 0% | n/a | n/a | n/a | n/a | 0/10 | n/a |
| C + unsold goods kept | 10 | 180 | 0/10 | 0% | n/a | n/a | n/a | n/a | 0/10 | n/a |

Reading: in a running world (joins at minute 60 to 180) a newcomer's median first purchase is 0 to 5 minutes after joining (0 in 8 of the 12 A/C rows), its first arrival 5-9 minutes after joining and its first profitable arrival after a median 6-11 minutes; 40-80% of first journeys are profitable under A and C. In a brand-new world (J = 0) nothing is profitable at first: all prices equal base and a round trip costs the 8% spread plus 2% fees (EP -99 fils at minute 0); the first positive EP appears after 2 minutes of world time and is small (266 fils, 1 spice), 3,777-12,353 fils (7.6-24.7%) on the short route at 10 minutes. Newcomers in the fresh world buy after a median 7 minutes and are profitable after 13-20. Under the contract semantics with unsold goods kept (last rows) the stalled market means late newcomers often never complete a journey in the next 2 hours (Table 4F: 0/10 completed at J = 120 and 180 with 10 bots), a consequence of the liquidity problem in section 2.4.

**Typical profit per trip.**

**Table 4B. Established worlds (state after 60, 80, ..., 240 ticks; seeds 7, 11, 13 pooled): best expected profit of one journey for a 500-dinar newcomer (guards chosen optimally)**

| rules | bots in world | snapshots | short route: positive EP | short route: median EP (fils, % of 50,000) | short route: mean EP | any route: positive EP | any route: median EP (% of capital) | any route: mean EP | most common best route | snapshots where >= 1 guard is optimal |
|---|---|---|---|---|---|---|---|---|---|---|
| A | 0 | 30 | 100% | 14,932 (29.9%) | 15,118 | 100% | 29,715 (59.4%) | 29,715 | bandar>madan (30/30) | 0% |
| A | 2 | 30 | 87% | 11,886 (23.8%) | 10,754 | 100% | 29,715 (59.4%) | 24,915 | bandar>madan (25/30) | 20% |
| A | 5 | 30 | 100% | 11,886 (23.8%) | 12,909 | 100% | 22,232 (44.5%) | 23,831 | bandar>dasht (17/30) | 13% |
| A | 10 | 30 | 100% | 17,830 (35.7%) | 15,331 | 100% | 29,715 (59.4%) | 26,790 | bandar>madan (15/30) | 3% |
| C | 0 | 30 | 100% | 11,886 (23.8%) | 11,865 | 100% | 29,715 (59.4%) | 29,715 | bandar>madan (30/30) | 0% |
| C | 2 | 30 | 30% | -49 (-0.1%) | 2,868 | 100% | 11,886 (23.8%) | 14,125 | bandar>madan (16/30) | 13% |
| C | 5 | 30 | 90% | 9,312 (18.6%) | 9,459 | 100% | 22,232 (44.5%) | 19,994 | bandar>madan (12/30) | 7% |
| C | 10 | 30 | 97% | 17,830 (35.7%) | 14,529 | 100% | 29,715 (59.4%) | 25,296 | bandar>madan (14/30) | 10% |

Reading: on the cheapest route (bandar-shahr, 180 s, 8% risk) the best available single journey is worth a median 9,312-17,830 fils (18.6-35.7% of the 50,000-fils capital) in 7 of 8 world types, mostly spice/silk bought where it is cheap and sold at a clamp; over all routes 11,886-29,715 fils (24-59%) and bandar-madan or bandar-dasht is usually best. That is the hindsight upper bound for the first mover; competing bots realise a median 1,432-2,722 fils per trip (2.9-5.4% of capital, Table 1B, 5 bots) and a newcomer's median first journey, joining at minute 60 or later, is between -170 and 9,905 fils (-0.3% to 19.8%) (Table 4F). Plan the UX around about 5% of capital per 3-6 minute trip as the sober figure and 20-30% as what a first-mover with the best spice/silk lane can see.

**Table 4D. Ambush-immune cargo (at most 3 units of each good, floor(30% x 3) = 0) vs the best single-good cargo, mean expected profit, snapshots at 60/120/180/240 ticks, seeds 7, 11, 13**

| rules | bots | snapshots | short route: best single good (guards optimal) | short route: best immune bundle | any route: best single good | any route: best immune bundle |
|---|---|---|---|---|---|---|
| A | 0 | 12 | 13,558 (27.1%) | 8,915 (17.8%) | 29,715 (59.4%) | 29,715 (59.4%) |
| A | 5 | 12 | 13,110 (26.2%) | 13,976 (28.0%) | 25,632 (51.3%) | 26,744 (53.5%) |
| C | 0 | 12 | 11,646 (23.3%) | 11,391 (22.8%) | 29,715 (59.4%) | 29,715 (59.4%) |
| C | 5 | 12 | 9,935 (19.9%) | 7,675 (15.3%) | 19,568 (39.1%) | 19,976 (40.0%) |

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

A guard costs 2% of the cargo base value (e.g. 800 fils for 40 grain) and removes, in expectation, 0.84% of the cargo on the shortest route; on five of six routes every guard is a pure cost, and only the first guard on madan-bandar (2.10% saved versus 2.00%) is marginally positive. The optimiser chose at least one guard in 0-20% of snapshots (Table 4B, last column). The first trip has an 8% ambush chance on the shortest route and a 22.1% chance of at least one ambush in the first three trips; with the floor rule an ambush destroys 12 of 40 units (30%) but nothing at all for a good carried in lots of 3 or fewer (Table 5-5), which is why the best "immune" bundle (Table 4D) earns about the same as the best single-good cargo. For a new player the right advice is to skip guards, and guards as designed give a risk-averse player almost nothing for 2%.

## 6. Question 5 - exploit loops and conservation

Method: `packages/shared/node_modules/.bin/tsx scripts/analysis/exploits.ts` (exhaustive, uses the real `tradeCost()`), `python scripts/analysis/run_q5.py`.

**Round trips and closed loops against one merchant.**

| check | cases | profitable cases | best net result (fils) | where | smallest loss as share of outlay | where |
|---|---|---|---|---|---|---|
| buy q then sell q back, and sell q then buy q back, same merchant; 5 goods x every stock 0..cap x q 1..40 x spread {400, 800, 2000} x bias {-1500, 0, +1500} | 635,400 | 0 | -35 | grain sell-then-buy stock=318 q=1 spread=400 bias=-1500 | 4.16% | silk sell-then-buy stock=47 q=1 spread=400 bias=-1500 |

| check | closed loops tested | profitable | best net result (fils) | where |
|---|---|---|---|---|
| sequences of 2-4 trades (sizes 1, 2, 3, 5, 10, 20, 40) that return the player's inventory to its start, spread 400, 17 start stocks per good incl. both clamp edges, both from empty hands and from a full 40-unit hold | 25,952 | 0 | -43 | grain start=325 B1,S1 |

No loop makes money; the best is a loss of 35 fils (grain, 1 unit, spread 400, bias -1500) and the smallest loss is 4.16% of the outlay, i.e. the spread and fees always dominate the integer rounding and the midpoint-pricing asymmetry for odd quantities (one stock unit moves a price by 0.2-1.33% of base, Table 5-7, much less than the 6% a round trip costs at the minimum spread).

**Splitting a trade.**

| check | cases (good x start stock) | split better in | largest edge (fils) | where | largest edge as share of the trade | where |
|---|---|---|---|---|---|---|
| buy 40 as 40 one-unit buys instead of one 40-unit buy (spread 800) | 785 | 680 | 7,061 | silk stock=40 | 0.83% | grain stock=45 |
| sell 40 as 40 one-unit sells instead of one 40-unit sell (spread 800) | 785 | 753 | 19,715 | silk stock=20 | 3.91% | spice stock=40 |

Midpoint pricing is exact only while the price is linear in stock. Near the clamps it is not, so 40 one-unit trades beat one 40-unit trade in most cases: up to 0.83% cheaper on buys and 3.91% better on sells (spice at stock 40). It is not a loop (it improves one leg of an arbitrage by at most 3.91%) but it costs the relayer 40 transactions per trade. If transaction cost matters, `MAX_QTY_PER_TRADE` or a per-player rate limit bounds it.

**Merchant policy drift (D24).**

| merchant policy path (start bias -1500; player buys 10 at tick 0, sells 10 after k ticks, no travel) | grain | salt | iron | spice | silk |
|---|---|---|---|---|---|
| bias +300/tick, spread fixed 400 | 2 | 2 | 2 | 2 | 2 |
| bias +300/tick, spread fixed 800 | 3 | 3 | 3 | 3 | 3 |
| bias +300/tick and spread -300/tick from 800 (floor 400) | 3 | 3 | 3 | 3 | 3 |

(cells: smallest k, in ticks = minutes, at which the hold-and-sell is profitable after both 1% fees)

D24 allows 300 bp per tick. A merchant (the AI) that walks its bias upward at that rate while keeping the spread low lets any player in the city buy now and sell 2 minutes later at a profit, without travelling; with spread 800 it takes 3 ticks. The AI baseline does not do this by design, but nothing in the contract forbids it, and a persona that "raises prices when stock is low" will do it gradually.

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

The stall fee `ceil(2% x price)`, minimum 1 fils, cannot be evaded by splitting (0 of 19,996 cases cheaper) and is never below 2%. Two accounts can still move cash between them at the 2% price (the seller pays): with D4 (faucet when net worth is under 5,000 fils) and D5 (seller pays) one account that tops up 50,000 fils from the faucet each hour can buy a 1-grain stall priced at 49,990 fils from a second account, ending below the 5,000-fils threshold again and handing the other account 48,990 fils (fee `ceil(2% x 49,990) = 1,000` fils) per hour. That arithmetic follows from the rules, it was not simulated. In PLAY it only distorts the leaderboard; in LIVE the faucet is disabled.

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

**Table 5A. Operator exposure: merchants + house cash vs their 200,000-fils seed (10 seeds). Whales hold the 200,000-fils LIVE deposit cap in cash**

| rules | players x starting cash (fils) | ticks | operator P&L at end (mean, fils) | worst operator P&L over time (mean of seeds) | worst single seed (fils) | worst seed as % of the 200,000 seed capital | players' cash gain at end (mean, fils) | money conserved |
|---|---|---|---|---|---|---|---|---|
| A (Appendix B) | 1 x 200,000 | 240 | -32,184 | -72,618 | -134,110 | 67% | 32,184 | 10/10 |
| A (Appendix B) | 1 x 200,000 | 1440 | -166,660 | -166,660 | -177,751 | 89% | 166,660 | 10/10 |
| A (Appendix B) | 2 x 200,000 | 240 | 29,175 | -31,335 | -61,061 | 31% | -29,175 | 10/10 |
| A (Appendix B) | 2 x 200,000 | 1440 | -23,399 | -85,781 | -175,833 | 88% | 23,399 | 10/10 |
| A (Appendix B) | 4 x 200,000 | 240 | 219,070 | -10,945 | -50,065 | 25% | -219,070 | 10/10 |
| A (Appendix B) | 4 x 200,000 | 1440 | 274,596 | -40,530 | -113,790 | 57% | -274,596 | 10/10 |
| A (Appendix B) | 5 x 50,000 | 240 | 106,875 | -38,637 | -87,498 | 44% | -106,875 | 10/10 |
| A (Appendix B) | 5 x 50,000 | 1440 | 46,209 | -124,578 | -188,719 | 94% | -46,209 | 10/10 |
| A (Appendix B) | 10 x 50,000 | 240 | 123,711 | -21,768 | -53,273 | 27% | -123,711 | 10/10 |
| A (Appendix B) | 10 x 50,000 | 1440 | 122,973 | -79,795 | -127,454 | 64% | -122,973 | 10/10 |
| C (contract rules) | 1 x 200,000 | 240 | -103,965 | -117,449 | -138,664 | 69% | 103,965 | 10/10 |
| C (contract rules) | 1 x 200,000 | 1440 | -136,774 | -136,774 | -144,068 | 72% | 136,774 | 10/10 |
| C (contract rules) | 2 x 200,000 | 240 | 14 | -19,912 | -48,442 | 24% | -14 | 10/10 |
| C (contract rules) | 2 x 200,000 | 1440 | -116,594 | -123,999 | -138,532 | 69% | 116,594 | 10/10 |
| C (contract rules) | 4 x 200,000 | 240 | 72,025 | -8,228 | -19,693 | 10% | -72,025 | 10/10 |
| C (contract rules) | 4 x 200,000 | 1440 | -26,624 | -81,653 | -102,247 | 51% | 26,624 | 10/10 |
| C (contract rules) | 5 x 50,000 | 240 | -69,892 | -151,098 | -179,029 | 90% | 69,892 | 10/10 |
| C (contract rules) | 5 x 50,000 | 1440 | -170,116 | -170,802 | -181,425 | 91% | 170,116 | 10/10 |
| C (contract rules) | 10 x 50,000 | 240 | 14,724 | -135,498 | -169,696 | 85% | -14,724 | 10/10 |
| C (contract rules) | 10 x 50,000 | 1440 | -185,979 | -186,228 | -191,308 | 96% | 185,979 | 10/10 |

Reading: in every run of Table 5A the operator's P&L stayed above -200,000 fils (worst observed -191,308, 96% of the seed, 10 players x 50,000 fils for 24 h under C), which confirms the plan's statement that the operator's maximum loss equals the merchants' treasuries. It also shows the cap is not a theoretical limit: one 20-USDC whale alone takes a mean 136,774-166,660 fils (68-83%) in 24 hours, and 5-10 ordinary greedy players take about 170,000-186,000 (C, 24 h). Operator risk is a practical number, not a remote one.

**Money conservation.** Every run asserts `merchants + house + bots' cash == start (+ faucet injections)` after every tick. Results: 1,784 runs of `run_exp.py`, 279 of `run_q4.py`, 340 of `run_q5.py`, 28 of `validate.py`; all conserved. The 25 TypeScript `runSim()` configurations checked in validation also conserved on every tick. The tables' "conserved" columns show the per-row count.

**Table 5C. NPC shipping per good, 5 bots, 240 ticks, 10-seed means: units shipped per run / ticks where the gap test passed but the receiving treasury (A) or its 25% budget (C) could not pay**

| rules | treasury per merchant (fils) | grain | salt | iron | spice | silk |
|---|---|---|---|---|---|---|
| A (Appendix B) | 50,000 | 844 / 3 | 887 / 6 | 898 / 1 | 433 / 129 | 42 / 226 |
| A (Appendix B) | 100,000 | 837 / 2 | 881 / 7 | 902 / 2 | 506 / 110 | 112 / 209 |
| A (Appendix B) | 200,000 | 822 / 0 | 896 / 1 | 892 / 0 | 823 / 9 | 613 / 36 |
| C (contract rules) | 50,000 | 680 / 27 | 481 / 80 | 452 / 53 | 63 / 176 | 5 / 232 |
| C (contract rules) | 100,000 | 735 / 14 | 543 / 59 | 664 / 24 | 100 / 152 | 17 / 221 |
| C (contract rules) | 200,000 | 792 / 1 | 728 / 21 | 842 / 2 | 209 / 112 | 54 / 189 |

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
