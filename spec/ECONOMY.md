# ECONOMY

> Source: CARAVAN_ROAD_MASTER_PLAN.md, spec-v1, sections 2.1 and 2.5-2.10 (verbatim). Golden vectors are in 2.7.
>
> **spec-v1.2 (ADOPTED 2026-11-03):** this file shows `MULT_K_BP = 3000` (spec-v1.1: 4000) in 2.5, 2.6, 2.7 and 2.9. See `spec/CHANGELOG.md` and `docs/ECONOMY_TUNING.md` section 7, proposal 3.

### 2.1 Money

All money is integer **fils**. 1 dinar = 100 fils. 1 USDC = 10,000 fils = 100 dinar. The UI shows dinars only. No floats for money anywhere.

### 2.5 Parameters

| parameter | value | meaning |
|---|---|---|
| `TICK_SECONDS` | 60 | world tick length |
| `MULT_K_BP / MIN / MAX` | 3000 / 7500 / 13500 | price sensitivity and clamp of the price multiplier (bp); spec-v1.1 had K = 4000. With K = 3000 the multiplier never exceeds 13000, so the upper clamp is unreachable for stock >= 0; the lower clamp binds above 183.3% of target stock |
| `SPREAD_DEFAULT / MIN / MAX` | 800 / 400 / 2000 | buy/sell spread (bp); merchants move inside this range |
| `BIAS_MIN / MAX` | -1500 / +1500 | merchant mid-price bias (bp) |
| `TRADE_FEE_BP` | 100 | trade fee paid by the player (to house) |
| `MAX_QTY_PER_TRADE` / `CARGO_CAP` | 40 / 40 | max units per trade / caravan capacity |
| `GUARD_COST_BP` | 200 | cost per guard as % of cargo base value |
| `GUARD_RISK_FACTOR_BP` | 6500 | risk multiplier per guard (max 3 guards) |
| `AMBUSH_LOSS_BP` | 3000 | share of each cargo good lost in an ambush |
| `MERCHANT_TREASURY_FILS` | 50,000 | initial treasury per merchant (5 USDC) |
| `FAUCET_FILS` | 50,000 | PLAY faucet: 500 dinars |
| `MAX_DEPOSIT_FILS` | 200,000 | total deposit cap per player (20 USDC) |
| `DAILY_WITHDRAW_CAP_FILS` | 100,000 | daily withdraw cap (10 USDC) |
| `STALL_FEE_BP` | 200 | player stall fee |
| `NPC_SHIP_UNITS_PER_TICK` | 4 | max units a house caravan moves per good per tick |
| `NPC_MIN_RATIO_GAP_BP` | 5000 | min stock/target ratio gap for shipping |
| `REBALANCE_EXCESS_FROM_BP` / `REBALANCE_PCT` | 15000 / 30% | merchant above 150% of initial treasury gives 30% of excess to the poorest |
| `HOUSE_RECYCLE_PCT` | 10 | % of house balance paid to the poorest merchant per tick |

### 2.6 Price formulas (integer, basis points; 10,000 bp = 100%)

```
mult_bp(stock, target) = clamp( 10000 + 3000 * (target - stock) / target , 7500 , 13500 )
mid  = base * mult_bp / 10000
mid  = mid * (10000 + bias_bp) / 10000            # merchant bias
ask  = mid * (10000 + spread_bp/2) / 10000        # player buys at ask
bid  = mid * (10000 - spread_bp/2) / 10000        # player sells at bid
```

Trade rules:

- **Midpoint pricing.** Buying `qty` units is priced with `ask` at stock `stock - qty/2`; selling with `bid` at stock `stock + qty/2` (integer division).
- Fee 1% of the trade total, paid by the player to `house`.
- Max 40 units per trade; caravan capacity 40 units.
- The player must be in that city and not travelling.
- A merchant can only buy up to its treasury, otherwise `MERCHANT_BROKE`. If merchant stock would exceed `2 × target` after a player sale, reject with `BAD_REQUEST` ("warehouse full").

**Sign pitfall:** `target - stock` can be negative. Use `i128` (Rust) / `bigint` (TS) and **truncate toward zero** in every division. A floor division anywhere makes UI prices differ from contract prices (SLIPPAGE errors).

### 2.7 Golden vectors (Rust and TypeScript must both produce exactly these)

| good | stock | spread_bp | bias_bp | bid | mid | ask |
|---|---|---|---|---|---|---|
| `grain` | 0 | 800 | 0 | 1248 | 1300 | 1352 |
| `grain` | 200 | 800 | 0 | 960 | 1000 | 1040 |
| `grain` | 400 | 800 | 0 | 720 | 750 | 780 |
| `iron` | 37 | 800 | 0 | 4565 | 4756 | 4946 |
| `spice` | 55 | 1200 | 250 | 10261 | 10916 | 11570 |
| `silk` | 12 | 400 | -1000 | 20815 | 21240 | 21664 |
| `silk` | 60 | 2000 | 1500 | 15525 | 17250 | 18975 |

Values for `MULT_K_BP = 3000` (spec-v1.2). The seven `(good, stock, spread, bias)` inputs are the same as in spec-v1.1; rows 1, 4, 5 and 6 change, rows 2, 3 and 7 do not (spec-v1.1 table at K = 4000: `grain` 0: 1296 / 1350 / 1404; `iron` 37: 4807 / 5008 / 5208; `spice` 55: 9827 / 10455 / 11082; `silk` 12: 21873 / 22320 / 22766). They were produced with a local copy of `scripts/ref` (K changed to 3000, `scripts/ref` itself untouched), which at K = 4000 reproduces the old table exactly, checked against `tradeCost()` in `packages/shared`, and verified by hand (integer math, every division truncated):

