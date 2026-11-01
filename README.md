# Caravan Road

A browser pixel-art trading game on a desert silk road. Four cities, five goods, and four merchants that are meant to be
AI agents with their own NEAR accounts and treasuries: every minute each merchant sets its buy/sell spread and price
bias (and may ship goods to another city), and each decision is stored with its reason. Players buy where a good is
cheap, send a caravan along a risky route with 0 to 3 guards, and sell where it is scarce. The game state and rules
live in one NEAR smart contract; players sign in with Google or Discord and never see a wallet, a key or a fee.

**Status in one sentence: the game loop runs today only in a mock mode in the browser; the contract, server and AI
worker are implemented and tested offline, and none of them has been deployed or run against a live network.**
See "What is real and what is not" before trusting any other sentence in this file.

- Hackathon: NEAR HACKATHON (build window 2026-11-01 to 2026-11-14). Intended track: `games`. Other tracks are not
  claimed here: the AI loop has never run live and AI attestation is not verified (see below).
- Live demo (PLAY mode): TODO(owner): no deployment exists yet.
- Demo video / X post: TODO(owner).
- Team statement for the submission: TODO(owner). See "Timeline" below for the facts it has to match.

## Timeline (read this: the work did not all happen inside the hackathon window)

The window opened on 2026-11-01T00:00:00Z. This repository's first commit is dated 2026-10-23 01:16 +03:30
(2026-10-22 21:46 UTC). 31 commits, from 2026-10-22 21:46 UTC to 2026-10-31 18:39 UTC, predate the window: the
scaffold, the specification, the shared package and mock, the art pipeline, the UI on the mock, the server, the AI
worker and the smart contract (with its audit fixes). Commits inside the window are listed by
`git log --since=2026-11-01T00:00:00Z`. History was not rewritten. The organisers' rule is "build the project during the
hackathon"; whether this history is acceptable is their decision, and this README does not claim the project was built
entirely during the window.

Most code, tests, art and documentation were written by Claude Code (an AI coding assistant) in sessions directed by the
project owner, with separate agent sessions used for reviews; see `PROGRESS.md` for the order of work and `docs/CREDITS.md`.

## What it is / the problem

Games with real economies usually put a token first and a game second, and their markets are static or run by a
spreadsheet. Caravan Road tries the opposite: a small, legible trading loop where prices come from stock levels with
integer math, and the other side of every trade is a merchant whose behaviour is chosen by an agent with bounded
authority, so that a player can ask "why this price?" and get a recorded reason.

The loop (`spec/GAME.md`): sign in, get 500 free dinars (PLAY mode), buy a cheap good in a city that produces it, pick a
route and guards, travel 3 to 6 minutes, survive the ambush roll, sell where the good is scarce. Prices move after every
trade; merchants react once a minute; a leaderboard ranks net worth. A LIVE mode with real deposits through NEAR
Intents is designed and coded but has never run (see below).

## Try it in 2 minutes (mock mode: free, no wallet, no money, no network services)

This is the only way to play today. It runs the real UI against an in-memory simulated world
(`packages/shared/src/mock.ts`); nothing here touches NEAR, a database or an AI service. The login is a simulated flag
in the browser's localStorage. Needs Node 20+ (tested with v24.19.0), pnpm 10 (tested with 10.18.2) and an internet
connection the first time (`next/font` downloads the three UI fonts from Google Fonts; not tested offline).

