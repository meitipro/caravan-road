# Server (apps/web: `src/app/api`, `src/server`)

Next.js route handlers that bridge Google/Discord login and the Caravan contract. Every response is
`ApiResult<T>` from `@caravan/shared`.

> **Custody note.** Player keys are generated, encrypted (AES-256-GCM) and held **by the server**, so players never
> see a wallet. The accounts are custodial: whoever controls `KEY_ENC_SECRET` and the database can act as a player.
> This fits the "players never notice the chain" goal. Next step: passkeys or key export.

## Architecture

```
route.ts (thin)  ->  http.ts postRoute/getRoute/cronRoute  ->  game/*  ->  Services
                                                                    |-- db/ (repo, PGlite or pg)
                                                                    |-- contract/ (ContractClient: FakeContract | NearContract)
                                                                    |-- near/ (custody, relayer, accounts)
                                                                    |-- intents/ (IntentsClient: FakeIntents | unconfigured)
                                                                    |-- guards/ (rateLimit, mode, origin, cron, auth)
```

* `services.ts` builds the container lazily from `services.prod.ts` (env) or from tests (`__tests__/testkit.ts`).
* `contract/types.ts` is the typed client mirroring `spec/CONTRACT.md` (methods, args, views, panic convention).
  `FakeContract` follows `spec/ECONOMY.md` with the shared `quote()` / `tradeCost()`; `NearContract` uses
  near-api-js 7.x (docs cited in the file header).
* Meta-transactions (NEP-366): `Relayer.submit()` allowlists the method, forbids a deposit, enforces the relayer's
  1000/day budget, locks per account, decrypts the player's seed in memory, and `NearContract.playerCall()` signs a
  delegate action (`createSignedMetaTransaction`, zero deposit, 100-block TTL) that the relayer submits
  (`relayMetaTransaction`). The seed is zeroed afterwards (the OpenSSL key object cannot be wiped from JS).
* Accounts: `p<8hex>.<RELAYER_ACCOUNT_ID>`; states NONE -> PENDING -> CREATED -> REGISTERED, resumable and idempotent.

## POST pipeline (in this order)

same-origin check -> session (`UNAUTHENTICATED`) -> `Idempotency-Key` required -> zod body (`BAD_REQUEST`) ->
`PAUSE_ALL` (`PAUSED`) -> mode gate (`MODE_NOT_ALLOWED`) -> 30 actions/min/user (`RATE_LIMIT`) -> idempotency
(stored response replayed with `Idempotent-Replay: true`; same key + other body = `BAD_REQUEST`; in-flight = `RATE_LIMIT`)
-> custodial account -> relayer call -> panic mapping -> response stored.

## Endpoints

| Route | Notes |
|---|---|
| `GET /api/state` | world + me + last 20 events; world cached 1 s; creates the account on first sign-in |
| `POST /api/trade`, `journey/start`, `journey/claim`, `stall/create`, `stall/buy`, `stall/cancel` | player meta-transactions |
| `POST /api/faucet` | PLAY only |
| `POST /api/deposit/quote`, `GET /api/deposit/status`, `POST /api/withdraw` | LIVE only; caps 20 USDC total / 10 USDC per UTC day; minimum withdrawal 1,000 fils; Intents behind `IntentsClient` |
| `GET /api/tokens` | public, LIVE only, cached 60 s: `{assets: [{id, symbol, chain, decimals}]}` from 1Click `GET /v0/tokens`. Deposit `origin_asset` and withdraw `dest_asset` must be one of these ids |
| `GET /api/leaderboard`, `GET /api/npc/decisions`, `GET /api/proof/{merchant}` | public reads |
| `/api/cron/{tick,health,deposits,withdrawals}` | `Authorization: Bearer $CRON_SECRET`, GET or POST |
| `/api/auth/*` | Auth.js (Google, Discord), JWT sessions |

Error mapping: contract panics start with the ErrorCode (`SLIPPAGE: price moved`); anything unknown becomes
`INTERNAL` with a generic message and is logged redacted.

## Database

`src/server/db/migrations/0001_init.sql` (tables of plan 6.4 plus a few marked "extra" columns). Apply with
`DATABASE_URL=... pnpm --filter @caravan/web db:migrate`. Tests use PGlite (WASM Postgres, no server).

## Environment (names only, see `.env.example`)

`GAME_MODE`, `NEAR_NETWORK`, `NEAR_RPC_URL` (required on mainnet), `CARAVAN_CONTRACT_ID`, `RELAYER_ACCOUNT_ID`,
`RELAYER_PRIVATE_KEY`, `OPERATOR_ACCOUNT_ID`, `OPERATOR_PRIVATE_KEY`, `TREASURY_ACCOUNT_ID`, `TREASURY_PRIVATE_KEY`,
`KEY_ENC_SECRET` (32 bytes as 64 hex chars or base64), `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`,
`AUTH_DISCORD_ID/SECRET`, `CRON_SECRET`, `ONECLICK_JWT` (Phase 7). `loadEnv()` fails fast naming only the variables.

