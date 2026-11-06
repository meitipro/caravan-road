# Contract decisions (Phase 2)

Decisions the contract had to take where `spec/` (spec-v1) is open or silent. `spec/` was not
edited. Items marked **PROPOSAL** need the owner's decision; if accepted they go into
`spec-v1.1` (announce in `PROGRESS.md`).

> **Status note, 2026-11-05.** The items marked PROPOSAL below were adopted as `spec-v1.1` (`spec/CHANGELOG.md`).
> The price sensitivity `MULT_K_BP` changed from 4000 to **3000** in `spec-v1.2` (merged 2026-11-03, tag
> `spec-v1.2`, PROGRESS D5): see D27 at the end of the decision list. Simulation figures in the next section
> are given for both values, each labelled with its K and each re-run on 2026-11-05.

## Open questions resolved in the contract

### D1. OPEN_QUESTIONS #6: ambush loss rounding — **PROPOSAL for spec-v1.1**

The contract follows the section 2.4 text: `lost = floor(qty x 3000 / 10000)` per good
(`math::ambush_loss`). Qty 11 loses 3 (the reference sim's `q * 7000 // 10000` loses 4).
The mock api-client already does the same, so UI and contract agree.

### D2. OPEN_QUESTIONS #11: world tick order — **PROPOSAL for spec-v1.1**

The contract follows the section 2.8 text order: (1) production/consumption, (2) treasury
rebalancing, (3) house recycling, (4) house caravans. Plan 5.3 says step 4 is merchant-driven
(`ship`), so by default `world_tick` runs steps 1-3 and merchants ship afterwards. With
`auto_ship = true` (init arg, default false) the contract also runs step 4 at the end of each tick.
The "poorest merchant" for steps 2 and 3 is computed once, before step 2 (as in Appendix B).

### D3. OPEN_QUESTIONS #12: house-caravan gap test — **PROPOSAL for spec-v1.1**

Integer test: `(stock_hi - stock_lo) x 10000 >= 5000 x target` (`math::ship_gap_ok`). At an exact
50% gap (e.g. silk 21 vs 6) it ships. Because all cities share the good's target, "highest/lowest
ratio" equals "highest/lowest stock"; ties go to the first city in the order dasht, madan, bandar,
shahr (OPEN_QUESTIONS #9). Payment is `(mid(hi) + mid(lo)) / 2 x qty` with mids at bias 0 (as the
reference). The automatic step 4 (`auto_ship`) follows the reference exactly; merchant-initiated
`ship` has extra limits (D25).

### Effect of D1-D3 on the section 2.9 simulation numbers

**Table 1: K = 4000 (spec-v1.1, the value when these decisions were taken).** `scripts/ref/economy_sim.py`
copied to a scratch file with each decision toggled (seed 7, 240 ticks, house caravans automatic as in
the reference). Baseline reproduces the published table. Re-run on 2026-11-05 with
`scripts/analysis/econ_variant.py` at `mult_k=4000` (which `validate.py` checks against the real reference
script with K patched in memory): every cell below reproduced exactly.

| Variant | 2 bots: trips / median / broke | 5 bots | 10 bots | Money conserved |
|---|---|---|---|---|
| spec-v1 table (reference) | 64 / 5,944 / 23 | 177 / 1,088 / 43 | 342 / 1,099 / 86 | yes |
| D1 only (floor loss) | 72 / 5,382 / 26 | 158 / 1,723 / 45 | 341 / 1,341 / 94 | yes |
| D2 only (2.8 order) | 52 / 818 / 12 | 183 / 1,236 / 30 | 329 / 710 / 45 | yes |
| D3 only (integer gap) | 64 / 5,944 / 23 | 165 / 1,352 / 40 | 351 / 1,019 / 79 | yes |
| D1 + D2 + D3 (contract) | 61 / 6,714 / 26 | 132 / 933 / 44 | 344 / 958 / 74 | yes |

Reading: the greedy-bot sim is chaotic (one changed rounding moves later choices), so medians
swing by 2x either way, but the qualitative findings of 2.9 hold: money is conserved, trips stay
profitable, "merchant broke" events grow with player count and stay in the same range (D2 even
lowers them because recycling reaches the poorest merchant before caravans spend its treasury).
Recommendation: accept D1-D3 as spec-v1.1 and update `packages/shared/src/sim.ts` + the 2.9 table
together, or keep spec-v1 numbers as "reference model" and note the contract's three differences.
(Outcome: D1-D3 were adopted in spec-v1.1; `sim.ts` kept the Appendix B rules as the reference.)

**Table 2: K = 3000 (spec-v1.2, current).** Same method and seed, run on 2026-11-05 with
`scripts/analysis/econ_variant.py` at its default `mult_k=3000` (`D1+D2+D3` is `contract_d123()`). The
first row is exactly what `pnpm sim --bots N --ticks 240 --seed 7` prints today (run on 2026-11-05) and what the
now K = 3000 `scripts/ref/economy_sim.py` prints; the last row is the contract-rule variant that
`spec/CHANGELOG.md` quotes for spec-v1.2. `python scripts/analysis/validate.py` reproduces the first and last rows.

| Variant | 2 bots: trips / median / broke | 5 bots | 10 bots | Money conserved |
|---|---|---|---|---|
| spec-v1.2 table (Appendix B, `pnpm sim`) | 53 / 5,795 / 10 | 190 / 1,392 / 47 | 329 / 689 / 72 | yes |
| D1 only (floor loss) | 52 / 5,759 / 12 | 171 / 1,121 / 47 | 286 / 995 / 67 | yes |
| D2 only (2.8 order) | 63 / 2,654 / 22 | 179 / 1,128 / 26 | 320 / 804 / 51 | yes |
| D3 only (integer gap) | 53 / 5,795 / 10 | 190 / 1,392 / 47 | 329 / 689 / 72 | yes |
| D1 + D2 + D3 (contract) | 53 / 8,175 / 16 | 182 / 739 / 28 | 314 / 704 / 66 | yes |

Reading: the same caveats hold (chaotic sim, single seed; use the ten-seed means in `docs/ECONOMY_TUNING.md`
for any comparison). At K = 3000 D3 alone changes nothing in these three runs. Money is conserved in every row.
The contract rules are D1 + D2 + D3 plus the contract-only rules D25 (merchant `ship` limits) and the warehouse
cap, which `docs/ECONOMY_TUNING.md` rule set C models in addition.

## Other choices (spec silent or plan detail)

- **D4. Faucet** (OPEN_QUESTIONS #4, audit 5): PLAY only; 1 hour cooldown; `+50,000`; only when
  the player's **net worth** is below 5,000 fils (50 dinars): `fils` + base value of inventory,
  stall escrow and cargo in transit (plan 5.3 says `fils < 5000`; counting goods stops "park your
  goods, tap the faucet"). The mock uses 60 s and no balance rule. Errors: `MODE_NOT_ALLOWED`,
  `BAD_REQUEST` (worth too high), `RATE_LIMIT` (cooldown).
- **D5. Stall fee** (audit 11, 12; plan 5.3 "2% fee on the seller side"): the **seller** pays. The
  buyer pays `price = qty x unit_price` (`limit_total` bounds `price`); the seller receives
  `price - fee`; `fee = ceil(price x 2%)` (at least 1 fils per sale) goes to `house`. This
  **replaces** the earlier buyer-pays choice and differs from OPEN_QUESTIONS #8's provisional answer
  and from the mock in `packages/shared/src/mock.ts` (buyer pays `floor(2%)` on top): **PROPOSAL**
  for spec-v1.1 and a mock update (shared owner).
- **D6. Stall presence**: plan 5.3 "buyer and seller in same city": `stall_buy` requires the seller
  to be in the stall's city and not travelling (`NOT_IN_CITY` otherwise). Max 5 open stalls per
  player (storage guard, `RATE_LIMIT`); unit price 1..1,000,000,000 fils.
- **D7. `limit_total`** (OPEN_QUESTIONS #7): trade buy `total + fee <= limit_total`; trade sell
  `total - fee >= limit_total`, as `tradeCost()` and the mock; stall buy `price <= limit_total`.
- **D8. Cargo limit**: as the mock, a buy (merchant or stall) is rejected with `CARGO_LIMIT` when the
  player's inventory would exceed 40 units; `start_journey` cargo is also capped at 40. Inventory can
  exceed 40 only by cancelling a stall.
- **D9. Journey record**: the journey lives in the player record; after `claim_journey` it stays with
  status `CLAIMED` (+ `ambushed`, `lost`) until the next journey, so the UI can show the result.
  `ARRIVED` is computed in views (`now >= arrives_at`). `claim_journey` returns the journey view
  (the server reads the player separately).
- **D10. Times**: views return nanoseconds as decimal strings in `*_ns` fields (`started_at_ns`,
  `arrives_at_ns`, `now_ns`, ...). The server converts to unix seconds (spec 2.12). Event `ts` is
  unix seconds (number).
- **D11. Risk formula**: one truncating division `base x 6500^g / 10000^g` (spec 2.4). For all six
  routes and 0-3 guards it equals the mock's step-by-step truncation (tested).
- **D12. Ambush roll**: `u64_le(sha256(random_seed || journey_id_le || account)[0..8]) mod 10000`,
  ambush if `roll < risk_bp`. `env::random_seed()` is fine for a demo, not tamper-proof (README).
- **D13. world_tick** (audit 10): a call less than 55 s after the last scheduled tick is a no-op
  returning `{ticks: 0}` (idempotent, no panic). Otherwise `n = clamp(elapsed / 60 s, 1, 10)` ticks
  run and the schedule advances by exactly `n x 60 s`. If more than 10 ticks were due, the excess is
  dropped (spec "at most 10 missed ticks") and the schedule keeps its 60 s phase. The first tick is
  due 55 s after `init`. Returns `{ticks, tick}`.
- **D14. Withdrawals** (audit 1): `PENDING -> SENT`, `PENDING -> DONE`, `SENT -> DONE`
  (`mark_withdraw` `status` is optional and defaults to DONE, which is how the server marks a
  confirmed send); `refund_withdraw` from PENDING or SENT, never twice, never after DONE, works
  while paused. Minimum 1,000 fils; **one open (PENDING/SENT) withdrawal per player**
  (`RATE_LIMIT`); daily cap 100,000 fils per UTC day (`floor(block_time_s / 86400)`); a refund does
  not give back daily-cap room. When a withdrawal ends (DONE or REFUNDED) its `dest_asset` and
  `dest_address` are cleared to free storage; id, account, fils, status, times and `reference` stay
  (all that `get_withdraw` / the server's reconciliation need for finished rows).
- **D15. Deposits** (audit 8): `credit_deposit(account_id, fils, reference)` is LIVE only (PLAY
  closes all money routes), returns `{credited: false}` without changes for an already credited
  `reference`, `RATE_LIMIT` above the player's 200,000-fils total or the operator daily cap.
  `operator_daily_cap` (fils per UTC day) is now a **required** init argument; the plan gives no
  number (suggest 200,000 = 20 USDC for mainnet).
- **D16. Pause** (audit 7): `paused` rejects every write with `PAUSED` except `refund_withdraw` and
  the admin methods. Owner or operator may **pause**; only the **owner** may unpause.
- **D17. Added methods** not in spec 2.14: owner `set_operator(operator)` (rotate a leaked operator
  key), owner `set_max_players(max_players)` (audit 2; never below the current count), views
  `get_withdrawals(from_id?, limit?)` (server reconciliation; ascending ids, at most 200 per call),
  `get_solvency`, `mt_batch_supply`.
- **D18. Register** (plan 5.2 storage drain, audit 2 and 3): `player_suffix` is a **required** init
  argument; only `<name>.<suffix>` accounts (sub-accounts the server creates) can register. A leading
  '.' is stripped (the server documents `.<RELAYER_ACCOUNT_ID>`); the rest must look like an account
  id (2..64 chars, `a-z 0-9 - _ .`). `max_players` caps the count and the owner can raise it. Owner,
  operator, merchants and the contract cannot register. After registering (and after any call that
  grows state: `start_journey`, `stall_create`, `request_withdraw`) the contract checks its balance
  still covers storage (`INTERNAL: storage full`).
- **D19. grant_discount not implemented** (optional; haggling is cut-list item 1). Adding it later
  changes trade pricing, so it would need `tradeCost()` support in `packages/shared` too.
- **D20. Net worth** (OPEN_QUESTIONS #2): views report `fils + sum(qty x base)` of the inventory, as
  the mock (the faucet rule in D4 additionally counts escrow and cargo).
- **D21. Error mapping**: every contract panic is `"<ErrorCode>: <message>"`. Access violations and
  unregistered callers are `UNAUTHENTICATED`; caps are `RATE_LIMIT`; overflow is `INTERNAL`.
  Failures raised by near-sdk or the runtime **before** contract code runs have no prefix (audit 9);
  the server should map them: JSON argument errors (`Failed to deserialize input from JSON`, unknown
  enum variant) and an attached deposit to a non-payable method (`Method ... doesn't accept deposit`)
  -> `BAD_REQUEST`; `Method init is private` / `already been initialized` -> `UNAUTHENTICATED`;
  gas exceeded, `LackBalanceForState`, any other text -> `INTERNAL`.
- **D22. Events**: hand-written NEP-297 lines (`EVENT_JSON:{"standard":"caravan","version":"1.0.0",
  "event":...,"data":[{...}]}`) to match plan 5.3 exactly. Extra events beyond 2.14: `paused`,
  `operator`. `stall_*` = `stall_create`, `stall_buy`, `stall_cancel`.
- **D23. MT views**: `mt_balance_of` returns a player's inventory, or a merchant's stock for a
  merchant account; `mt_supply` = merchants' stock + all goods held by players (inventory, stall
  escrow, caravans), tracked by a counter (no iteration). Goods in escrow/transit are not in
  `mt_balance_of`. No transfer methods ("MT-compatible views", not full NEP-245).
- **D24. Policy steps** (audit 4): `set_policy` may move `spread_bp` and `bias_bp` by at most 300 bp
  each per call, at most once per 60 s **and** once per world tick. A bias swing -1500 -> +1500
  takes 10 ticks, removing the one-step round-trip arbitrage against a merchant.
- **D25. Merchant `ship` limits** (audit 6): besides the gap test, `qty <= 4` and one shipment per
  good per tick per source, the destination must be **below its target stock** for that good, and a
  destination pays at most **25% of its treasury (at the start of the tick)** per tick for
  merchant-initiated shipments (`RATE_LIMIT`). The automatic `auto_ship` step keeps the reference
  rules.
- **D26. Wasm build flag**: near-sdk 5.30 uses on-chain host functions only under `cfg(near)` (set
  by cargo-near); `.cargo/config.toml` adds `--cfg near` (and `-C link-arg=-s`) for the wasm target
  so a plain `cargo build --target wasm32-unknown-unknown --release` matches cargo-near. The wasm
  built before commit `da30d32` lacked this flag and must not be deployed.
- **D27. `MULT_K_BP` = 3000 (spec-v1.2, 2026-11-03).** `math::MULT_K_BP` was 4000 and is now 3000 (the
  only contract change of spec-v1.2: the constant and the price-dependent test expectations; no rule, method or
  storage layout changed, so D1-D26 stand). The multiplier is `clamp(10000 + 3000 x (target - stock) / target,
  7500, 13500)`: its maximum is 13,000 (stock 0), so the 13,500 ceiling cannot be reached, and the 7,500 floor
  binds from 183.3% of target stock. For every real target (30, 40, 100, 120, 200) the product divides exactly,
  so `mult_bp` no longer truncates for real goods (the truncation rule still applies to `mid`, `ask`, `bid` and
  to synthetic targets in the tests). New golden vectors: `spec/ECONOMY.md` 2.7 and
  `contracts/caravan/src/tests/math_tests.rs`. Reason and evidence: `docs/ECONOMY_TUNING.md` (spice and silk at a
  price clamp 17-24% of the time instead of 66-89%, with nearly the same median profit per trip).
  Checked on 2026-11-05 on the merged tree: `cargo test` = 68 passed (CARGO_TARGET_DIR unset), `cargo clippy
  --all-targets` and `cargo fmt --check` clean, `cargo build --target wasm32-unknown-unknown --release` =
  389,493 bytes (a local Windows build with Rust 1.99.1; no reproducible-build claim, so no hash is recorded here and the
  deployed artifact's hash is a `TODO(owner)` in `docs/deployments.md`). Simulation figures with the contract rules at K = 3000: Table 2 above (last row).

## Audit findings (independent review) and how each was handled

All 12 findings were checked against the code and confirmed; each is fixed with a test.

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | withdraw spam fills storage | min 1,000 fils, one open per player, compaction (D14) | `withdraw_spam_is_bounded` |
| 2 | optional suffix, fixed cap | suffix required, `set_max_players` (D17, D18) | `register_enforces_suffix_and_player_cap` |
| 3 | leading-dot suffix | stripped in init (D18) | `player_suffix_accepts_a_leading_dot` |
| 4 | bias jump arbitrage | 300 bp step, once per tick (D24) | `set_policy_bounds_and_rate_limit` |
| 5 | faucet ignores goods | net worth incl. escrow, cargo (D4) | `faucet_uses_net_worth_including_escrow_and_cargo` |
| 6 | ship drains a treasury | destination deficit + 25%/tick budget (D25) | `ship_needs_destination_deficit_and_respects_budget`, `ship_rules` |
| 7 | operator can unpause | owner-only unpause (D16) | `pause_blocks_every_write_except_refund`, `access_control_rejects_wrong_accounts` |
| 8 | high default operator cap | required init argument (D15) | `server_facing_return_shapes` (config) |
| 9 | journey storage, unmapped errors | `check_storage` in `start_journey`; mapping documented (D21) | `start_journey_checks_storage` |
| 10 | tick drift | schedule advances by `n x 60 s` (D13) | `tick_schedule_advances_by_whole_ticks` |
| 11 | stall fee rounds to 0 | ceil, min 1 fils (D5) | `stall_fee_rounds_up_to_at_least_one_fils` |
| 12 | fee payer | seller pays (D5) | `stall_create_buy_fee_and_cancel` |

## Server alignment (`apps/web/src/server`, read only)

Aligned to what `contract/near.ts`, `contract/types.ts`, `game/cron.ts` and `SHARED_ISSUES.md`
expect: `credit_deposit` argument `account_id` (was `player`) returning `{credited}`;
`mark_withdraw({id, reference})` without `status` (defaults to DONE, PENDING -> DONE allowed);
`world_tick` returns `{ticks, tick}`; `claim_journey` returns the journey view; new
`get_withdrawals({from_id, limit})` (ascending ids; rows carry `id, account_id, fils, dest_asset,
dest_address, status`); `request_withdraw` returns its id as a bare JSON number; player suffix
accepts `.<RELAYER_ACCOUNT_ID>`.

Remaining differences (for the server / shared owners):

1. **No events view** (SHARED_ISSUES #2): the contract has no `get_events`; events exist only as
   NEP-297 logs. Use an indexer or ask for a ring-buffer view (storage cost per event).
2. **`get_stalls` is paginated** (at most 100 stalls scanned per call, `from_index`/`limit`); the
   server's `getStalls()` calls it once without paging.
3. **Stall fee** is now seller-side (D5); the shared mock and any UI text that shows "price + 2%"
   for the buyer must change.
4. **Faucet** rule is net worth < 50 dinars and a 1 h cooldown (D4); the mock uses 60 s.
5. **Withdrawals**: one open withdrawal per player and a 1,000-fils minimum (D14); the server should
   check these before reserving a row, and treat cleared `dest_*` fields on finished rows as normal.
6. **Unpause** needs the owner key (D16); the server's operator can pause but not unpause.
7. `get_withdrawals` returns at most 200 rows per call (the server asks for 200: OK).
