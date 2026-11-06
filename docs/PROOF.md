# What a judge can verify, and how

Honest scope: this repository contains a playable game loop (mock and local backend), integer price math shared by
TypeScript and Rust, a Rust contract, a server, an AI-merchant worker and a NEAR Intents client, all tested **offline**.
**Nothing has been deployed or run on a NEAR network, against NEAR AI Cloud, or against the NEAR Intents API.** This file
lists what you can check yourself, with the command and the result seen when it was written, and then what is **not**
verified. Counts are from runs on 2026-11-05 and 2026-11-06 (Windows 11, Git Bash, Node v24.19.0, pnpm 10.18.2, Rust 1.99.1,
Python 3.12.10); a later commit can change them, so run the command rather than trusting the number.

## 1. The repository itself

| Check | Command (repository root) | Seen |
|---|---|---|
| Tags | `git tag -l` | `pre-hackathon-baseline` (`260e0a6`), `spec-v1`, `spec-v1.1`, `spec-v1.2` (`083bc34`). There is no `hackathon-submission` tag yet |
| Work after the baseline | `git log pre-hackathon-baseline..HEAD --format='%h %ad %s' --date=iso-strict` | 27 commits at `72684c2` (more after it); the baseline holds 31 commits, the first dated 2026-10-23 01:16 +03:30. This project **started before the hackathon window** (`README.md` "Baseline vs hackathon work", `PROGRESS.md` D1, `docs/SUBMISSION.md` row 1) |
| Size of the change | `git diff --shortstat pre-hackathon-baseline HEAD` | 215 files changed, 10,314 insertions, 294 deletions at `72684c2` |
| What spec-v1.2 touched | `git diff --stat pre-hackathon-baseline HEAD -- spec packages contracts` | 12 files: the `MULT_K_BP` constant (4000 to 3000), golden vectors, tests, fixtures, spec text |
| Licence | open `LICENSE` | MIT, "Caravan Road contributors" (added in `ff17cc3`; the owner confirms it before publishing) |
| TODOs that remain | `grep -rn "TODO(owner)" README.md docs` | live URL, video, X post, team statement, repository URL, deployments (`docs/deployments.md`): every one is the owner's |

## 2. Commands that run offline, and what they printed

| What it shows | Command | Seen |
|---|---|---|
| Types | `pnpm typecheck` | `packages/shared`, `apps/web`, `apps/worker`: Done |
| Shared package (price math, golden vectors, sim, mock) | `pnpm --filter @caravan/shared test` | 35 passed (4 files) |
| Web app and server routes (fake contract, PGlite) | `pnpm --filter ./apps/web test` | 332 passed (17 files; clean checkout of `32141a2`) |
| AI worker (mocked NEAR AI client, scripted fake model) | `pnpm --filter @caravan/worker test` | 180 passed (10 files) |
| Lint | `pnpm --filter ./apps/web lint`, `pnpm --filter @caravan/worker lint` | both exit 0 (the worker "lint" is `tsc --noEmit`) |
| Contract | `cd contracts/caravan && cargo test` | 68 passed (33 s warm; `CARGO_TARGET_DIR` unset) |
| Contract style and lints | `cargo clippy --all-targets`, `cargo fmt --check` | both exit 0 |
| Contract builds to wasm | `cargo build --target wasm32-unknown-unknown --release` | `caravan.wasm`, 389,493 bytes (plain `cargo`, not `cargo-near`, which was not installed) |
| Art pipeline | `cd tools/art && python -m pytest -q` | 25 passed |
| Reference economy simulation (spec-v1.2) | `pnpm sim --bots 5 --ticks 240 --seed 7` (also 2 and 10 bots) | 5 bots: 190 trips, median profit 1,392 fils, 47 merchant-broke events; 2 bots 53 / 5,795 / 10; 10 bots 329 / 689 / 72; "money conserved on every tick: yes" |
| The same sim with the contract's rules | `python scripts/analysis/validate.py` | at K = 3000: contract rules 53 / 8,175 / 16, 182 / 739 / 28, 314 / 704 / 66; "VALIDATION PASSED" (62 variant runs, all money-conserving, 25 shared-sim configurations identical) |
| Economy analysis is reproducible | `python scripts/analysis/build_doc.py` after the runs in `docs/ECONOMY_TUNING.md` section 8 | regenerates `docs/ECONOMY_TUNING.md`; 2,845 variant runs behind it, all money-conserving |
| Worker loop with a fake model | `pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7` | 160 decisions from a FAKE scripted model, money conserved on every tick, "=== FAKE MODEL ===" banner. The word "llm" in the rows is only the schema's label |
| NPC evaluation regenerates | `pnpm --filter @caravan/worker eval -- --write <a new file>` | same numbers as `docs/NPC_EVAL.md` (only the command line in the header differs) |
| Draft limits (X post, submission, video captions) | `node scripts/count-chars.mjs docs/SUBMISSION.md docs/X_POST.md docs/DEMO_SCRIPT.md` | ALL CHECKS PASSED; 9 fields still `TODO(owner)` |
| Secrets in the tree | `bash scripts/secret-scan.sh` | "nothing suspicious found" on the working tree (2026-11-06); `--history` was run on 2026-11-01 and found one key-shaped test constant in two old commits (a redaction-test sample, not a secret; `PROGRESS.md`) |

## 3. The game, in a browser (no wallet, no account, no network service)