## Security properties (each has a test)

* No route returns key material; stored responses and logs contain no keys (`log.ts` redacts keys, bearer tokens,
  e-mails and account ids).
* Cron routes reject a missing or wrong bearer (401), and every request if `CRON_SECRET` is unset.
* No CORS headers; POSTs with a foreign `Origin` are refused.
* Deposits and withdrawals: compare-and-set state transitions, contract-side duplicate-reference protection, a
  send whose outcome is unknown stays `SENDING` for a human (never retried blindly), provider answers validated.
* PLAY closes all money routes; `PAUSE_ALL` (flags table) closes every POST and the money crons.

## Local end-to-end dev mode (no chain, no Postgres server, no OAuth)

Runs the UI against the REAL route handlers. Exact command (from the repository root):

```
NEXT_PUBLIC_MOCK=0 SERVER_BACKEND=dev DEV_LOGIN=1 GAME_MODE=PLAY pnpm --filter @caravan/web dev
```

(PowerShell: `$env:NEXT_PUBLIC_MOCK="0"; $env:SERVER_BACKEND="dev"; $env:DEV_LOGIN="1"; $env:GAME_MODE="PLAY"; pnpm --filter @caravan/web dev`.)
Optional `DEV_TICK_SECONDS=5` makes the world tick faster (default 60).

* `SERVER_BACKEND=dev` selects `services.dev.ts`: `FakeContract` in strict mode (the rules of
  `contracts/caravan/DECISIONS.md`: faucet only below 50 dinars of net worth, seller-pays ceil 2% stall fee, minimum
  withdrawal, one open withdrawal, policy steps, tick schedule), PGlite persisted in `apps/web/.data/` (it ignores
  itself via `.data/.gitignore`), an in-process ticker, and a deterministic NPC stand-in (the baseline rules of
  `apps/worker/src/baseline.ts`, re-implemented in `dev/ticker.ts`, calling only `set_policy` and `ship`).
  The contract state is saved to `.data/dev-contract.json`, so accounts and balances survive restarts. Delete
  `.data/` for a fresh world. Dev divergence from the contract: the faucet cooldown is 60 s instead of 1 h.
* Dev login: `POST /api/dev/login {"name":"Sara"}` sets a signed `caravan_dev` cookie (the signing secret is generated
  into `.data/`). `GET /api/dev/login?name=Sara&next=/play` does the same and redirects (a link, no UI change needed);
  `/api/dev/logout` clears it. The route answers **404** unless `NODE_ENV != production`, `DEV_LOGIN=1`,
  `GAME_MODE=PLAY` and the request host is `localhost`, `127.0.0.1` or `[::1]`. **It cannot be enabled in production:**
  `getServices()`, the production wiring and the route modules throw at startup if `DEV_LOGIN=1` or
  `SERVER_BACKEND=dev` is set with `NODE_ENV=production` (or outside PLAY). Tests cover every refusal path.
* **Reset the world:** `pnpm --filter @caravan/web dev:reset` deletes `apps/web/.data` (stop the dev server first), or start
  once with `DEV_RESET=1` (wipes the database and contract snapshot, keeps the dev secrets; unset it afterwards or every
  restart wipes the world). **The market is kept playable:** after each tick the dev ticker calls
  `FakeContract.devKeepAlive()`, which lifts a good below 15% of its target to 30% and tops up a merchant treasury below
  20% of the initial one (minted, so the money audit still balances). This is a dev convenience, not a contract rule: the
  real tick, pricing and shipping rules are unchanged and nothing else calls it.
* PLAY closes the money routes, so deposit/withdraw answer `MODE_NOT_ALLOWED` here; the 1Click path is tested with
  `FakeIntents`.

## Review hardening (independent security review, 17 findings)

All 17 findings were verified in the code; none was wrong. Each has a test in
`src/server/__tests__/review-fixes.test.ts` (and updated older tests).

