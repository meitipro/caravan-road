# ECONOMY

> Source: CARAVAN_ROAD_MASTER_PLAN.md, spec-v1, sections 2.1 and 2.5-2.10 (verbatim). Golden vectors are in 2.7.

### 2.1 Money

All money is integer **fils**. 1 dinar = 100 fils. 1 USDC = 10,000 fils = 100 dinar. The UI shows dinars only. No floats for money anywhere.

### 2.5 Parameters

| parameter | value | meaning |
|---|---|---|
| `TICK_SECONDS` | 60 | world tick length |
| `MULT_K_BP / MIN / MAX` | 4000 / 7500 / 13500 | price sensitivity and clamp of the price multiplier (bp) |
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
mult_bp(stock, target) = clamp( 10000 + 4000 * (target - stock) / target , 7500 , 13500 )
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
| `grain` | 0 | 800 | 0 | 1296 | 1350 | 1404 |
| `grain` | 200 | 800 | 0 | 960 | 1000 | 1040 |
| `grain` | 400 | 800 | 0 | 720 | 750 | 780 |
| `iron` | 37 | 800 | 0 | 4807 | 5008 | 5208 |
| `spice` | 55 | 1200 | 250 | 9827 | 10455 | 11082 |
| `silk` | 12 | 400 | -1000 | 21873 | 22320 | 22766 |
| `silk` | 60 | 2000 | 1500 | 15525 | 17250 | 18975 |

### 2.8 World tick

`world_tick()` runs every 60 s (anyone may call; minimum 55 s apart; at most 10 missed ticks per call):

1. Production/consumption per city/good with stock clamped to `[0, 2×target]`.
2. Treasury rebalancing: a merchant with treasury above 150% of its initial treasury gives 30% of the excess to the poorest merchant.
3. House recycling: 10% of the `house` balance goes to the poorest merchant each tick.
4. "House caravans" (merchants' `ship`): for each good, if the stock/target ratio gap between the richest-stocked and poorest-stocked city is at least 50% (5000 bp), up to 4 units move from the first to the second at the midpoint price of the two cities, if the destination treasury can pay. Merchants call `ship` themselves (Phase 5).

Player stall: a player in a city lists a good at their own price; another player in the same city buys; 2% fee to `house`.

### 2.9 Simulation facts (reference `economy_sim.py`, Appendix B; healthy-sanity check, not a forecast)

Greedy bots, 240 ticks (4 hours), seed 7, house caravans + rebalancing + recycling on:

| Bots | Trips | Median profit per trip (fils) | "Merchant broke" events | Money conserved |
|---|---|---|---|---|
| 2 | 64 | 5,944 | 23 | yes |
| 5 | 177 | 1,088 | 43 | yes |
| 10 | 342 | 1,099 | 86 | yes |

Findings (keep them; they shaped the rules): money is conserved because production/consumption only create/destroy goods; so the maximum loss for the operator in LIVE equals the merchants' treasuries (4 × 5 = 20 USDC). Prices often hit the clamps (scarce spice and silk stay expensive); raise `MULT_K_BP` if more sensitivity is wanted. With many players some merchant treasuries run dry (hence rebalancing, fee recycling and NPC behavior that lowers buy prices when treasury is low). Wealth concentrates (some bots win, some nearly go broke): in PLAY a faucet top-up for players with under 50 dinars is enough. Phase 1 ports the sim to TypeScript; on Day 11 tune parameters in `packages/shared`, then freeze.

### 2.10 Modes

| | PLAY (judges' default) | LIVE |
|---|---|---|
| Network | NEAR testnet | NEAR mainnet |
| Money | 500 free dinars from the faucet | real deposit through NEAR Intents |
| Withdraw | disabled | enabled with daily cap |
| Caps | none | 20 USDC total deposit per player; 10 USDC/day withdraw |
| Operator risk | zero | at most 20 USDC (merchant treasuries) |

NEAR Intents has no testnet and AI judges cannot deposit real money, so README steps are written for PLAY; LIVE gets evidence (video and transaction links). Contract has a `paused` switch.
