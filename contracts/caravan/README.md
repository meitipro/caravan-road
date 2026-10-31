# Caravan Road contract (`contracts/caravan`)

One NEAR contract holds the whole game economy: dinars (integer **fils**), goods, the four
merchants, journeys, player stalls and withdrawals. Every trade is one atomic transaction.
Spec: `spec/CONTRACT.md`, `spec/ECONOMY.md`, `spec/GAME.md` (spec-v1); contract-specific choices:
[`DECISIONS.md`](DECISIONS.md).

- near-sdk **5.30.0** (newest stable on crates.io on 2026-10-31), Rust 1.95+ (tested with 1.99.1).
- Integer math only: `i128` prices with truncating division, identical to
  `packages/shared/src/quote.ts`; all money `u128` fils, all arithmetic `checked_*`
  (`clippy::arithmetic_side_effects` and `clippy::as_conversions` are denied in contract code).

## Build and test

```bash
cd contracts/caravan
cargo test                                             # 68 unit/property tests
cargo build --target wasm32-unknown-unknown --release  # target/wasm32-unknown-unknown/release/caravan.wasm
cargo clippy --all-targets && cargo fmt --check
```

`.cargo/config.toml` passes the same wasm flags as cargo-near (`-C link-arg=-s --cfg near`; without
`--cfg near` near-sdk 5.30 compiles off-chain fallbacks instead of host functions) and sets
`AWS_LC_SYS_PREBUILT_NASM=1` so the test-only dependency chain builds on Windows without NASM. `cargo near build` (wasm-opt, ABI,
reproducible build) is recommended before deploy but was not available on the build machine.

## Interface

Errors: every failure panics with `"<ErrorCode>: <message>"`, `ErrorCode` from spec 2.12
(`UNAUTHENTICATED`, `BAD_REQUEST`, `RATE_LIMIT`, `MODE_NOT_ALLOWED`, `NOT_IN_CITY`, `IN_TRANSIT`,
`NOT_ARRIVED`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_STOCK`, `MERCHANT_BROKE`, `SLIPPAGE`,
`CARGO_LIMIT`, `PAUSED`, `INTERNAL`). Money in JSON is a decimal string; times are nanoseconds as
strings in `*_ns` fields. Failures raised before contract code runs carry no prefix (bad JSON
arguments, a deposit on a non-payable method, gas, `LackBalanceForState`); map them as in
[`DECISIONS.md`](DECISIONS.md) D21.

| Method | Caller | Notes |
|---|---|---|
| `init(owner, operator, mode, merchant_accounts{dasht,madan,bandar,shahr}, max_players, player_suffix, operator_daily_cap, auto_ship?)` | contract account (`#[private]`) | treasuries 50,000 fils, stock = target; `player_suffix` may start with '.' |
| `register()` | player | profile in `bandar`, idempotent |
| `faucet()` | player | PLAY only, net worth (fils + goods incl. stalls and caravan) < 5,000 fils, 1 h cooldown, +50,000 |
| `trade(merchant, good, side, qty, limit_total)` | player | midpoint pricing, 1% fee to house |
| `start_journey(to, cargo{good: qty}, guards)` / `claim_journey()` | player | guard cost 2%/guard to house; ambush loses floor(30%); claim returns the journey |
| `stall_create(good, qty, unit_price)` / `stall_buy(stall_id, qty, limit_total)` / `stall_cancel(stall_id)` | player | buyer pays the price; seller pays ceil(2%) to house |
| `request_withdraw(fils, dest_asset, dest_address)` | player | LIVE only, min 1,000, one open at a time, 100,000 fils/day, debits first; returns the id (number) |
| `set_policy(spread_bp, bias_bp)` | merchant | 400..2000, -1500..1500, +-300 bp per change, once per 60 s and per tick |
| `ship(to, good, qty)` | merchant | qty <= 4, gap >= 50%, `to` below target, `to` pays <= 25% of its treasury per tick |
| `world_tick()` | anyone | `{ticks, tick}`; no-op within 55 s; at most 10 ticks per call |
| `credit_deposit(account_id, fils, reference)` | operator | LIVE only; duplicate reference returns `{credited: false}` |
| `mark_withdraw(id, status?, reference?)` / `refund_withdraw(id)` | operator | PENDING -> SENT -> DONE (status defaults to DONE); refund once |
| `set_paused(paused)` | pause: owner or operator; unpause: owner | blocks every write except `refund_withdraw` |
| `set_operator(operator)` / `set_max_players(max_players)` | owner | rotate the operator key / raise the player cap |

Views: `get_config`, `get_world`, `get_merchant(city)`, `get_quotes(city)`, `get_player(account_id)`,
`get_players(from_index?, limit?)` (max 100), `get_journey(account_id)`,
`get_stalls(city?, from_index?, limit?)`, `get_withdraw(id)`, `get_withdrawals(from_id?, limit?)`
(ascending, max 200), `get_solvency`, and
**MT-compatible read-only views** (a subset of NEP-245, not full NEP-245; goods cannot be
transferred): `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`,
`mt_tokens_for_owner`. Token ids: `grain`, `salt`, `iron`, `spice`, `silk`.

Events (NEP-297, one log line each):
`EVENT_JSON:{"standard":"caravan","version":"1.0.0","event":"trade","data":[{"account":...,"merchant":...,"good":...,"qty":...,"total":"...","fee":"...","ts":<unix s>}]}`.
Names: `trade`, `policy`, `journey_started`, `journey_claimed`, `stall_create`, `stall_buy`,
`stall_cancel`, `tick`, `ship`, `deposit`, `withdraw_requested`, `withdraw_marked`, `faucet`,
`paused`, `operator`.

## Randomness

Ambush rolls use `env::random_seed()` hashed with the journey id and account. This is fine for a
demo but **not tamper-proof** (block producers can influence the seed); production would use a
VRF (e.g. OutLayer's, to be verified in its docs).

## Security checklist (plan 5.4) and the tests that cover it

| Item | How | Test |
|---|---|---|
| Explicit access check on every method | owner / operator / merchant / registered player | `access_control_rejects_wrong_accounts`, `*_panics` |
| No unchecked arithmetic, no lossy `as` | `checked_*`, clippy denies | `cargo clippy` |
| No unbounded loops | fixed 4 cities x 5 goods; paginated `get_players` / `get_stalls` | — |
| No duplicate deposit credit | `credited_refs` set | `credit_deposit_is_idempotent_and_capped` |
| Withdraw debits first; refund once | status machine | `withdraw_status_machine_and_refunds` |
| `paused` closes every money path | `require_not_paused` | `pause_blocks_every_write_except_refund` |
| LIVE: faucet off, deposits capped; PLAY: money routes closed | mode checks | `faucet_disabled_in_live`, `play_mode_closes_money_routes`, `credit_deposit_operator_daily_cap` |
| Storage covered; storage-full test | balance check after state growth; required `player_suffix`, `max_players`, stall cap, one open withdrawal + compaction | `register_storage_full`, `start_journey_checks_storage`, `register_enforces_suffix_and_player_cap`, `withdraw_spam_is_bounded` |
| Money conservation / solvency | `players + treasuries + house + pending = seed + deposits + faucet - withdrawn` | `random_sequences_*` (49 seeds x 400 random actions), `simulation_240_ticks_*` |
| Keys | merchant accounts get function-call keys for `set_policy`/`ship` only; operator daily cap | deploy step (not in this folder) |

Not covered by unit tests (needs the `near-workspaces` sandbox, plan 5.5 task 6): the `#[private]`
check on `init`, function-call key restrictions, real gas and storage costs.
