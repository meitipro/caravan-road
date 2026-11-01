# Deploy guide (for Mahdi)

Nothing in this guide has been run against a live network. The commands marked **[verified in docs]** were copied
from docs.near.org (page `tools/near-cli`, read 2026-11-01); commands marked **[local, tested]** were run in this
repository on 2026-11-01; anything marked **[interactive]** means the near-cli-rs syntax was not found in the
documentation, so use the interactive menu (`near` with no arguments; it prints the equivalent one-line command at
the end) and check it against `near --help`. Names in angle brackets are values you choose or read from your own
accounts. This guide never contains a value: every secret is set by you in `.env.local` (web: `apps/web/.env.local`)
or in the host dashboard, and never pasted into chat, a commit or a log.

Rules that apply to every step (master plan 0.3): mainnet signing, spending credits and making the repository public
are your own actions; deploy to mainnet only after the full PLAY loop works on testnet.

## 0. Tools

```bash
node --version      # repository tested with v24.19.0; package.json says >=20
pnpm --version      # packageManager is pnpm@10.18.2
rustc --version     # contract needs Rust 1.95+; tested with 1.99.1
rustup target add wasm32-unknown-unknown
npm install -g near-cli-rs@latest      # [verified in docs]  (other install options are on the same page)
```

`cargo-near` is **not** installed on the development machine (its build needs NASM on Windows). The steps below use
plain `cargo`, which `contracts/caravan/.cargo/config.toml` configures to pass the same flags as cargo-near. If you
can install cargo-near, `cargo near build` (wasm-opt, ABI, reproducible build) is recommended before a mainnet deploy.

## 1. Before anything: tests and secret scan [local, tested]

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
(cd contracts/caravan && cargo test)       # about 2.5 minutes the first time
bash scripts/secret-scan.sh                # exit 0 = nothing suspicious (file:line only is ever printed)
```

Run `bash scripts/secret-scan.sh` before every push; add `--history` once before making the repository public.
`node scripts/check-env.mjs` (section 7) checks that the required variable names are set.

## 2. Testnet accounts

Roles (names are your choice; I never invent them). All must be different accounts:

| Role | Used for | Key that must exist | Where the key lives |
|---|---|---|---|
| `<OWNER>` | owns the contract config (set operator, raise player cap, unpause) | full access | your own machine only, never a server |
| `<CONTRACT>` | the account the contract is deployed to; `CARAVAN_CONTRACT_ID` | full access (to deploy and call `init`) | your own machine |
| `<OPERATOR>` | server calls `credit_deposit`, `mark_withdraw`, `refund_withdraw`, `set_paused` | `OPERATOR_PRIVATE_KEY` | host environment |
| `<RELAYER>` | pays gas for players and is the parent of all player accounts `p<8hex>.<RELAYER>`; `RELAYER_ACCOUNT_ID` | `RELAYER_PRIVATE_KEY`, **full access** (known limitation, `docs/SERVER.md` finding 8) | host environment |
| `<MERCHANT_DASHT>`, `<MERCHANT_MADAN>`, `<MERCHANT_BANDAR>`, `<MERCHANT_SHAHR>` | the four AI merchants | one **function-call** key each (section 4) | worker host environment |
| `<TREASURY>` (LIVE only) | hot wallet for deposits and withdrawals | `TREASURY_PRIVATE_KEY` | host environment |

Create a testnet account with the faucet **[verified in docs]** (repeat for each role):

```bash
export ACCOUNT_ID=<ACCOUNT>.testnet
near account create-account sponsor-by-faucet-service $ACCOUNT_ID autogenerate-new-keypair save-to-keychain network-config testnet create
```

Sub-accounts (for example merchants under your root account) and funding transfers: **[interactive]** (`near`, then
`account`, then the create-account and transfer options).

Funding facts from the code, so you can size the balances (all in NEAR, you decide the amounts):

- Each new player costs the relayer 0.01 NEAR (`ACCOUNT_FUNDING_YOCTO` in `apps/web/src/server/contract/near.ts`,
  marked "VERIFY on the testnet smoke run") plus gas. `/api/cron/health` alerts when the relayer drops below 2 NEAR.
- The contract account pays for storage (1 NEAR per 100 KB, docs.near.org storage staking; the wasm is 389,493
  bytes, so roughly 3.9 NEAR before any player data). The contract refuses to grow state when its balance no longer
  covers storage (`INTERNAL: storage full`).

## 3. Build the contract [local, tested]

```bash
cd contracts/caravan
cargo build --target wasm32-unknown-unknown --release
# output: target/wasm32-unknown-unknown/release/caravan.wasm   (389,493 bytes on 2026-11-01)
```

`.cargo/config.toml` adds `-C link-arg=-s --cfg near` for the wasm target. Without `--cfg near` near-sdk 5.30 compiles
off-chain fallbacks instead of host functions, so a wasm built without it must never be deployed (DECISIONS D26;
anything built before commit `da30d32` has this problem). Rebuild from a clean commit rather than reusing an old file.

## 4. Deploy and initialise on testnet

`init` is `#[private]`: only the contract account can call it, and it can be called once. Deploy without init, then
call `init` signed by the contract account itself. **[verified in docs]** forms:

