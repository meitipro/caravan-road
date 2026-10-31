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
reference). `ship` by a merchant checks the gap between the caller's city and `to` (not the global
hi/lo pair), `qty <= 4`, one shipment per good per tick per merchant, destination cap and treasury.

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

- **D4. Faucet** (OPEN_QUESTIONS #4): plan 5.3 rule: PLAY only, only when `fils < 5000` (50 dinars),
  1 hour cooldown (`FAUCET_COOLDOWN_SECONDS = 3600`), `+50,000`. The mock uses 60 s and no balance
  rule; the UI should show the contract rule. Errors: `MODE_NOT_ALLOWED`, `BAD_REQUEST` (balance
  too high), `RATE_LIMIT` (cooldown).
- **D5. Stall fee payer** (OPEN_QUESTIONS #8 vs plan 5.3 "2% fee on the seller side"): the contract
  follows the adopted spec answer #8 and the mock: the **buyer** pays `qty x unit_price` to the
  seller plus `floor(2%)` to `house`; `limit_total` bounds `price + fee`. **PROPOSAL**: confirm
  #8 and drop the plan 5.3 wording.
- **D6. Stall presence**: plan 5.3 "buyer and seller in same city": `stall_buy` requires the seller
  to be in the stall's city and not travelling (`NOT_IN_CITY` otherwise). Max 5 open stalls per
  player (storage guard, `RATE_LIMIT`); unit price 1..1,000,000,000 fils.
- **D7. `limit_total`** (OPEN_QUESTIONS #7): buy `total + fee <= limit_total`; sell
  `total - fee >= limit_total`, as `tradeCost()` and the mock.
- **D8. Cargo limit**: as the mock, a buy (merchant or stall) is rejected with `CARGO_LIMIT` when the
  player's inventory would exceed 40 units; `start_journey` cargo is also capped at 40. Inventory can
  exceed 40 only by cancelling a stall.
- **D9. Journey record**: the journey lives in the player record; after `claim_journey` it stays with
  status `CLAIMED` (+ `ambushed`, `lost`) until the next journey, so the UI can show the result.
  `ARRIVED` is computed in views (`now >= arrives_at`).
- **D10. Times**: views return nanoseconds as decimal strings in `*_ns` fields (`started_at_ns`,
  `arrives_at_ns`, `now_ns`, ...). The server converts to unix seconds (spec 2.12). Event `ts` is
  unix seconds (number).
- **D11. Risk formula**: one truncating division `base x 6500^g / 10000^g` (spec 2.4). For all six
  routes and 0-3 guards it equals the mock's step-by-step truncation (tested).
- **D12. Ambush roll**: `u64_le(sha256(random_seed || journey_id_le || account)[0..8]) mod 10000`,
  ambush if `roll < risk_bp`. `env::random_seed()` is fine for a demo, not tamper-proof (README).
- **D13. world_tick**: a call less than 55 s after the last tick is a no-op returning 0 (idempotent,
  no panic, cron-friendly); otherwise `n = clamp(elapsed / 60 s, 1, 10)` ticks run and
  `last_tick_ns = now` (older missed ticks are dropped). The first tick is due 55 s after `init`.
- **D14. Withdrawals**: `PENDING -> SENT -> DONE` only; `refund_withdraw` from PENDING or SENT,
  never twice, never after DONE; works while paused. A refund does not give back daily-cap room.
  The withdraw day is `floor(block_time_s / 86400)` (UTC day).
- **D15. Deposits**: `credit_deposit` is LIVE only (PLAY closes all money routes), returns `false`
  without changes for an already credited `reference` (idempotent), `RATE_LIMIT` above the player's
  200,000-fils total or the operator daily cap. Operator daily cap is an init arg
  (`operator_daily_cap`, default 1,000,000 fils = 100 USDC/day); the plan gives no number.
- **D16. Pause**: `paused` rejects every write with `PAUSED` except `refund_withdraw` and the admin
  switches `set_paused` / `set_operator` (otherwise the game could never be unpaused).
- **D17. Added owner method `set_operator(operator)`**: not in spec 2.14; needed to rotate a leaked
  operator key without redeploying. Also added views `get_solvency` and `mt_batch_supply`.
- **D18. Register** (plan 5.2 storage drain): `max_players` cap (init) and optional `player_suffix`
  (only `<name>.<suffix>` accounts, i.e. accounts the server creates as sub-accounts). Owner,
  operator, merchants and the contract itself cannot register. After registering, the contract
  checks its balance still covers storage (`INTERNAL: storage full` otherwise).
- **D19. grant_discount not implemented** (optional; haggling is cut-list item 1). Adding it later
  changes trade pricing, so it would need `tradeCost()` support in `packages/shared` too.
- **D20. Net worth** (OPEN_QUESTIONS #2): `fils + sum(qty x base)` of the inventory, as the mock.
- **D21. Error mapping**: every panic is `"<ErrorCode>: <message>"`. Access violations and
  unregistered callers are `UNAUTHENTICATED`; caps are `RATE_LIMIT`; overflow is `INTERNAL`.
- **D22. Events**: hand-written NEP-297 lines (`EVENT_JSON:{"standard":"caravan","version":"1.0.0",
  "event":...,"data":[{...}]}`) to match plan 5.3 exactly. Extra events beyond 2.14: `paused`,
  `operator`. `stall_*` = `stall_create`, `stall_buy`, `stall_cancel`.
- **D23. MT views**: `mt_balance_of` returns a player's inventory, or a merchant's stock for a
  merchant account; `mt_supply` = merchants' stock + all goods held by players (inventory, stall
  escrow, caravans), tracked by a counter (no iteration). Goods in escrow/transit are not in
  `mt_balance_of`. No transfer methods ("MT-compatible views", not full NEP-245).