```
grain 0:    mult = 10000 + 3000*(200-0)/200   = 13000   (below the 13500 clamp: NOT clamped any more; K=4000 gave 14000 -> 13500)
            mid = 1000*13000/10000 = 1300; ask = 1300*10400/10000 = 1352; bid = 1300*9600/10000 = 1248
grain 200:  mult = 10000 (stock = target); mid 1000; ask 1040; bid 960                                  (unchanged)
grain 400:  mult = 10000 + 3000*(-200)/200    = 7000 -> clamped to 7500 (low clamp, as at K=4000)
            mid = 750; ask = 750*10400/10000 = 780; bid = 750*9600/10000 = 720                          (unchanged)
iron 37:    mult = 10000 + 3000*63/100        = 11890; mid = 4000*11890/10000 = 4756
            ask = 4756*10400/10000 = 4946 (4946.24); bid = 4756*9600/10000 = 4565 (4565.76)
spice 55:   mult = 10000 + 3000*(-15)/40      = 8875; mid = 12000*8875/10000 = 10650
            bias +250: 10650*10250/10000 = 10916 (10916.25); ask = 10916*10600/10000 = 11570 (11570.96);
            bid = 10916*9400/10000 = 10261 (10261.04)
silk 12:    mult = 10000 + 3000*18/30         = 11800; mid = 20000*11800/10000 = 23600
            bias -1000: 23600*9000/10000 = 21240; ask = 21240*10200/10000 = 21664 (21664.8); bid = 21240*9800/10000 = 20815 (20815.2)
silk 60:    mult = 10000 + 3000*(-30)/30      = 7000 -> clamped to 7500 (low clamp, as at K=4000)
            mid = 15000; bias +1500: 17250; ask = 17250*11000/10000 = 18975; bid = 17250*9000/10000 = 15525   (unchanged)
```

Clamps: only the `grain` stock-0 row changes its clamp status (high clamp at K = 4000, unclamped at K = 3000). Rows 3 and 7 stay on the low clamp. At K = 3000 every real target (30, 40, 100, 120, 200) divides `3000 x (target - stock)` exactly, so `mult_bp` itself never rounds for real goods; the truncation-toward-zero rule still applies to `mid`, `ask` and `bid` and is tested on `mult_bp` with synthetic targets.

### 2.8 World tick

`world_tick()` runs every 60 s (anyone may call; minimum 55 s apart; at most 10 missed ticks per call):

1. Production/consumption per city/good with stock clamped to `[0, 2×target]`.
2. Treasury rebalancing: a merchant with treasury above 150% of its initial treasury gives 30% of the excess to the poorest merchant.
3. House recycling: 10% of the `house` balance goes to the poorest merchant each tick.
4. "House caravans" (merchants' `ship`): for each good, if the stock/target ratio gap between the richest-stocked and poorest-stocked city is at least 50% (5000 bp), up to 4 units move from the first to the second at the midpoint price of the two cities, if the destination treasury can pay. Merchants call `ship` themselves (Phase 5).

Player stall: a player in a city lists a good at their own price; another player in the same city buys; 2% fee to `house`.

### 2.9 Simulation facts (reference `economy_sim.py`, Appendix B; healthy-sanity check, not a forecast)

Greedy bots, 240 ticks (4 hours), seed 7, house caravans + rebalancing + recycling on. Figures for `MULT_K_BP = 3000` (spec-v1.2), from real `pnpm sim` runs and identical to a local copy of `scripts/ref/economy_sim.py` with K = 3000:

| Bots | Trips | Median profit per trip (fils) | "Merchant broke" events | Money conserved |
|---|---|---|---|---|
| 2 | 53 | 5,795 | 10 | yes |
| 5 | 190 | 1,392 | 47 | yes |
| 10 | 329 | 689 | 72 | yes |

The Appendix B figures of spec-v1 / spec-v1.1 (K = 4000: 64 / 5,944 / 23, 177 / 1,088 / 43, 342 / 1,099 / 86) no longer apply to the shared TypeScript sim and are what the unchanged `scripts/ref/economy_sim.py` still prints.

Findings (keep them; they shaped the rules): money is conserved because production/consumption only create/destroy goods; so the maximum loss for the operator in LIVE equals the merchants' treasuries (4 × 5 = 20 USDC). At K = 4000 prices often hit the clamps (scarce spice and silk stay expensive: at a clamp 86% of the time with 5 bots, `docs/ECONOMY_TUNING.md` section 4); spec-v1.2 lowers `MULT_K_BP` to 3000 (spice and silk at a clamp 22%) and does not raise it, because a higher K makes the clamping worse. With many players some merchant treasuries run dry (hence rebalancing, fee recycling and NPC behavior that lowers buy prices when treasury is low). Wealth concentrates (some bots win, some nearly go broke): in PLAY a faucet top-up for players with under 50 dinars is enough. Phase 1 ports the sim to TypeScript; on Day 11 tune parameters in `packages/shared`, then freeze.

### 2.10 Modes

| | PLAY (judges' default) | LIVE |
|---|---|---|
| Network | NEAR testnet | NEAR mainnet |
| Money | 500 free dinars from the faucet | real deposit through NEAR Intents |
| Withdraw | disabled | enabled with daily cap |
| Caps | none | 20 USDC total deposit per player; 10 USDC/day withdraw |
| Operator risk | zero | at most 20 USDC (merchant treasuries) |

NEAR Intents has no testnet and AI judges cannot deposit real money, so README steps are written for PLAY; LIVE gets evidence (video and transaction links). Contract has a `paused` switch.