```bash
export CONTRACT_ID=<CONTRACT>.testnet
near contract deploy $CONTRACT_ID use-file target/wasm32-unknown-unknown/release/caravan.wasm without-init-call network-config testnet sign-with-keychain send
```

Build the `init` arguments from the account ids you created (prints JSON, validates the same rules the contract
enforces; it handles no keys) **[local, tested]**:

```bash
node scripts/init-args.mjs --mode PLAY --owner <OWNER> --operator <OPERATOR> \
  --dasht <MERCHANT_DASHT> --madan <MERCHANT_MADAN> --bandar <MERCHANT_BANDAR> --shahr <MERCHANT_SHAHR> \
  --relayer <RELAYER> --max-players <N> --operator-daily-cap <FILS>
```

`--relayer` becomes `player_suffix` (`.<RELAYER>`), which must equal the server's `RELAYER_ACCOUNT_ID` because the server
creates `p<8hex>.<RELAYER_ACCOUNT_ID>` accounts and the contract only registers accounts with that suffix (DECISIONS D18).
`--max-players` caps registrations (the owner can raise it later; the unit tests use 1000). `--operator-daily-cap` is the
per-UTC-day limit on `credit_deposit` in fils; it is required even in PLAY (DECISIONS D15 suggests 200000 = 20 USDC for
mainnet). Then call `init` **[verified in docs]** syntax for `call-function`, with the JSON that the script printed:

```bash
near contract call-function as-transaction $CONTRACT_ID init json-args '<JSON FROM init-args.mjs>' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as $CONTRACT_ID network-config testnet sign-with-keychain send
```

(On Windows PowerShell and cmd, the single quotes around JSON behave differently; use Git Bash, or the interactive menu.)

Check **[verified in docs]** (view call form):

```bash
near contract call-function as-read-only $CONTRACT_ID get_config json-args '{}' network-config testnet now
```

The answer should show `mode` `PLAY`, `paused` false, your `owner` and `operator`, the `player_suffix`, `max_players` and `operator_daily_cap` you passed, and the four merchant accounts. If `init` was already called, the second
call fails: that is the intended behaviour.

### Merchant function-call keys

Each merchant account gets a **new** key pair that is limited to this contract, so the AI can never use a full-access
key. For each of the four merchants:

1. Generate a key pair outside the repository **[verified in docs]**:
   `near generate-keypair save-to-file <PATH-OUTSIDE-THE-REPO>/<merchant>-key.json`. The file holds the private key:
   keep it only where you will copy it into the worker's host dashboard, then delete it.
2. Add the public key to the merchant account as a function-call key **[interactive]**: `near`, then `account`, then
   `add-key`, then `grant-function-call-access`. Values: receiver = `<CONTRACT>`; methods = `set_policy,ship`; for the
   `shahr` key also `world_tick` (the worker sends `world_tick` from the shahr key, `docs/WORKER.md`). Choose a small
   gas allowance (the NEAR docs: the allowance pays gas and the key stops working when it is used up, so watch it).
3. Put the private key string (`ed25519:...`) into the worker's `KEY_DASHT`, `KEY_MADAN`, `KEY_BANDAR` or `KEY_SHAHR`
   in the host dashboard. Mahdi sets this in the host dashboard; I never see it.

The merchants' game treasuries (50,000 fils each) live inside the contract and are created by `init`; the merchant
accounts themselves only need to exist on the network.

### Operator key

The server signs operator calls with `OPERATOR_PRIVATE_KEY` as plain zero-deposit function calls
(`operatorCall` in `apps/web/src/server/contract/near.ts`). A function-call key restricted to `credit_deposit`,
`mark_withdraw`, `refund_withdraw`, `set_paused` on `<CONTRACT>` should therefore be enough and is safer than a full-access
key. **Not tested**: confirm with the smoke run in section 6 before relying on it.