1. Mock mode: the numbered steps in `README.md` "Try it in 2 minutes" (`pnpm dev:mock`). Re-run on 2026-11-05 and 2026-11-06 in
   headless Chrome: buying 3 spice in Bandar cost 346.93 dinars (114.50 each plus 1% fee), the planner offered Shahr at
   +11.10 dinars estimated profit with one guard (risk 5.2%, 3:00, guard fee 7.20), and the 3 spice sold for 398.58
   dinars on arrival. The first page load compiles for a few seconds.
2. Local backend: `node scripts/dev.mjs local` runs the real route handlers on a simulated contract with an in-process
   Postgres; see `README.md` and `docs/SERVER.md`. Screenshots of both are in `docs/screens/`. Re-run on 2026-11-06 (fresh world,
   about a minute after start): 3 spice cost 266.57 dinars, the planner showed Dasht (4:30) at +116.18, and the 3 spice sold for
   475.09 dinars (+208.52 profit); the full loop at 1280 and 390 px (login, faucet, buy, a real 6-minute journey, claim, sell,
   ranks, logout) also completed with `apps/web/src/ui/shoot/live.mjs`.
3. Prices in either mode are simulated, not market data; the local backend's merchants are a rule-based stand-in.

## 4. Where each claim lives in the code

| Claim | Where to look | Backed by |
|---|---|---|
| Prices from stock with integer math, identical in TypeScript and Rust | `packages/shared/src/quote.ts`, `contracts/caravan/src/math.rs`; golden vectors in `spec/ECONOMY.md` 2.7 | `quote.test.ts` (shared), `src/tests/math_tests.rs` (contract) |
| Contract holds all rules and money; one trade is one transaction | `contracts/caravan/src/` (`game.rs`, `admin.rs`, `views.rs`), decisions and audit table in `contracts/caravan/DECISIONS.md` | 68 contract tests incl. money conservation and property tests |
| Meta-transactions, sub-accounts, custody, caps, cron | `apps/web/src/server/` (`near/relayer.ts`, `near/accounts.ts`, `contract/near.ts`, `game/cron.ts`), `docs/SERVER.md` | web tests with fakes; never run on a network |
| Merchant agents with bounded authority and a baseline fallback | `apps/worker/src/` (`brain.ts`, `validation`, `baseline.ts`), `spec/NPC.md`, `docs/WORKER.md` | worker tests with a mocked client and a fake model |
| NEAR Intents (1Click) client, fail-closed, caps | `apps/web/src/server/intents/`, `docs/INTENTS.md` | web tests with doc-derived fixtures; never called the real API |
| UI hides chain vocabulary outside the Advanced drawer | `apps/web/src/ui/vocabulary.test.ts` | included in the web tests |
| Economy findings | `docs/ECONOMY_TUNING.md`, `scripts/analysis/` | scripts re-run on 2026-11-05 at K = 3000 and K = 4000 |

## 5. What is NOT verified

- **No deployment.** No contract account, no transaction, no testnet or mainnet run. `docs/deployments.md` is empty on purpose.
  The `#[private]` check on `init`, function-call key restrictions, real gas and real storage cost are untested (no
  `near-workspaces` sandbox test exists). `grant_discount` (haggling) is not implemented.
- **No live AI.** The worker never called NEAR AI Cloud. TEE attestation is not verified: `attested` is `false` in every
  decision the worker writes, and the UI never shows a verified mark. Results in `docs/NPC_EVAL.md` are for a scripted fake model.
- **No live money or Intents call.** Nothing reached the 1Click API or mainnet. The fee for a real quote, the USDC asset id,
  the auth header (the docs say `X-API-Key`) and whether the withdrawal deposit address accepts USDC are unconfirmed
  (`docs/INTENTS.md`, `apps/web/src/server/intents/OPEN_ISSUES.md`).
- **No real sign-in.** Google and Discord login (Auth.js) is written; no OAuth app exists. The mock login is a flag in the
  browser and the local backend's login is a name box.
- **Simulations are not forecasts.** Greedy bots, a stress model; the contract rules in `docs/ECONOMY_TUNING.md` (rule set C)
  model the merchant `ship` limits (D25) from the decision log, not from the Rust code. Economy tuning with live play has not
  happened. Single-seed sim figures swing by a factor of two; use the ten-seed means.
- **Owner-run testnet tooling** (`scripts/setup-testnet.mjs`, commit `221a897`) exists; it was never run against a network and its own tests were not re-run for this file.
- **Hosted demo, demo video, X post, team statement, submission: not done.** Drafts only (`docs/DEMO_SCRIPT.md`,
  `docs/X_POST.md`, `docs/SUBMISSION.md`).
- **Screenshots** show mock data, fixture players and a local simulated contract.
- **Build reproducibility.** The wasm size above is a local Windows build; no hash is claimed to be reproducible, and the
  wasm was not built with `cargo-near`.
- **Audit.** The contract (12 findings) and the server (17 findings) each had an independent review by a separate agent
  session; fixes have tests. It is not a professional audit. The relayer's full-access key is a documented limitation.
- **Authorship and timeline.** Most code, tests, art and documentation were written by Claude Code under the owner's
  direction (`README.md`); the work started on 2026-10-22 UTC, before the hackathon window, so most of it is baseline under the
  organisers' rule (`docs/SUBMISSION.md`).
- **Web test count caveat.** The 332 above is from a clean checkout of commit `32141a2`; a checkout with uncommitted work, or a later commit, can show a different count.