| # | Do | You should see (observed on 2026-11-01; amounts drift because the mock moves prices every 5 s) |
|---|---|---|
| 1 | In a terminal at the repository root: `pnpm install` | finishes in seconds; a notice about ignored build scripts is harmless |
| 2 | `NEXT_PUBLIC_MOCK=1 pnpm --filter @caravan/web dev` (PowerShell: `$env:NEXT_PUBLIC_MOCK="1"; pnpm --filter @caravan/web dev`) | `Next.js 15.5.28`, `Local: http://localhost:3000`, `Ready` |
| 3 | Open http://localhost:3000 (it redirects to `/play`) | a login screen: "PLAY: Practice with free dinars", buttons "Continue with Google" / "Continue with Discord", and the line "Demo mode: this login is simulated and nothing leaves your browser." |
| 4 | Click "Continue with Google", then "Next" twice | a three-step card ("Buy where it is cheap", "Cross the desert", "Sell where it is scarce"); step 3 shows "You have 500.00" and a "Claim 500.00 dinars" button. The mock player already starts with 500 dinars; in the real contract a new player starts with 0 |
| 5 | Click "Claim 500.00 dinars", then "Start trading" | a toast "+500.00 dinars added", balance 1,000.00 in the top bar, then the "Silk Road" map with "You are in Bandar" |
| 6 | On the Bandar card click "Trade here", then "Buy" on Spice, lower the quantity to 5 with the "−" button, click "Buy for ..." | a toast like "Bought 5 Spice: -529.39 dinars"; "You hold 5" for spice; "Cargo 5 of 40 units". Spice costs about 105-111 dinars each, so 10 spice (1,121.80) is not affordable with 1,000 dinars: use 5 or fewer |
| 7 | Click "Why this price?" on the merchant panel | a drawer "Nahid's mind" with the merchant's mood, spread and bias bars and "Last decisions". In the mock this is fixture data: Bandar's reads "Fixture decision: stock is near target, keep the default policy." with the tag "Rule-based" and "No AI evidence yet". The fixture for Dasht carries the placeholder model `fixture-model` and request id `fixture-request-0001` with `attested: false` (`packages/shared/fixtures/decisions.json`). No real AI output exists in mock mode |
| 8 | Click "Plan a journey", reduce the cargo to 3 spice, choose Shahr, choose 1 guard | "Ambush risk 5.2%", "Travel time 3:00", "Guards 1 · 7.20 dinars", and an estimate per destination ("est. profit +69.27 dinars" in my run). Larger cargo of spice can show a loss, because Shahr's merchant only has 500 dinars to pay with (known issue, `apps/web/src/ui/SHARED_ISSUES.md` item 4) |
| 9 | Click "Send caravan to Shahr" | "On the road", a 3:00 countdown, "Aboard: Spice 3" |
| 10 | Wait 3 minutes, click "Claim your caravan" | "Safe arrival in Shahr" and "Selling it all here now would bring about 417.41 dinars" (an ambush, 5.2% chance, shows what was lost instead) |
| 11 | Click "Go to the market", "Sell" on Spice, click "Sell for ..." | a toast "Sold 3 Spice: +420.82 dinars (+103.82 profit)" in my run; profit is not guaranteed, it depends on the prices at that moment |
| 12 | Click "Ranks" | "Your rank #2", "Newbie 1,139.62 dinars", between fixture players (Silk Baron, Salt Queen, ...). The leaderboard here is fixture data plus you |

Stop the server with Ctrl+C. Reloading the page resets the mock world (a journey in progress is lost). The mock tick is
5 s, the real contract's is 60 s.

### Checks an AI agent or a judge without a browser can run (all verified on 2026-11-01)

| Command (from the repository root) | Result seen |
|---|---|
| `pnpm install --frozen-lockfile` | completes in seconds |
| `pnpm typecheck` | `packages/shared`, `apps/web`, `apps/worker`: Done |
| `pnpm test` | all three packages pass (counts in "Economy and tests") |
| `pnpm sim` | 5 bots, 240 ticks: `trips: 177 \| median profit/trip (fils): 1088`, `merchant-broke events: 43`, `money conserved on every tick: yes` |
| `pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7` | 160 decisions from a FAKE scripted model against an in-memory world, `money conserved on every tick: yes` |
| `cd contracts/caravan && cargo test` | `68 passed` (needs Rust 1.95+; about 2.5 minutes on first run) |

### LIVE mode (real money): not tried, cannot be tried yet

| # | Do | You should see |
|---|---|---|
| 1 | Sign in, open "Cash", choose an asset, enter an amount and a refund address | a deposit address, QR code, amount and deadline (UI built and screenshotted against canned data: `docs/screens/19-*.png` to `22-*.png`; the server side is built and tested with a mocked 1Click API) |
| 2 | Send the quoted amount from your own wallet | status moves to credited exactly once; dinars appear (caps: 20 USDC total deposit per player, 10 USDC per day withdrawal) |
| 3 | Withdraw to any supported asset and address | a USDC transfer from the treasury through 1Click; failures are refunded |