## 5. Database

Use a hosted Postgres (`docs/SERVER.md` mentions Neon or Supabase). Mahdi sets `DATABASE_URL` in `apps/web/.env.local`
or the host dashboard. The worker uses the same database.

```bash
# from the repository root; the file is read by Node, the value is not printed
cd apps/web && pnpm exec tsx --env-file=.env.local src/server/db/run-migrate.ts
# prints "applied: 0001_init, ..." or "database is up to date"
```

(`pnpm --filter @caravan/web db:migrate` runs the same script when `DATABASE_URL` is already exported in the shell.)
The `--env-file` mechanism was checked with `tsx` in this repository on 2026-11-01; the migration itself was only run
against the in-memory PGlite database in the tests, never against a hosted Postgres.

Kill switch: `update flags set value = 'true' where key = 'PAUSE_ALL';` closes every POST and the money crons
(`docs/SERVER.md`). Set it back to `'false'` to reopen.

## 6. Server (apps/web)

1. OAuth apps. Google: create an OAuth client with the callback `https://<HOST>/api/auth/callback/google`. Discord:
   callback `https://<HOST>/api/auth/callback/discord`. You create them in the provider consoles.
2. Environment (names only; the full list with notes is `.env.example`). Mahdi sets each of these in
   `apps/web/.env.local` or the host dashboard:

   | Name | Note |
   |---|---|
   | `GAME_MODE` | `PLAY` with `NEAR_NETWORK=testnet`; `LIVE` with `mainnet` (a mix refuses to start) |
   | `NEAR_NETWORK` | `testnet` or `mainnet` |
   | `NEAR_RPC_URL` | required on mainnet; the worker requires it always. Pick an endpoint from docs.near.org (RPC providers) |
   | `CARAVAN_CONTRACT_ID` | `<CONTRACT>` |
   | `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` | secret key |
   | `OPERATOR_ACCOUNT_ID`, `OPERATOR_PRIVATE_KEY` | secret key |
   | `KEY_ENC_SECRET` | 32 random bytes as 64 hex characters or canonical base64. Generate it yourself, for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" \| clip`, and keep a backup: if it is lost, every stored player key becomes unreadable. No rotation procedure is implemented |
   | `DATABASE_URL` | secret |
   | `AUTH_SECRET`, `CRON_SECRET` | random secrets you generate the same way |
   | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET` | from the OAuth consoles |
   | `TREASURY_ACCOUNT_ID`, `TREASURY_PRIVATE_KEY`, `ONECLICK_JWT`, `ONECLICK_USDC_ASSET_ID` | LIVE only (`ONECLICK_JWT` and the asset id are required together in LIVE and must look like `nep141:<contract>`); see `docs/INTENTS.md` |

   `NEXT_PUBLIC_MOCK` must be **unset** on a real deployment (it switches the whole UI to the in-memory mock; it is read
   at build time).
3. Check the names are set, without printing values **[local, tested]**:

   ```bash
   node scripts/check-env.mjs --target web --mode PLAY --env-file apps/web/.env.local
   ```

4. Host: the plan names Vercel for the web app (`pnpm --filter @caravan/web build`, start `next start`). If you built after
   running `next dev`, delete `apps/web/.next` first (observed on 2026-11-01: a stale dev build directory made
   `next build` fail with a missing `pages-manifest.json`).
5. Smoke test against testnet (creates one real testnet account; prints PASS/FAIL only). The script reads the process
   environment, so load the file with Node:

   ```bash
   cd apps/web && pnpm exec tsx --env-file=.env.local src/server/scripts/smoke-testnet.ts
   ```

6. Cron. The four routes need an external scheduler that sends `Authorization: Bearer <CRON_SECRET>` (no scheduler is
   configured in this repository). Intervals from the plan: `tick` every minute, `deposits` and `withdrawals` every
   minute (LIVE), `health` every 5 minutes. One call, with the secret only in the environment **[local, tested against a
   local test server only]**:

   ```bash
   CRON_SECRET="$CRON_SECRET" node scripts/call-cron.mjs --base https://<HOST> --job health
   ```

## 7. Worker (apps/worker)

Needs an always-on host with auto-restart (`docs/WORKER.md` lists Railway, Fly.io, Render or a small VPS) and the same
`DATABASE_URL`. Keep it running until 2026-11-19.

1. NEAR AI Cloud: Mahdi creates the account, buys credits and sets `NEAR_AI_API_KEY` in the host dashboard. Choose a model
   from the live list, then set `NEAR_AI_MODEL`:

   ```bash
   pnpm --filter @caravan/worker try-brain -- --list      # needs NEAR_AI_API_KEY in the environment; no chat request
   pnpm --filter @caravan/worker try-brain                # sends ONE request (spends a few tokens); read the output
   ```

2. Environment names (secrets in the host dashboard): `NEAR_NETWORK`, `NEAR_RPC_URL`, `CARAVAN_CONTRACT_ID`,
   `MERCHANT_ACCOUNT_DASHT`, `MERCHANT_ACCOUNT_MADAN`, `MERCHANT_ACCOUNT_BANDAR`, `MERCHANT_ACCOUNT_SHAHR`, `KEY_DASHT`,
   `KEY_MADAN`, `KEY_BANDAR`, `KEY_SHAHR`, `DATABASE_URL`, `NEAR_AI_API_KEY`, `NEAR_AI_MODEL`; optional
   `NEAR_AI_BASE_URL`, `NEAR_AI_RESPONSE_FORMAT`, `WORKER_PERIOD_SECONDS`, `WORKER_STAGGER_SECONDS`, `WORKER_ID`.

   ```bash
   node scripts/check-env.mjs --target worker           # names only; exit 1 if something required is missing
   ```

3. Start command (the same one the plan and `docs/WORKER.md` give): `pnpm --filter @caravan/worker start`. The worker
   exits at startup with an error naming the missing variable if the configuration is incomplete.
4. After the first deploy, watch the logs for 10 minutes and check `GET /api/npc/decisions?merchant=<city>`; then test
   the fallback: set a wrong `NEAR_AI_API_KEY`, confirm rows switch to `source: baseline` and the game continues, then
   restore the key (`docs/WORKER.md`, "What needs a human to go live", step 4). Not done yet.

## 8. Verify the PLAY loop

With the server, worker and cron up: sign in with the real Google or Discord button, claim the faucet, buy a good, start a
journey, wait, claim, sell, open "Merchant mind" and see rows with `source` and a request id. This full loop has never
been run on a live network; the first run will probably find issues, which is why the plan has an integration gate.

## 9. LIVE / mainnet (only after PLAY works; every step is yours)

Follow `docs/INTENTS.md` ("What Mahdi must do for a real LIVE test"): a separate treasury account registered with USDC and
holding only a few USDC, `ONECLICK_JWT`, `ONECLICK_USDC_ASSET_ID` copied from the live token list, a mainnet contract
built from a clean commit and initialised with `--mode LIVE` and `GAME_MODE=LIVE`, `NEAR_NETWORK=mainnet`, `NEAR_RPC_URL`.
Do the tiny deposit and tiny withdrawal tests and keep the kill switches ready (`PAUSE_ALL`, and the contract's
`set_paused`). The cut list puts LIVE withdrawals and then mainnet itself first in line to be cut if time is short.

## 10. Before making the repository public (your action)

```bash
bash scripts/secret-scan.sh --history
bash scripts/secret-scan.sh --all     # long: lists every mention of the key-related words, names included
```

Read each reported `FILE:LINE`. The strict scan skips lines that contain words like "fake", "not-real" or
"placeholder". One known history finding: an older version of `apps/web/src/server/__tests__/foundations.test.ts`
(commits `497e91d`, `f753098`) contains a key-shaped `ed25519:` string; it looks like a test constant for the log
redaction test, but only you can confirm it is not a real key. If any real secret ever reached a commit, rotate it:
rewriting history is not enough once something is public.

## Helper scripts (`scripts/`)

| Script | What it does | Tested |
|---|---|---|
| `scripts/check-env.mjs` | `--target web\|worker\|all [--mode PLAY\|LIVE] [--env-file <path>]`: prints each required variable name as set or MISSING, never a value; exit 1 if something required is missing | yes: with a file of placeholder values and with exported variables; a sentinel string in the file never appears in the output |
| `scripts/secret-scan.sh` | `[--all\|--history]`: `git grep` for key-shaped strings, assigned secret literals, token shapes and tracked `.env` files; prints `FILE:LINE` only | yes: clean tree exits 0; a planted fake key and a planted assignment exit 1 |
| `scripts/init-args.mjs` | builds the contract `init` JSON from account ids you pass and validates the contract's own rules | yes: valid and invalid input |
| `scripts/call-cron.mjs` | calls one cron route with `Bearer $CRON_SECRET`, https only (localhost excepted), token redacted from output | yes: against a local test server (200, 401, missing secret, http refused) |
