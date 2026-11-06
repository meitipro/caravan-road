# Economy

How prices, trades, journeys and the world tick work, and what the simulation says about them.
Audience: a judge or a developer who wants to check the numbers. Everything here is copied from
`spec/ECONOMY.md`, `spec/GAME.md`, `spec/CHANGELOG.md` and `contracts/caravan/DECISIONS.md`, or was
produced by a command listed in the section where it appears.

> **spec-v1.2 (adopted: merged 2026-11-03, tag `spec-v1.2`).** This file shows `MULT_K_BP = 3000` (spec-v1.1: 4000).
> Prices, golden vectors, the mid-price ranges and the `pnpm sim` numbers were recomputed from real runs (re-run again on
> 2026-11-05); the Appendix B figures of spec-v1.1 (64 / 5,944 / 23, 177 / 1,088 / 43, 342 / 1,099 / 86) no longer apply to the
> shared sim or to `scripts/ref/economy_sim.py`, which both use K = 3000 now. Figures from spec-v1.1 are labelled
> "spec-v1.1, K = 4000". See `spec/CHANGELOG.md`.

## 1. Which numbers are which

Three kinds of numbers appear in this repository. Do not mix them.

| Kind | What it is | Where it lives | How to reproduce |
|---|---|---|---|
| **Contract rules** | What the Rust contract enforces (spec-v1 plus the audited changes of spec-v1.1) | `contracts/caravan/src/`, `spec/CHANGELOG.md`, `contracts/caravan/DECISIONS.md` | `cd contracts/caravan && cargo test` (68 tests) |
| **Appendix B reference** | The Python reference simulation of the master plan and its published table (spec section 2.9). Its rules differ from the contract in three places (section 8.2) | `scripts/ref/economy_sim.py`, ported to `packages/shared/src/sim.ts` | `pnpm sim --bots N --ticks 240 --seed 7` |
| **Worker evaluation** | The NPC loop against its own in-memory world, with a scripted FAKE model | `apps/worker/src/sim-world.ts`, `docs/NPC_EVAL.md` | `pnpm --filter @caravan/worker eval` |

`pnpm sim` prints the Appendix B reference rules, not the contract's, with `MULT_K_BP = 3000`. `scripts/ref/economy_sim.py`
has K = 3000 too (`scripts/ref/world.py`, commit `083bc34`) and prints the same numbers. The contract-rule figures in section
8.2 come from `scripts/analysis/econ_variant.py` (`contract_d123`, K = 3000, checked by `python scripts/analysis/validate.py`)
and, for spec-v1.1 (K = 4000), from `contracts/caravan/DECISIONS.md` and `spec/CHANGELOG.md`; no `pnpm` command prints them.

## 2. Units

All money is an integer number of **fils**. 1 dinar = 100 fils. 1 USDC = 10,000 fils = 100 dinars
(`spec/ECONOMY.md` 2.1). The UI shows dinars only. Rust uses `i128`/`u128`, TypeScript uses `bigint`, the
API carries money as decimal strings. Every integer division truncates toward zero; this matters because
`target - stock` can be negative. A floor division anywhere would make UI prices differ from contract prices
and cause `SLIPPAGE` errors (`packages/shared/src/quote.ts`, `contracts/caravan/src/math.rs`).

## 3. World data

Goods (spec 2.2):

| id | base (fils) | base (dinar) | target stock | stock cap (2 x target) | mid-price range (fils) |
|---|---|---|---|---|---|
| `grain` | 1,000 | 10 | 200 | 400 | 750 - 1,300 |
| `salt` | 1,500 | 15 | 120 | 240 | 1,125 - 1,950 |
| `iron` | 4,000 | 40 | 100 | 200 | 3,000 - 5,200 |
| `spice` | 12,000 | 120 | 40 | 80 | 9,000 - 15,600 |
| `silk` | 20,000 | 200 | 30 | 60 | 15,000 - 26,000 |

The upper bounds were 1,350 / 2,025 / 5,400 / 16,200 / 27,000 in spec-v1.1 (K = 4000); the lower bounds did not change.

Cities, net change per 60 s tick (spec 2.3). Each city starts every good at its target stock; stock is
clamped to `[0, 2 x target]`:

| id | role | produces per tick | consumes per tick |
|---|---|---|---|
| `dasht` | farmland | grain 8, salt 3 | iron 2, spice 1, silk 1 |
| `madan` | mountain mine | iron 4, salt 2 | grain 4, spice 1, silk 1 |
| `bandar` | harbour | spice 4, silk 3 | grain 3, iron 3, salt 2 |
| `shahr` | capital | iron 1 | grain 1, salt 3, spice 2, silk 1 |

