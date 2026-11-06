# Deployments

**Nothing is deployed.** As of 2026-11-06 there is no Caravan Road contract, account, transaction or hosted service on
any NEAR network, and no 1Click call or NEAR AI Cloud call has been made. Every value below is `TODO(owner)` on purpose:
this file is the record the owner fills in after each real deployment, so that a judge can compare the repository with what
is on chain. Do not fill a cell from memory, from a plan or from a tool's guess; copy it from the explorer or from the
command output, and leave the cell `TODO(owner)` until the thing exists. Never put a key, a seed phrase, a JWT or a
database URL in this file (`bash scripts/secret-scan.sh` before every commit).

How to deploy: `docs/DEPLOY.md`. How to build the init arguments: `node scripts/init-args.mjs --help` (it prints JSON from the
account ids you pass in and invents nothing). What the contract's `init` takes (`contracts/caravan/src/lib.rs`):
`owner`, `operator`, `mode` (`PLAY` or `LIVE`), `merchant_accounts` (`dasht`, `madan`, `bandar`, `shahr`), `max_players`,
`player_suffix`, `operator_daily_cap` (fils, as a string), `auto_ship` (optional).

## 1. Contract builds

| Item | Value |
|---|---|
| Source commit that was built | TODO(owner): `git rev-parse HEAD` at the time of the build you deployed |
| Spec version | `spec-v1.2` (`MULT_K_BP` 3000) is the current spec; TODO(owner): confirm the deployed build is at or after tag `spec-v1.2` |
| Build command | TODO(owner): `cargo build --target wasm32-unknown-unknown --release` in `contracts/caravan` (flags from `.cargo/config.toml`), or `cargo near build` if you installed cargo-near |
| Wasm size in bytes | TODO(owner) (a local Windows build on 2026-11-05 with Rust 1.99.1 was 389,493 bytes; that file was never deployed and no hash of it is recorded) |
| Wasm SHA-256 | TODO(owner): `sha256sum target/wasm32-unknown-unknown/release/caravan.wasm` (or the code hash the explorer shows after deploy; they must match) |
| Toolchain | TODO(owner): `rustc --version`, `cargo near --version` if used |

## 2. Testnet (PLAY mode)

| Item | Value |
|---|---|
| Setup tool used | TODO(owner): `scripts/setup-testnet.mjs` (commit `221a897`, owner-run: accounts, merchant function-call keys, deploy + init, verify; `plan` is offline) or the manual steps of `docs/DEPLOY.md`. The script was not run by the documentation session and its tests were not re-run here |
| Contract account id | TODO(owner) |
| Deploy date and time (UTC) | TODO(owner) |
| Deploy transaction hash | TODO(owner) |
| `init` transaction hash | TODO(owner) |
| Explorer link (contract account) | TODO(owner) |
| Owner account | TODO(owner) |
| Operator account | TODO(owner) |
| Merchant accounts (`dasht`, `madan`, `bandar`, `shahr`) | TODO(owner) |
| Relayer account (`RELAYER_ACCOUNT_ID`) and `player_suffix` | TODO(owner) |
| `init` arguments as sent (JSON, no keys) | TODO(owner): `mode` PLAY, `max_players`, `operator_daily_cap`, `auto_ship` and the account ids above |
| Merchant function-call keys added (account, allowed methods, transaction hash) | TODO(owner): none exist today |
| First `world_tick` transaction hash | TODO(owner) |
| First player registered / first trade / first journey claimed (transaction hashes) | TODO(owner) |
| Smoke test run (script, date, result) | TODO(owner): the testnet smoke script has not been run |
| Worker run against this contract (date, host) | TODO(owner): the worker has never run against a deployed contract |
| Hosted web app URL | TODO(owner) |

## 3. Mainnet (LIVE mode)

Mainnet signing, spending and public announcements are the owner's own actions (master plan 0.3). Deploy to mainnet only
after the PLAY loop works on testnet.

| Item | Value |
|---|---|
| Contract account id | TODO(owner) |
| Deploy date and time (UTC) | TODO(owner) |
| Deploy transaction hash | TODO(owner) |
| `init` transaction hash | TODO(owner) |
| Explorer link (contract account) | TODO(owner) |
| Owner / operator / merchant / relayer accounts | TODO(owner) |
| `init` arguments as sent (JSON, no keys) | TODO(owner): `mode` LIVE, `operator_daily_cap` (suggested 200,000 fils = 20 USDC in `DECISIONS.md` D15, a suggestion, not a decision) |
| Treasury account for NEAR Intents (registered with the USDC contract) | TODO(owner) |
| USDC asset id used (`ONECLICK_USDC_ASSET_ID`, from `GET /v0/tokens`) | TODO(owner) |
| First tiny deposit (explorer link, date, amount) | TODO(owner): never done |
| First tiny withdrawal (explorer link, date, amount) | TODO(owner): never done |
| Prize payout account (mainnet, created by the team) | TODO(owner): created by the team; it goes in the submission as `nearAddress` (`docs/SUBMISSION.md`) |

## 4. Other services

| Service | Value |
|---|---|
| Database host and region (no connection string here) | TODO(owner) |
| Hosting provider and project | TODO(owner) |
| NEAR AI Cloud model id used by the worker | TODO(owner): the worker has never called the service |
| 1Click partner JWT requested (date only, never the token) | TODO(owner) |
| Services kept running until (official: 2026-11-18 at least, 2026-11-25 ideally) | TODO(owner) |

## 5. Change log of this file

| Date (UTC) | Change |
|---|---|
| 2026-11-06 | Created with every value `TODO(owner)`. No deployment existed. |
