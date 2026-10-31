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
| `POST /api/deposit/quote`, `GET /api/deposit/status`, `POST /api/withdraw` | LIVE only; caps 20 USDC total / 10 USDC per day; Intents behind `IntentsClient` (Phase 7) |
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

## Going live checklist (needs real services)

1. Postgres (Neon/Supabase) and `db:migrate`.
2. Google and Discord OAuth apps; callbacks `/api/auth/callback/google` and `/api/auth/callback/discord`.
3. Deployed contract and its address; relayer (full-access key, funded), operator key, optional treasury; `KEY_ENC_SECRET`
   generated by Mahdi and stored only in the host's secret store.
4. Reconcile contract view/argument names with `contract/near.ts` and `SHARED_ISSUES.md`.
5. Run `pnpm --filter @caravan/web smoke:testnet` (creates one real testnet account) and `scripts/smoke.sh` (Phase 3 task 5, not in this folder).
6. External cron hitting the four cron routes with the bearer; Phase 7: implement `IntentsClient` with the 1Click API.
