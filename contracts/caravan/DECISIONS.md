# Contract decisions (Phase 2)

Decisions the contract had to take where `spec/` (spec-v1) is open or silent. `spec/` was not
edited. Items marked **PROPOSAL** need the owner's decision; if accepted they go into
`spec-v1.1` (announce in `PROGRESS.md`).

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

`scripts/ref/economy_sim.py` copied to a scratch file with each decision toggled (seed 7, 240
ticks, house caravans automatic as in the reference). Baseline reproduces the published table.

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