| # | Fix |
|---|---|
| 1 | The contract's return value of a relayed call is read from the receipt executed by the contract account (`parseOutcome`), never `Number(null)`. A withdrawal id must be a real integer (`parseContractId`); otherwise the DB row stays `RESERVED` and the cron links it by account and amount. A unique index forbids two rows for one chain withdrawal. Before sending or refunding, the cron calls `getWithdraw(id)` and requires the same account, amount and status `PENDING`. |
| 2 | Daily cap check and a `RESERVED` row are one transaction under a per-user advisory lock; a definite chain rejection cancels the reservation (`CANCELLED`). |
| 3 | Deposit cap: check and insert are atomic under a lock; every `PENDING`/`CREDITING` row counts (deadline or not); the cron re-checks the cap before crediting. |
| 4 | Provisioning (also on `GET /api/state`) checks `PAUSE_ALL`, a global 500 accounts/day cap, and a 3 attempts/minute per-user back-off. When it is refused, `/api/state` still returns the world with `me: null`. |
| 5 | Per-user relayer budget of 200 actions/day (checked first, so it does not consume the global 1000). An automatic nonce retry inside one `submit()` is not counted twice. |
| 6 | The `RESERVED` row is written before the chain call; `reconcileWithdrawals` (cron) attaches lost ids, adopts on-chain withdrawals with no row (alert), and cancels reservations with no chain counterpart after 15 minutes. |
| 7 | `/api/withdraw` and `/api/deposit/quote` fail closed (`PAUSED`) before anything is debited when `IntentsClient.configured` is false or the treasury (`treasuryBalanceFils()`) cannot cover the amount plus what is already owed. |
| 8 | Documented below. |
| 9 | Credits require `receivedFils`, recipient equal to `TREASURY_ACCOUNT_ID` and the quoted asset; the amount is `min(received, expected)`, stored in `credited_fils`. |
| 10 | Only `BAD_REQUEST` and `MODE_NOT_ALLOWED` contract refusals fail a deposit for good; everything else is retried. `FAILED` deposits raise an alert and are counted in `/api/cron/health` (`failed_deposits`) as the manual refund queue. |
| 11 | `PAUSE_ALL` is parsed case-insensitively; in LIVE a missing or unknown value counts as paused. |
| 12 | `KEY_ENC_SECRET` must be exactly 64 hex characters or canonical 44-character base64; passphrases are rejected. |
| 13 | Startup fails unless PLAY+testnet or LIVE+mainnet (and mainnet needs `NEAR_RPC_URL`); faucet and money routes and crons refuse to run when `getConfig().mode` differs from `GAME_MODE`. |
| 14 | Anonymous rate limits use the platform header `x-vercel-forwarded-for`, else the right-most `X-Forwarded-For` hop (never the left-most), plus one shared bucket for all anonymous reads. Assumption: exactly one trusted proxy in front of the app. |
| 15 | `/api/state` events are filtered per event type (`PUBLIC_EVENT_FIELDS`); account ids, sellers, buyers, references and money-event details are dropped, `tx_hash` is kept. |
| 16 | Clients get a fixed message per ErrorCode; the raw panic text is logged through the redacting logger only. |
| 17 | The route error path and the CLI scripts log through `redact()`. |

## Withdrawal lifecycle (LIVE)

`RESERVED` (cap reserved) -> `REQUESTED` (debited on chain, id known) -> `SENDING` (cron claimed it) ->
`SENT` (treasury paid the 1Click deposit address; the contract is marked **SENT**, not DONE, so a refund stays possible)
-> `FINALIZING` (a cron run is closing it) -> `DONE` (provider success; contract DONE) or `REFUNDED` (provider
REFUNDED/FAILED; `refund_withdraw` returns the dinars). Every chain step first reads `getWithdraw()` (same account and
amount, expected status), so concurrent or restarted runs cannot mark twice or refund twice. A partial provider
refund, a chain mismatch, or an unknown send outcome goes to `FAILED`/`SENDING` for a human (alerts + `/api/cron/health`).
A `FINALIZING` row whose run died is taken over after 5 minutes. The provider's quote `signature` is stored in
`deposits.quote_signature` / `withdrawals.quote_signature` for disputes.

Environment: `ONECLICK_JWT` and `ONECLICK_USDC_ASSET_ID` are optional in PLAY and required together in LIVE
(`loadEnv()`); the asset id must look like `nep141:<contract>`.

## Contract parity fixes (server vs `contracts/caravan`)

Ground truth is `contracts/caravan/src/*.rs` and `fixtures/contract-json.json`; `FakeContract` is a test double that follows it.

- **Paging (F5, F6).** `get_stalls` scans at most 100 stalls per call and applies its `city` filter inside that page, so
  `NearContract.getStalls` walks `from_index` 0, 100, 200... until a short page, never sends `city`, filters client-side
  and de-duplicates by id (cap 500 pages). `getLeaderboard` walks `get_players` pages until a short page; the loop is
  bounded by `get_world.player_count` plus two pages of slack and an absolute 5,000 players (`ContractClient.getPlayerCount`).
  Each leaderboard refresh (cached 5 s) is therefore up to 50 view calls on a huge world; cache longer or index off-chain if that ever matters.
