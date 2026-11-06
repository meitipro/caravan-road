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

## 1b. Testnet in one script (recommended): `scripts/setup-testnet.mjs`

One repeatable tool that does sections 2 to 4 for you: the sub-accounts and their keys, the merchants' function-call keys,
the contract build, deploy plus `init` in one transaction, and the read-only checks. Sections 2 to 4 stay below as the
manual equivalent. **Status: tested offline with a fake chain only (`node --test scripts/__tests__/setup-testnet.test.mjs`,
41 tests); it has never been run against a live network.** The first live run may find problems, so start with `plan`
and `--dry-run`. API names were checked against the installed near-api-js 7.4.0 and docs.near.org/tools/near-api.

What it guarantees (each point has a test):

- It never creates or invents the root account, never asks for a seed phrase or key, and takes **no key on the command
  line** (a key-shaped argument or a flag like `--private-key` is refused without echoing it). The root key is read only
  from the local file named by `ROOT_KEY_FILE`, or from the near-cli credentials directory.
- It never prints key material: only account ids, public keys, balances and transaction hashes. Generated private keys are
  written only to `.env.local` (git-ignored; checked before every write), created with restrictive permissions (mode 600; on
  Windows `icacls` removes inherited access), replaced atomically, and saved **before** the first on-chain change that uses them.
- Every account id is derived from `ROOT_ACCOUNT_ID` as `<role>.<root>`. Testnet only: a `.near` root or `NEAR_NETWORK=mainnet` is refused.
- Re-running is safe: existing accounts and keys are skipped, existing secrets are never regenerated, a differing value in
  `.env.local` is refused unless `--force`, and the root balance is checked before any write and again before every transfer.
- `--dry-run` changes nothing and writes no file (it reads the chain, so it shows what exists and the root balance);
  `plan` is fully offline.

### What you do by hand

1. **Create the root testnet account yourself** (the name is yours). It is the only account you create.
   - Faucet, with the key saved where this script can read it **[interactive]**: run `near`, then `account`, then
     `create-account`, then `sponsor-by-faucet-service`, enter the name, `autogenerate-new-keypair`, and choose
     **`save-to-legacy-keychain`** (not `save-to-keychain`), network `testnet`. The legacy keychain is a directory under
     `~/.near-credentials/testnet/` (near-cli-rs GUIDE, "legacy keychain"). That option name was not on the docs.near.org page I read:
     confirm it with `near --help`. The one-line `save-to-keychain` form in section 2 stores the key in the OS keychain,
     which this script cannot read.
   - Or export the private key from the wallet you created the account in, into a file **outside the repository**
     (for example `C:\secure\root-key.txt` or `~/secure/root-key.txt`). Accepted: the bare `ed25519:...` string, or JSON with a
     `private_key` field. Set `ROOT_KEY_FILE` to that path. Never paste the key into chat; a seed phrase is refused.