World totals per good, production = consumption (checked by hand from the table):

| good | produced per tick | consumed per tick |
|---|---|---|
| grain | dasht 8 = 8 | madan 4 + bandar 3 + shahr 1 = 8 |
| salt | dasht 3 + madan 2 = 5 | bandar 2 + shahr 3 = 5 |
| iron | madan 4 + shahr 1 = 5 | dasht 2 + bandar 3 = 5 |
| spice | bandar 4 = 4 | dasht 1 + madan 1 + shahr 2 = 4 |
| silk | bandar 3 = 3 | dasht 1 + madan 1 + shahr 1 = 3 |

The specification text says "each city produces two goods"; `shahr` produces one (`spec/OPEN_QUESTIONS.md` #5). The table is
used as written.

Routes (spec 2.4), both directions:

| route | travel time | ambush risk with no guards |
|---|---|---|
| `bandar` - `shahr` | 180 s | 800 bp (8%) |
| `shahr` - `dasht` | 240 s | 1200 bp (12%) |
| `dasht` - `madan` | 300 s | 1500 bp (15%) |
| `madan` - `bandar` | 360 s | 2000 bp (20%) |
| `bandar` - `dasht` | 270 s | 1000 bp (10%) |
| `shahr` - `madan` | 330 s | 1800 bp (18%) |

Guards (0 to 3): each costs 2% of the cargo's base value (paid to `house`) and multiplies the ambush
risk by 0.65: `risk_bp = base_risk_bp x 6500^g / 10000^g`, one truncating division. In an ambush each cargo
good loses `floor(30% x qty)` (contract rule, spec-v1.1). The roll is
`u64_le(sha256(random_seed || journey_id || account)[0..8]) mod 10000 < risk_bp` (DECISIONS D12). The
randomness source is the block's `random_seed`, which is not tamper-proof (README of the contract).

## 4. Price formulas

Basis points: 10,000 bp = 100%.

```
mult_bp(stock, target) = clamp( 10000 + 3000 * (target - stock) / target , 7500 , 13500 )
mid  = base * mult_bp / 10000
mid  = mid * (10000 + bias_bp) / 10000            # merchant bias
ask  = mid * (10000 + spread_bp / 2) / 10000      # the player buys at ask
bid  = mid * (10000 - spread_bp / 2) / 10000      # the player sells at bid
```

Scarce goods (stock under target) cost more, abundant goods cost less, within 75% to 130% of base (spec-v1.1: 135%; at K = 3000 the multiplier tops out at 13000, so only the lower clamp can bind). Each
merchant also sets a `spread_bp` (400 to 2000, default 800) and a `bias_bp` (-1500 to +1500) once a minute;
that is the only thing the AI decides (see `spec/NPC.md`).

Worked example, the golden vector `spice`, stock 55, spread 1200, bias 250 (target 40):

```
mult = 10000 + 3000 * (40 - 55) / 40 = 10000 - 1125 = 8875
mid  = 12000 * 8875 / 10000          = 10650
mid  = 10650 * 10250 / 10000         = 10916   (10916.25 truncated)
ask  = 10916 * 10600 / 10000         = 11570   (11570.96 truncated)
bid  = 10916 *  9400 / 10000         = 10261   (10261.04 truncated)
```

Output of `quote()` for these inputs, run on 2026-11-02 with K = 3000: `{"bid":"10261","mid":"10916","ask":"11570"}`
(spec-v1.1, K = 4000: 9827 / 10455 / 11082).

### Trade rules (spec 2.6, contract `trade`)

- **Midpoint pricing.** Buying `qty` units is priced at the `ask` for stock `stock - qty/2`; selling at the `bid`
  for stock `stock + qty/2` (integer division). Example from `tradeCost()`: buying 10 grain at stock 200,
  spread 800, bias 0 prices at stock 195: mult 10075, mid 1007, ask 1047, total 10,470 fils, fee 104 fils. Selling
  the same 10 grain at stock 200 prices at stock 205: unit 952, total 9,520 fils, fee 95 fils (spec-v1.1, K = 4000:
  ask 1050, total 10,500, fee 105; unit 950, total 9,500, fee 95).
- **Fee**: 1% of the trade total, paid by the player to `house`.
- At most 40 units per trade; a caravan holds at most 40 units.
- The player must be in that city and not travelling.
- A merchant buys only up to its treasury (`MERCHANT_BROKE`). If the merchant's stock would exceed `2 x target`
  after a sale, the trade is rejected as `BAD_REQUEST` ("warehouse full").
- `limit_total` bounds the price you accept: buy `total + fee <= limit_total`; sell `total - fee >= limit_total`
  (DECISIONS D7). The UI sets it from an "allowed price change" of 0.5% to 5%.

## 5. Parameters (spec 2.5)

| parameter | value | meaning |
|---|---|---|
| `TICK_SECONDS` | 60 | world tick length |
| `MULT_K_BP / MIN / MAX` | 3000 / 7500 / 13500 | price sensitivity and clamp of the multiplier (spec-v1.2; spec-v1.1: 4000) |
| `SPREAD_DEFAULT / MIN / MAX` | 800 / 400 / 2000 | buy/sell spread (bp) |
| `BIAS_MIN / MAX` | -1500 / +1500 | merchant mid-price bias (bp) |
| `TRADE_FEE_BP` | 100 | trade fee paid by the player (to `house`) |
| `MAX_QTY_PER_TRADE` / `CARGO_CAP` | 40 / 40 | units per trade / caravan capacity |
| `GUARD_COST_BP` | 200 | guard cost, share of cargo base value |
| `GUARD_RISK_FACTOR_BP` | 6500 | risk multiplier per guard (max 3) |
| `AMBUSH_LOSS_BP` | 3000 | share of each cargo good lost in an ambush |
| `MERCHANT_TREASURY_FILS` | 50,000 | initial treasury per merchant (5 USDC) |
| `FAUCET_FILS` | 50,000 | PLAY faucet: 500 dinars |
| `MAX_DEPOSIT_FILS` | 200,000 | total deposit cap per player (20 USDC) |
| `DAILY_WITHDRAW_CAP_FILS` | 100,000 | daily withdraw cap (10 USDC) |
| `STALL_FEE_BP` | 200 | player stall fee |
| `NPC_SHIP_UNITS_PER_TICK` | 4 | max units a house caravan moves per good per tick |
| `NPC_MIN_RATIO_GAP_BP` | 5000 | min stock/target ratio gap for shipping |
| `REBALANCE_EXCESS_FROM_BP` / `REBALANCE_PCT` | 15000 / 30% | merchant above 150% of its initial treasury gives 30% of the excess to the poorest |
| `HOUSE_RECYCLE_PCT` | 10 | % of the `house` balance paid to the poorest merchant per tick |

Constants in code: `packages/shared/src/world.ts` (TypeScript) and `contracts/caravan/src/math.rs` (Rust).

## 6. Golden vectors

Rust and TypeScript must both produce exactly these (spec 2.7). They are asserted in
`packages/shared/src/quote.test.ts` and `contracts/caravan/src/tests/math_tests.rs`.

| good | stock | spread_bp | bias_bp | bid | mid | ask |
|---|---|---|---|---|---|---|
| `grain` | 0 | 800 | 0 | 1248 | 1300 | 1352 |
| `grain` | 200 | 800 | 0 | 960 | 1000 | 1040 |
| `grain` | 400 | 800 | 0 | 720 | 750 | 780 |
| `iron` | 37 | 800 | 0 | 4565 | 4756 | 4946 |
| `spice` | 55 | 1200 | 250 | 10261 | 10916 | 11570 |
| `silk` | 12 | 400 | -1000 | 20815 | 21240 | 21664 |
| `silk` | 60 | 2000 | 1500 | 15525 | 17250 | 18975 |

These are the spec-v1.2 (K = 3000) values; spec-v1.1 (K = 4000) had 1296 / 1350 / 1404, 4807 / 5008 / 5208,
9827 / 10455 / 11082 and 21873 / 22320 / 22766 in rows 1, 4, 5 and 6. The derivations are in `spec/ECONOMY.md` 2.7.

## 7. World tick

`world_tick()` can be called by anyone; calls less than 55 s after the last scheduled tick do nothing; at most
10 missed ticks are run per call (DECISIONS D13). Order in the contract (spec-v1.1):

1. Production and consumption per city and good, clamped to `[0, 2 x target]`.
2. Treasury rebalancing: a merchant above 150% of its initial treasury gives 30% of the excess to the poorest merchant.
3. House recycling: 10% of the `house` balance goes to the poorest merchant.
4. House caravans: for each good, if the highest-stocked and lowest-stocked city differ by at least 50% of the target
   (integer test `(hi - lo) x 10000 >= 5000 x target`), up to 4 units move at the midpoint price, if the receiving
   treasury can pay. In the contract this step is done by the merchants calling `ship` (the worker does it);
   an `auto_ship` init flag (default off) runs it inside the tick.

Extra limits the contract added after the independent audit (`spec/CHANGELOG.md`, DECISIONS D24, D25):
`set_policy` moves spread and bias by at most 300 bp per call and once per tick; merchant `ship` only to a
destination below target stock and costing at most 25% of the receiving treasury per tick.

Player stalls: a player lists a good at their own price; another player in the same city buys; the seller pays
a 2% fee, rounded up, minimum 1 fils, to `house` (spec-v1.1). Stalls are implemented in the contract and the server
API; the UI has no stalls screen (the optional task was not done).

Other contract rules that shape play: the PLAY faucet gives 50,000 fils only if net worth (cash plus goods at base
price, including goods in stalls and in a caravan) is under 5,000 fils, with a one-hour cooldown (the mock uses 60 s);
withdrawals (LIVE only) have a 1,000-fils minimum and one open request per player.

## 8. Simulation results

### 8.1 Reference simulation (Appendix B), as printed by `pnpm sim`

Setup: greedy bots, 240 ticks (4 hours), seed 7, house caravans, rebalancing and recycling on. A greedy bot
buys where the price is lowest, travels, sells where it is highest, with no strategy beyond that. This is a
sanity check that the loop is profitable and money is conserved, not a forecast of player behaviour.

Commands run from the repository root on 2026-11-02 and again on 2026-11-05 (same output), with `MULT_K_BP = 3000`
(`pnpm sim --bots N --ticks 240 --seed 7`). On 2026-11-02 a local copy of the Python reference with K changed to 3000 printed
the same output for all three rows; since `083bc34` the repository's own `scripts/ref/economy_sim.py` does, and
`python scripts/analysis/validate.py` compares them (25 of 25 configurations identical to the shared TypeScript sim):

| Bots | Trips | Median profit per trip (fils) | p10 / p90 profit (fils) | "Merchant broke" events | Money conserved |
|---|---|---|---|---|---|
| 2 | 53 | 5,795 | -13,572 / 17,385 | 10 | yes, every tick |
| 5 | 190 | 1,392 | -17,013 / 14,836 | 47 | yes, every tick |
| 10 | 329 | 689 | -15,825 / 14,578 | 72 | yes, every tick |

spec-v1.1 (K = 4000) printed 64 / 5,944 / -15,756 / 19,810 / 23, 177 / 1,088 / -10,531 / 12,948 / 43 and
342 / 1,099 / -18,487 / 15,775 / 86 for the same rows (trips, median and broke events reproduced on 2026-11-05 by
`python scripts/analysis/validate.py --k 4000`, which runs the reference script with K patched to 4000 in memory; p10 and p90 were not re-compared).

Further output for 5 bots (same run): final bot net worth (fils) `[64404, 46522, 30924, 15897, 68025]` (one bot ends
well ahead of the rest), the mid price range seen for spice (9,000 - 15,600) and silk (15,000 - 26,000) equals the
range of the price curve at K = 3000, as it did at K = 4000 (scarce goods still reach the end of the range; see
`docs/ECONOMY_TUNING.md` section 4 for how often), and the money check
"merchants + house + bot cash = 450,000 (start 450,000; ambush destroys goods only)".

What the run shows, and what it does not:

- Money is conserved on every tick because production and consumption create and destroy goods, not money; so the
  largest loss the operator can suffer in LIVE equals the merchants' treasuries (4 x 5 = 20 USDC).
- A median trip is profitable, but p10 is negative: ambushes and price moves lose money on some trips.
- "Merchant broke" events grow with the number of bots (10, 47, 72; spec-v1.1: 23, 43, 86): with many players some treasuries run dry.
  Rebalancing, house recycling and the merchants' policy (wider spread when poor) exist to soften this.
- It does not say how real players behave, and the model is chaotic: one changed rounding moves later choices and
  medians swing by 2x (see 8.2).

### 8.2 The same simulation with the contract's rules

The contract differs from Appendix B in three places (`spec/CHANGELOG.md`, spec-v1.1):

| Difference | Appendix B / `pnpm sim` | Contract |
|---|---|---|
| Ambush loss | `q x 7000 // 10000` is kept, loss = ceil(30%) | loss = `floor(30% x qty)` (D1) |
| Tick order | production, house caravans, rebalancing, recycling | production, rebalancing, recycling, then merchant-driven shipping (D2) |
| Caravan gap test | float `(hi/target - lo/target) x 10000 >= 5000` | integer `(hi - lo) x 10000 >= 5000 x target` (D3) |

Reference rules with all three decisions on (seed 7, 240 ticks), `MULT_K_BP = 3000`, computed with
`scripts/analysis/econ_variant.py` (`contract_d123(mult_k=3000)`; the same function reproduces the spec-v1.1
figures 61/6,714/26, 132/933/44, 344/958/74 at K = 4000, and `python scripts/analysis/validate.py` checks both against the
CHANGELOG). There is no `pnpm` command that prints these:

| Bots | Trips | Median profit per trip (fils) | "Merchant broke" events | Money conserved |
|---|---|---|---|---|
| 2 | 53 | 8,175 | 16 | yes |
| 5 | 182 | 739 | 28 | yes |
| 10 | 314 | 704 | 66 | yes |

spec-v1.1 (K = 4000), as recorded in `contracts/caravan/DECISIONS.md` and `spec/CHANGELOG.md`: 61 / 6,714 / 26,
132 / 933 / 44, 344 / 958 / 74.

Each decision on its own at K = 3000 (run 2026-11-05, `contracts/caravan/DECISIONS.md` Table 2): floor loss only 52/5,759/12 (2 bots), 171/1,121/47 (5), 286/995/67 (10); tick order only 63/2,654/22, 179/1,128/26, 320/804/51; integer gap only 53/5,795/10, 190/1,392/47, 329/689/72 (no change at all). At K = 4000 (spec-v1.1, reproduced the same day): floor loss only 72/5,382/26 (2 bots), 158/1,723/45 (5), 341/1,341/94 (10);
tick order only 52/818/12, 183/1,236/30, 329/710/45; integer gap only 64/5,944/23, 165/1,352/40, 351/1,019/79. The
qualitative findings of 8.1 hold in every variant (money conserved, trips profitable, broke events grow with bots).
`packages/shared/src/sim.ts` was not changed to the contract rules: it reproduces Appendix B exactly and is the reference.

### 8.3 Economy tuning status

The master plan schedules economy tuning with live play for Day 11 and then a freeze. That has not happened: no
live play exists, and no parameter was changed after spec-v1 except `MULT_K_BP` in spec-v1.2 (4000 to 3000, from the offline study in `docs/ECONOMY_TUNING.md`, not from live play). The other parameters above are the initial ones. Known
observations that tuning should look at:

- A merchant's starting treasury is 500 dinars. One caravan of spice or silk can exceed it, so a sale can end in
  `MERCHANT_BROKE`; the UI caps the quantity to what the merchant can pay and says so
  (`apps/web/src/ui/SHARED_ISSUES.md` item 4). In the UI walkthrough run on 2026-11-01 the journey planner offered an
  estimate that only counted the part of a cargo the merchant could pay for.
- Spice is expensive: in the UI walkthrough on the mock under spec-v1.1 prices (run on 2026-11-01, K = 4000; not repeated), 10 spice at Bandar showed "You pay 1,121.80" (about 111 dinars
  each), more than the 500 dinars a PLAY player gets from the faucet. Re-observed at K = 3000 on 2026-11-06 (mock, a fresh
  player with 500 dinars): the Spice buy sheet in Bandar offered at most 4 units at 115.44 dinars each ("You pay 466.37",
  33.63 left), and 3 units cost 114.50 each ("You pay 346.93"). The conclusion holds: 500 dinars buy about 4 spice. Grain,
  salt and iron are the goods a new player can afford in quantity.
- Spice and silk prices sat on the clamps in the simulation at K = 4000 (86% of the time with 5 bots). spec-v1.2 lowers
  `MULT_K_BP` to 3000 (22%, low clamp only) instead of raising it; a higher K makes the clamping worse (`docs/ECONOMY_TUNING.md`
  section 4, section 7 proposal 3).

### 8.4 NPC evaluation

`docs/NPC_EVAL.md` runs the worker's decision loop against its own in-memory world with a scripted FAKE model
(not a language model) and the deterministic baseline policy: 240 ticks, 5 bots, seeds 7, 11 and 13, money
conserved in all nine runs. Those numbers are not comparable with section 8.1 (different world, different bots)
and say nothing about a real model's behaviour; the real-model replay was not run.