- **Stale delegate (F7).** A delegate action whose nonce is old or whose `max_block_height` passed fails inside a receipt as
  `ActionError.kind.DelegateActionInvalidNonce{..numbers..}` / `DelegateActionExpired` (key or bare string, no panic text).
  Failure detection now reads object keys as well as strings, throws `StaleDelegateError`, and `NearContract.playerCall`
  re-signs (fresh Account: nonce and block height read again, 1.5 s pause) and relays once more. Safe because the inner call
  never ran. near-api-js throws failed outcomes (`throwOnFailure`), so a thrown error's `transactionResult` goes through the
  same classification (contract panics become `ContractPanic`; before this they surfaced as a plain error -> INTERNAL).
  A stale delegate rejected twice, and a failure before the transaction was sent, are marked "not executed"
  (`ApiError.notExecuted`); `POST /api/withdraw` then cancels the RESERVED row at once instead of leaving it for the
  900 s reconciliation. Any other INTERNAL (network error after sending, numeric protocol failure) stays RESERVED for
  reconciliation, deliberately.
- **Deposit caps (F8).** `credit_deposit` panics `RATE_LIMIT: player deposit cap reached` (lifetime per-player cap, never
  decreases) and `RATE_LIMIT: operator daily cap reached` (resets at UTC midnight). Only the first is permanent: the
  deposit goes to FAILED with an `ALERT` for manual refund review. Everything else RATE_LIMIT is retried.
- **Assets (F3).** `money.ts` checks `origin_asset` / `dest_asset` against `IntentsClient.listTokens()` before any quote, before
  the treasury check and before the reservation row / `request_withdraw` (the contract debits first). Unknown id ->
  `BAD_REQUEST "That asset is not supported"`; list unreadable -> `PAUSED` (fail closed).
- **Withdraw rules (F4).** Minimum `PARAMS.MIN_WITHDRAW_FILS` (1,000). One open withdrawal per player (DB rows RESERVED,
  REQUESTED, SENDING, SENT, FINALIZING block; a FAILED row blocks only while the chain still says PENDING/SENT). Daily cap =
  UTC calendar day of the request, refunded rows still count, only CANCELLED rows are free (the contract's `withdrawn_today`
  is never decremented). All three are checked before reserving and answer `BAD_REQUEST` with a specific message (the contract
  would answer `RATE_LIMIT` after the reservation). The reservation transaction re-checks open + cap under the per-user lock.

## Error identity across module copies

`ApiError` and `ContractPanic` are recognised by a `Symbol.for(...)` brand (`isApiError`, `isContractPanic` in
`errors.ts`), never by `instanceof`. `next dev` bundles each route with its own copy of the server modules, so a
container created by one route throws classes that another route's `instanceof` does not recognise; that turned every
mapped contract rejection into HTTP 500 `INTERNAL` (stalls walkthrough). A contract `UNAUTHENTICATED` panic (for
example "not your stall") is mapped to `BAD_REQUEST`, because only the server issues `UNAUTHENTICATED` for a missing
session.

## Known limitation: the relayer key is a full-access key on the parent account (finding 8)

Only a parent account can create `p<8hex>.<parent>`, and the plan's `<ROOT>` is not specified, so the server uses
`RELAYER_ACCOUNT_ID` as the parent and its key both creates accounts and relays meta-transactions. That key therefore
must be a **full-access key on an account that parents every player account**. This conflicts with plan 5.4
(least-privilege keys) and is accepted for the hackathon; the blast radius is the relayer account balance plus control
of the player sub-accounts (which hold almost nothing: gameplay money lives in the contract).

Recommended fix (not implemented, no new environment variables introduced): a separate low-balance root/factory
account whose full-access key is used only for account creation (for example in a once-a-day batch or a minimal
creation-only service), and a relayer account whose key can only relay (a function-call key cannot create accounts, but
a plain funded account that is not the parent can relay delegate actions). Players would then live under the factory
account (`p<8hex>.<factory>`), and the contract's `player_suffix` would be that account. Suggested variable names if
introduced later: `ACCOUNT_FACTORY_ID`, `ACCOUNT_FACTORY_PRIVATE_KEY`.

## Going live checklist (needs real services)

1. Postgres (Neon/Supabase) and `db:migrate`.
2. Google and Discord OAuth apps; callbacks `/api/auth/callback/google` and `/api/auth/callback/discord`.
3. Deployed contract and its address; relayer (full-access key, funded), operator key, optional treasury; `KEY_ENC_SECRET`
   generated by Mahdi and stored only in the host's secret store.
4. Reconcile contract view/argument names with `contract/near.ts` and `SHARED_ISSUES.md`.
5. Run `pnpm --filter @caravan/web smoke:testnet` (creates one real testnet account) and `scripts/smoke.sh` (Phase 3 task 5, not in this folder).
6. External cron hitting the four cron routes with the bearer; Phase 7: implement `IntentsClient` with the 1Click API.