2. **Fund the root** from the testnet faucet. With the default sizing the root needs about **18.6 NEAR** (accounts 12.5, gas
   reserve 0.07, and 6 kept on the root for the contract's code storage, see "Where the contract lives"). `accounts --dry-run`
   prints the exact need next to the root's balance; lower the `FUND_*_NEAR` values if the faucet gives you less.
3. **Set the two inputs** in your shell (values are yours; nothing is stored by the shell commands below):

   ```bash
   export ROOT_ACCOUNT_ID=<root>.testnet
   export ROOT_KEY_FILE=~/secure/root-key.txt        # omit if the key is in ~/.near-credentials/testnet/
   ```

   ```powershell
   $env:ROOT_ACCOUNT_ID = "<root>.testnet"
   $env:ROOT_KEY_FILE = "C:\secure\root-key.txt"      # omit if the key is in ~/.near-credentials/testnet/
   ```

   (You can also put `ROOT_ACCOUNT_ID=` and `ROOT_KEY_FILE=` lines into `.env.local` yourself; the process environment wins.)

### Commands, in order (same in bash and PowerShell; run from the repository root)

```bash
node scripts/setup-testnet.mjs plan                  # offline: names, funding, secrets, init arguments. Nothing is done.
node scripts/setup-testnet.mjs accounts --dry-run    # reads the chain: what exists, root balance vs. need. Nothing is changed.
node scripts/setup-testnet.mjs accounts              # creates the 7 sub-accounts, writes .env.local
node scripts/setup-testnet.mjs keys                  # function-call keys on the four merchants
node scripts/setup-testnet.mjs deploy                # cargo build, then deploy + init in ONE transaction
node scripts/setup-testnet.mjs verify                # read-only checks, exit 1 if any FAIL
# or everything in order (add --dry-run first to preview the whole flow):
node scripts/setup-testnet.mjs all --dry-run
node scripts/setup-testnet.mjs all
```

Options: `--env-file <path>` (default `.env.local` in the repository root; use `--env-file apps/web/.env.local` if you want the one
file where the smoke test and `next dev` read it, also git-ignored), `--allowance <NEAR>`, `--max-players <n>` (default 1000),
`--operator-daily-cap <fils>` (default 200000, DECISIONS D15), `--wasm <path>`, `--skip-build`, `--force`, `--rotate <roles>`.

### What gets created

| Role | Account | Key in `.env.local` | Notes |
|---|---|---|---|
| root | `<root>` | none (your key file) | you create it; pays for everything; by default also hosts the contract |
| owner | `owner.<root>` | `OWNER_PRIVATE_KEY` full access | **stays on this machine, never on a host**; also the full-access key on the merchants and on a contract sub-account |
| operator | `operator.<root>` | `OPERATOR_PRIVATE_KEY` full access | server (section 6); a restricted key may be enough, untested (see "Operator key") |
| relayer | `relayer.<root>` | `RELAYER_PRIVATE_KEY` full access | server; parent of the player accounts `p<8hex>.relayer.<root>` (known limitation, `docs/SERVER.md` finding 8) |
| dasht, madan, bandar, shahr | `<city>.<root>` | `KEY_DASHT`, `KEY_MADAN`, `KEY_BANDAR`, `KEY_SHAHR` function-call | worker; receiver = the contract, methods `set_policy`, `ship`; **shahr also `world_tick`** because the worker sends `world_tick` from that key (`docs/WORKER.md`), a small addition to "set_policy and ship" |

Other values written (names only): `ROOT_ACCOUNT_ID`, `NEAR_NETWORK=testnet`, `NEAR_RPC_URL` (the docs.near.org example endpoint unless you set
your own, https only), `GAME_MODE=PLAY`, `CARAVAN_CONTRACT_ID`, `OWNER_ACCOUNT_ID`, `OPERATOR_ACCOUNT_ID`, `RELAYER_ACCOUNT_ID`,
`MERCHANT_ACCOUNT_DASHT/MADAN/BANDAR/SHAHR`, and three generated 64-hex secrets: `KEY_ENC_SECRET` (**back it up**: if lost, every stored
player key is unreadable), `AUTH_SECRET`, `CRON_SECRET`. The merchants are created with the owner's public key as their full-access key
(that is what lets `keys` and `--rotate` change their keys); the key the worker holds is only ever the function-call key.

Default funding in NEAR (override with `FUND_OWNER_NEAR`, `FUND_OPERATOR_NEAR`, `FUND_RELAYER_NEAR`, `FUND_MERCHANT_NEAR`,
`FUND_CONTRACT_NEAR`; allowance with `KEY_ALLOWANCE_NEAR` or `--allowance`):

| Item | Default | Why |
|---|---|---|
| owner / operator | 0.5 / 1 | gas for admin calls and `credit_deposit` and friends |
| relayer | 3 | 0.01 per new player plus gas; `/api/cron/health` alerts below 2 |
| each merchant | 2 | gas for its function-call key (the key's allowance and the account balance are two separate limits) |
| function-call key allowance | 1.5 each | pays gas for `set_policy`, `ship`, `world_tick`; the key stops working when it is used up |
| contract reserve | 6 | code storage (389,493 bytes, about 3.9 NEAR) plus state; only counted while the contract has no code |

I have **not measured** the gas of the merchant calls on testnet. A merchant acting every minute for two weeks may use more than the defaults:
`verify` prints each key's remaining allowance (WARN below 0.05 NEAR) and each account's balance (WARN for the relayer below 2 NEAR). A used-up allowance cannot be topped up: run
`keys --rotate <city>` to get a fresh key with a fresh allowance, and add balance to the account with an ordinary transfer.

### Where the contract lives

By default the contract is deployed **on the root account itself** (the master plan's "root `caravan-road.testnet`"): the root's key signs the
deploy and `init`. To keep the contract on its own account instead, set `CARAVAN_CONTRACT_ID=<name>.<root>` before `accounts`: it must be a
sub-account of the root; `accounts` creates it (6 NEAR), and the owner key signs for it. Either way `verify` checks the same things.

### Expected output (shape)

Taken from the offline test run with a fake chain, so ids, hashes and balances on testnet will differ; `ed25519:...` below are public keys only.

```
== accounts: sub-accounts of example.testnet
env file .env.local: git-ignored
root example.testnet: balance 100 NEAR, available 100 NEAR
root key: read from ROOT_KEY_FILE (<path>); public key ed25519:<public> is a full-access key of example.testnet
  will create  owner.example.testnet                    fund 0.5 NEAR
  ...
root balance needed: 18.57 NEAR   available: 100 NEAR
env file .env.local: writing 22 value(s): ROOT_ACCOUNT_ID, ..., KEY_ENC_SECRET, AUTH_SECRET, CRON_SECRET
created owner.example.testnet with 0.5 NEAR; full-access public key ed25519:<public>; tx <hash>
...
accounts done: 7 created, 0 already existed.
== keys: function-call keys on the merchants, receiver example.testnet
  will add     shahr.example.testnet     key ed25519:<public>  methods set_policy,ship,world_tick  allowance 1.5 NEAR
== deploy: example.testnet
init args (scripts/init-args.mjs): {"owner":"owner.example.testnet", ... ,"player_suffix":".relayer.example.testnet","operator_daily_cap":"200000", ...}
deployed and initialised example.testnet; tx <hash>
get_config: mode PLAY, paused false, owner owner.example.testnet, operator operator.example.testnet, player_suffix relayer.example.testnet, ...
== verify: example.testnet
  PASS wasm hash matches: <code hash>
  PASS config.mode: PLAY
  PASS merchant key shahr: function-call, set_policy,ship,world_tick, allowance left 1.5 NEAR
  PASS world.merchants: 4 merchants
verify: 26 passed, 0 warning(s), 0 failed.
```

A second run of any command prints `exists` / `already present` / `already deployed and initialised` and changes nothing.
`init` arguments come from `scripts/init-args.mjs` (so its checks apply) with `--mode PLAY`, `--relayer relayer.<root>` (this becomes `player_suffix`, which
must equal `RELAYER_ACCOUNT_ID`), `--max-players` and `--operator-daily-cap`. `deploy` refuses a wasm that does not import the NEAR host functions
(built without `--cfg near`, DECISIONS D26) and a `.cargo/config.toml` that lost those flags. Deploy and `init` are one transaction: if `init` fails, the deploy is rolled back.

### After the script

```bash
node scripts/check-env.mjs --target web --mode PLAY --env-file .env.local     # names only
node scripts/check-env.mjs --target worker --env-file .env.local
```

Then set values **one by one in each host dashboard** (section 6 server: `RELAYER_*`, `OPERATOR_*`, `KEY_ENC_SECRET`, `AUTH_SECRET`, `CRON_SECRET`, ids; section 7
worker: `KEY_*`, `MERCHANT_ACCOUNT_*`, `CARAVAN_CONTRACT_ID`, `NEAR_RPC_URL`). Do not upload `.env.local` itself and never set `OWNER_PRIVATE_KEY` on a host.
Still yours by hand: `DATABASE_URL`, OAuth ids, `NEAR_AI_*` (sections 5 to 7). The root key file is only needed again for top-ups and `accounts`; keep it
outside the repository (when the contract is on the root it is also the contract's full-access key).

### Troubleshooting

| Message (starts with) | Meaning and fix |
|---|---|
| `ROOT_ACCOUNT_ID is not set` | set it (step 3). `must end with .testnet` / `looks like a mainnet account` / `NEAR_NETWORK must be testnet`: the script is testnet-only |
| `no usable root key found` / `ROOT_KEY_FILE points to a file that does not exist` | set `ROOT_KEY_FILE`, or save the key as `~/.near-credentials/testnet/<root>.json`. A key only in the OS keychain cannot be read |
| `... does not contain a private key` | the file needs the bare key string or JSON with `private_key`; a seed phrase is never read |
| `the key read from ... is not a full-access key of <root>` | wrong key file for that account (or the key was deleted) |
| `root account <root> does not exist on testnet` | create it first (step 1) |
| `the root balance is too low` | fund the root from the faucet or lower `FUND_*_NEAR`; nothing was created or written. A `dropped below ... needed for <id>` message means the balance fell mid-run: keys are saved, fund and re-run |
| `refusing to overwrite existing values in .env.local: NAMES` | those names hold a different value (usually ids from another root). Fix by hand, or `--force` to replace them. Existing secrets are never regenerated, even with `--force` |
| `<file> is not git-ignored` | add it to `.gitignore` (the default `.env.local` is ignored by `.env*`) |
| `<id> already exists but <VAR> is not set` | an account from an earlier attempt without its key in `.env.local`. The script cannot recover a key it does not have: restore the key into that variable, or delete that account with its own key and re-run |
| `... is not one of its full-access keys` | the key in `.env.local` does not belong to that account |
| `has a different receiver or method list` | a key with that public key exists with other permissions: `keys --force` (delete, then add) or `keys --rotate <city>` |
| `already runs a different initialised contract` | refused so live state is not replaced silently. A new contract account (`CARAVAN_CONTRACT_ID`) is the clean way; `--force` deploys the new code without `init` and without any state migration |
| `does not import the NEAR host functions` | the wasm was built without `--cfg near`; delete it and let `deploy` rebuild with the repository's `.cargo/config.toml` |
| `the contract build failed` | run `cargo build --target wasm32-unknown-unknown --release` in `contracts/caravan` yourself (section 0 tools, `rustup target add wasm32-unknown-unknown`) |
| `needs ... NEAR for the code storage` | fund the contract account (the root, or `CARAVAN_CONTRACT_ID`) and re-run `deploy` |
| `FAIL get_config` / `FAIL contract has code` | not deployed or `init` not done: run `deploy` (it calls `init` alone if the code is already there) |
| `WARN account relayer...` | below the 2 NEAR alert of `/api/cron/health`: transfer more NEAR to the relayer |
| `WARN merchant key ...` / low allowance | `keys --rotate <city>` for a fresh allowance, and top up the account balance |
| `unexpected failure: ...` (fetch failed, timeout, RPC error) | transient: re-run, every step is idempotent. If it persists, set `NEAR_RPC_URL` to another https endpoint from docs.near.org (RPC providers) |
| `could not restrict the permissions of .env.local` (warning) | bash: `chmod 600 .env.local`; PowerShell: `icacls .env.local /inheritance:r /grant:r "$($env:USERNAME):F"` |

### Rotating keys

```bash
node scripts/setup-testnet.mjs keys --rotate dasht,shahr --dry-run    # preview
node scripts/setup-testnet.mjs keys --rotate dasht,shahr              # merchants: new function-call key, fresh allowance
node scripts/setup-testnet.mjs keys --rotate relayer                  # also: operator, madan, bandar
```

Order, safe at every point: the new key is added on chain, saved to `.env.local` (the file is probed as writable first), and only then is the old
key deleted. If saving fails, the old key still works and the new one is an unused extra key; the message says so. After a rotation, **copy the new
value of that variable into the host dashboard that uses it and restart that service** (worker for `KEY_*`, server for `RELAYER_*`/`OPERATOR_*`);
the old key stops working as soon as it is deleted. Not covered by the script: the owner key (rotate by hand with near-cli), `KEY_ENC_SECRET` (no rotation
procedure exists, `docs/SERVER.md`), `AUTH_SECRET` and `CRON_SECRET` (replace the line by hand with a new `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` value and update the host;
sessions and cron callers need the new value). If the operator key leaks, rotate it here and also consider the contract's owner-only `set_operator` method (DECISIONS D17).

## 2. Testnet accounts

Roles (names are your choice; I never invent them). All must be different accounts. (The script in section 1b creates these for you from one root account.)

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

(`node scripts/setup-testnet.mjs deploy` and `keys` from section 1b do this whole section; what follows is the manual form.)

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
| `scripts/setup-testnet.mjs` | `plan\|accounts\|keys\|deploy\|verify\|all [--dry-run] [--force] [--env-file <path>] [--rotate <roles>]`: creates the sub-accounts and keys, writes `.env.local`, deploys and initialises, verifies (section 1b); uses `scripts/init-args.mjs`; code in `scripts/lib/` | yes, offline: `node --test scripts/__tests__/setup-testnet.test.mjs` runs the real script against a fake chain (action order, idempotency, refusal to overwrite, balance checks, no secret in any output or child-process argument); `plan` run for real. **Never run against a live network** |
| `scripts/call-cron.mjs` | calls one cron route with `Bearer $CRON_SECRET`, https only (localhost excepted), token redacted from output | yes: against a local test server (200, 401, missing secret, http refused) |