None of these steps has ever run against NEAR Intents or mainnet. NEAR Intents has no testnet. `docs/INTENTS.md` lists what
the owner must do for a first real test.

## How it works

```
 Browser                      Server (Next.js)                          NEAR
 UI -> api-client --HTTPS-->  /api/* routes
 (MOCK: in-memory world)        Auth.js (Google / Discord)
                                custody: player key encrypted in Postgres
                                relayer: NEP-366 meta-transaction -----> Caravan contract
                                views <--------------------------------  (balances, rules, events)
                                /api/cron/* (tick, health, deposits, withdrawals)
                                       |
                                    Postgres  <---- Worker: 4 merchant agents, one round per minute
                                                      reads views -> NEAR AI Cloud -> validate + clamp
                                                      -> set_policy / ship / world_tick -----> Caravan contract
```

- **Web UI** (`apps/web/src/app/play`, `src/components`, `src/ui`): Next.js 15 / React 19. Talks only to the api-client of
  `packages/shared`; with `NEXT_PUBLIC_MOCK=1` the client serves the simulated world. Chain vocabulary is confined to the
  Advanced drawer and the evidence page (`apps/web/src/ui/vocabulary.test.ts`).
- **Shared package** (`packages/shared`): types, zod schemas, constants, integer price math, fixtures, mock, and the
  TypeScript port of the reference economy simulation.
- **Server** (`apps/web/src/app/api`, `apps/web/src/server`): the 14 routes of `spec/API.md` plus four cron routes; Auth.js
  login; custodial player accounts; relayer; idempotency, rate limits, mode gate. See `docs/SERVER.md`.
- **Contract** (`contracts/caravan`): one `near-sdk` 5.30.0 contract with dinars, goods, merchants, journeys, stalls,
  deposits and withdrawals, so a trade is one atomic transaction. See `contracts/caravan/README.md`.
- **Worker** (`apps/worker`): the NPC loop. The model only sees bounded integers, returns JSON that is validated and
  clamped, and falls back to a deterministic baseline policy. See `spec/NPC.md`, `docs/WORKER.md`.
- **Intents client** (`apps/web/src/server/intents`): LIVE deposits and withdrawals through the 1Click API. See `docs/INTENTS.md`.
- **Art** (`tools/art`): all sprites are generated by code, palette-checked.

Full diagram and the trust and custody model: `docs/ARCHITECTURE.md`.

## NEAR technology used (where in the code)

"Written" means code and tests exist; "run" means it has executed against a real NEAR network. Nothing has run on a real
network yet.

| Tech | Used for | File | State |
|---|---|---|---|
| near-sdk contract (Rust, 5.30.0) | all game rules and money | `contracts/caravan/src/` (`lib.rs`, `game.rs`, `admin.rs`, `math.rs`, `views.rs`) | written; 68 unit/property tests pass; wasm builds (389,493 bytes); not deployed |
| Meta-transactions (NEP-366) | players sign, a relayer pays gas and submits | `apps/web/src/server/contract/near.ts` (`createSignedMetaTransaction`, `relayMetaTransaction`), `apps/web/src/server/near/relayer.ts` | written; tested with fakes; never run on a network |
| Sub-accounts and access keys | one account `p<8hex>.<relayer>` per player; merchants use function-call keys | `apps/web/src/server/near/accounts.ts`; merchant side in `apps/worker/src/chain-near.ts`; setup in `docs/DEPLOY.md` | written; no accounts exist yet, no function-call key has been created |
| Events (NEP-297) | contract events (`trade`, `policy`, `tick`, ...) | `contracts/caravan/src/events.rs` | written, unit tested |
| MT-compatible read-only views (a subset of NEP-245, not full NEP-245; goods cannot be transferred) | `mt_balance_of`, `mt_supply`, ... | `contracts/caravan/src/views.rs` | written, unit tested |
| NEAR AI Cloud (private inference) | merchant decisions | `apps/worker/src/brain.ts`, `models.ts`, `attest.ts` | written from the docs, tested with a mocked HTTP layer; never called the real service |
| NEAR Intents (1Click API) | LIVE deposits and withdrawals | `apps/web/src/server/intents/oneclick.ts` | written from the docs, tested with doc-derived fixtures; never called the real API |
| Social login | Google and Discord sign-in | `apps/web/src/server/auth/config.ts` (Auth.js v5) | written; not run with real OAuth apps |

