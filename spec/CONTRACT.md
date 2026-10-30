# CONTRACT

> Source: CARAVAN_ROAD_MASTER_PLAN.md, spec-v1, section 2.14 (verbatim). Details are filled in during Phase 2.

### 2.14 Contract interface (`contracts/caravan`)

| Method | Caller | Purpose |
|---|---|---|
| `register()` | player (meta-tx) | create profile in `bandar` (idempotent) |
| `faucet()` | player, PLAY only | +500 dinars with cooldown |
| `trade(...)` | player | buy/sell with a merchant |
| `start_journey(...)` / `claim_journey()` | player | travel and receive cargo |
| `stall_create / stall_buy / stall_cancel` | player | player stalls |
| `request_withdraw(...)` | player | debit and record withdrawal |
| `set_policy(spread_bp, bias_bp)` | merchant account (function-call key) | pricing within allowed range |
| `ship(to, good, qty)` | merchant account | move goods between merchants |
| `grant_discount(...)` | merchant account (optional) | temporary discount after haggling |
| `world_tick()` | anyone | world tick |
| `credit_deposit / mark_withdraw / refund_withdraw / set_paused` | operator (server) | deposits, withdrawals, pause |
| views | anyone | `get_world`, `get_player`, `get_merchant`, `get_stalls`, `get_players`, `get_quotes`, `get_journey`, `get_withdraw`, `get_config`, and read-only `mt_*` (NEP-245 subset) |

Events use NEP-297: `trade`, `policy`, `journey_started`, `journey_claimed`, `stall_*`, `tick`, `ship`, `deposit`, `withdraw_requested`, `withdraw_marked`, `faucet`.