## What is real and what is not

| Thing | Status |
|---|---|
| The UI | Real code, runs today, but only against the in-memory mock (fake login, fixture merchants, fixture leaderboard, 5 s tick). It has never been connected to the real server end to end. Screenshots of every screen at phone and desktop widths are in `docs/screens/` |
| Smart contract | Implemented and tested offline (68 tests). **Not deployed** to testnet or mainnet. No `near-workspaces` sandbox test exists, so the `#[private]` check on `init`, function-call key restrictions, real gas and real storage costs are untested. `grant_discount` (haggling) is not implemented. Built with plain `cargo`, not `cargo-near`, which was not available on the build machine |
| Server | Implemented and tested offline (route handlers, custody, relayer, cron, caps) against a fake contract and an in-memory Postgres (PGlite). **No real database, no OAuth app, no deployed contract, no host.** The testnet smoke script exists and has not been run |
| AI merchants | The worker is implemented and tested (177 tests) with a mocked NEAR AI client and a scripted FAKE model. **It has never called NEAR AI Cloud, never run against a deployed contract, never been deployed.** The numbers in `docs/NPC_EVAL.md` are for the fake model, not a language model; the real-model replay was not run |
| TEE attestation | The worker records the request id, the model id, hashes of the request and response and, when offered, the response signature. **It never verifies the TEE quote**: the verifier is not implemented, so `attested` is `false` in every decision the worker writes, and the UI never shows a verified mark. "Private AI (TEE)" with "evidence recorded" is the most this project claims |
| Testnet (PLAY) and mainnet (LIVE) | Neither has been used. PLAY (testnet, free dinars) is the judges' mode in the plan; LIVE (mainnet, real deposits) is the first thing to cut if time runs out |
| NEAR Intents / 1Click | Client and server flow written and tested offline. It never touched the real API; the auth header, the USDC asset id and whether the withdrawal deposit address accepts USDC are open until a first tiny live test (`apps/web/src/server/intents/OPEN_ISSUES.md`) |
| Art | Every sprite is generated by code in `tools/art` (Python + Pillow) from a 12-colour palette, not drawn by hand or by an image model; generated on 2026-10-30, before the window (`docs/CREDITS.md`) |
| Simulation figures | Printed by the reference simulation (`pnpm sim`, port of the master plan's Appendix B) and by tests, not by live play. Greedy bots, a sanity check, not a forecast (`docs/ECONOMY.md`). Economy tuning with live play has not happened |
| Custody | Players do not hold keys: the server generates, encrypts (AES-256-GCM) and holds every player's key, so the accounts are custodial. The relayer key is a full-access key. See "Security notes" |
| Audit | No professional audit. The contract and the server each had an independent review pass by a separate agent session, with all findings fixed or documented (`contracts/caravan/DECISIONS.md`, `docs/SERVER.md`) |
| Judge rehearsal, integration gate, demo video, X post, submission | Not done |

### Cut list status (master plan 0.3 rule 14)

| Item | Status |
|---|---|
| 1. Haggling | Cut: not implemented (no `grant_discount`, no player text ever reaches the model) |
| 2. Player stalls | Contract and server API implemented and tested; no UI screen |
| 3. LIVE withdrawals | Server flow, 1Click client and the cron follow-up of sent withdrawals (mark done, or refund on chain) written and tested offline; never run |
| 4. Mainnet | Not deployed |

Items the plan says must never be cut: trading, journeys, AI merchants on NEAR AI Cloud, meta-transactions, PLAY mode,
README, demo. Status: trading, journeys and PLAY mode run only in mock mode; the AI merchants and meta-transactions are
written and tested offline but have never run live; this README exists; the demo does not.

### Known limitations

- The relayer key is a full-access key on the parent account of all player accounts (`docs/SERVER.md`, finding 8).
- Player accounts are custodial; there is no key export or passkey.
- `cargo-near` was not used (it needs NASM on Windows); `contracts/caravan/.cargo/config.toml` passes cargo-near's wasm flags
  to plain `cargo`.
- Ambush randomness uses `env::random_seed()`, which block producers can influence.
- The contract has no events view: `/api/state` can only show events from transactions this server instance submitted.
- The `/api/proof/{merchant}` response shape was never specified; `OPEN_QUESTIONS.md` items 1, 2, 3, 7, 9, 10 and 13 are
  provisional behaviours.
- Cron routes need an external scheduler; none is configured.
- A new player's first `/api/state` call blocks while the server creates the account (expected to take a few seconds on a
  real network; never measured, and the UI has never been run against the real server).
- No root `LICENSE` file yet.

## Run it locally

```bash
pnpm install
# mock mode (see "Try it in 2 minutes"):
NEXT_PUBLIC_MOCK=1 pnpm --filter @caravan/web dev
# tests, types, lint, build:
pnpm test && pnpm typecheck
pnpm --filter @caravan/web lint
pnpm --filter @caravan/web build        # if you ran `dev` first, delete apps/web/.next before building
pnpm --filter @caravan/worker lint
# worker dry run (fake model, no network):
pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7
# economy simulation:
pnpm sim --bots 5 --ticks 240 --seed 7
# contract:
cd contracts/caravan && cargo test
cd contracts/caravan && cargo build --target wasm32-unknown-unknown --release
# art (needs Python 3 with Pillow and pytest):
cd tools/art && python -m pytest -q
```

Environment variable **names** (values go in `apps/web/.env.local` or the host dashboard, never in the repository; the
template is `.env.example`). The real server needs a deployed contract, Postgres and OAuth apps, so there is no "real mode
in 2 minutes".

| Component | Names |
|---|---|
| UI | `NEXT_PUBLIC_MOCK` (set to `1` for the mock; must be unset on a real deployment), `NEXT_PUBLIC_MODE` |
| Server, always | `GAME_MODE`, `NEAR_NETWORK`, `CARAVAN_CONTRACT_ID`, `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY`, `OPERATOR_ACCOUNT_ID`, `OPERATOR_PRIVATE_KEY`, `KEY_ENC_SECRET`, `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET` |
| Server, sign-in | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET` |
| Server, LIVE only | `NEAR_RPC_URL`, `TREASURY_ACCOUNT_ID`, `TREASURY_PRIVATE_KEY`, `ONECLICK_JWT`, `ONECLICK_USDC_ASSET_ID` |
| Worker | `NEAR_NETWORK`, `NEAR_RPC_URL`, `CARAVAN_CONTRACT_ID`, `MERCHANT_ACCOUNT_DASHT`, `MERCHANT_ACCOUNT_MADAN`, `MERCHANT_ACCOUNT_BANDAR`, `MERCHANT_ACCOUNT_SHAHR`, `KEY_DASHT`, `KEY_MADAN`, `KEY_BANDAR`, `KEY_SHAHR`, `DATABASE_URL`, `NEAR_AI_API_KEY`, `NEAR_AI_MODEL`; optional `NEAR_AI_BASE_URL`, `NEAR_AI_RESPONSE_FORMAT`, `WORKER_PERIOD_SECONDS`, `WORKER_STAGGER_SECONDS`, `WORKER_ID` |

`node scripts/check-env.mjs --target web|worker|all` prints which names are missing without printing values.
Deploying: `docs/DEPLOY.md`.

## Economy and tests

- Formulas, parameters, golden vectors, and which numbers come from the reference simulation versus the contract:
  `docs/ECONOMY.md`. NPC evaluation (fake model): `docs/NPC_EVAL.md`.
- `pnpm sim` (greedy bots, 240 ticks, seed 7; the Appendix B reference, which differs from the contract in three rules):

  | Bots | Trips | Median profit per trip (fils) | "Merchant broke" events | Money conserved |
  |---|---|---|---|---|
  | 2 | 64 | 5,944 | 23 | yes |
  | 5 | 177 | 1,088 | 43 | yes |
  | 10 | 342 | 1,099 | 86 | yes |

  The same simulation with the contract's rules (recorded in `contracts/caravan/DECISIONS.md` and `spec/CHANGELOG.md`, not
  reproducible with a command here): 61 / 6,714 / 26, 132 / 933 / 44, 344 / 958 / 74.
- Test counts, run on 2026-11-01:

  | Package | Command | Result |
  |---|---|---|
  | `packages/shared` | `pnpm --filter @caravan/shared test` | 35 passed (4 files) |
  | `apps/web` | `pnpm --filter @caravan/web test` | 272 passed (13 files) |
  | `apps/worker` | `pnpm --filter @caravan/worker test` | 177 passed (10 files) |
  | `contracts/caravan` | `cargo test` | 68 passed |
  | `tools/art` | `python -m pytest -q` | 25 passed |

  Typecheck passes for all three TypeScript packages; `pnpm --filter @caravan/web lint` and `build` pass; clippy and
  rustfmt on the contract were not re-run today. The count for `apps/web` changes as tests are added.

## Security notes

- **Custody.** The server holds every player's ed25519 key, encrypted with AES-256-GCM under `KEY_ENC_SECRET`; whoever has that
  secret and the database can act as any player. The relayer account's full-access key creates accounts and pays gas.
  The owner's full-access key is meant to stay on the owner's own machine. Merchants are meant to hold only function-call
  keys limited to `set_policy`, `ship` and `world_tick`; none exists yet. The operator key is limited by a daily cap inside
  the contract. Details: `docs/ARCHITECTURE.md`.
- **Keys and secrets.** Variables only; `.env*` is git-ignored except `.env.example`; the server's env loader and the worker
  report only variable names; logs redact keys, bearer tokens, e-mails and account ids. `bash scripts/secret-scan.sh` scans
  the tree (and, with `--history`, all commits); on 2026-11-01 the working tree was clean, and `--history` reported one
  key-shaped test constant in two old commits of `apps/web/src/server/__tests__/foundations.test.ts` that the owner has
  to confirm is not a real key.
- **Limits for real money (implemented, tested offline, never exercised live).** 20 USDC total deposit per player, 10 USDC
  per day withdrawal, minimum withdrawal 1,000 fils and one open withdrawal per player, an operator daily deposit cap, merchant
  treasuries of 5 USDC each (the maximum operator loss in the model: 20 USDC), PLAY mode closes every money route, a database
  `PAUSE_ALL` flag and a contract `paused` flag (the owner alone can unpause).
- **AI authority.** The model proposes JSON from bounded integers only; the worker validates and clamps; the merchant key can
  call only a few methods; the contract re-checks ranges, step sizes (300 bp per change, once per tick) and shipping limits.
  Worst case after a compromised model: a bad price inside the allowed range (`spec/NPC.md`).
- **Review results.** Contract: 12 findings, all fixed with tests (`contracts/caravan/DECISIONS.md`). Server: 17 findings, fixed
  or documented, each with a test (`docs/SERVER.md`). These were review passes by separate agent sessions, not a professional audit.

## License / credits

- No root `LICENSE` file exists yet: TODO(owner). The contract crate declares `license = "MIT"` in `contracts/caravan/Cargo.toml`.
- Credits and provenance (generated art, the three OFL-licensed UI fonts Pixelify Sans, Inter and Vazirmatn, build-time
  libraries): `docs/CREDITS.md`.
- Documents: `spec/` (the locked specification, `spec-v1` and `spec-v1.1` tags), `docs/ARCHITECTURE.md`, `docs/ECONOMY.md`,
  `docs/SERVER.md`, `docs/WORKER.md`, `docs/NPC_EVAL.md`, `docs/INTENTS.md`, `docs/DEPLOY.md`, `PROGRESS.md`.
