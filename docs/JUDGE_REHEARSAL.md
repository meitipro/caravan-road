# Judge rehearsal: following README.md literally

Role: a judge with no prior knowledge of the project, reading only `README.md` and running what it says from the
repository root on Windows 11 (Git Bash + PowerShell), Node v24.19.0, pnpm 10.18.2, Rust 1.99.1, with the built-in browser
pane. Date of the run: 2026-11-01. README last changed in commit `dc649e3`; HEAD during the run was `fe984b3` and the
README was not modified in between. Nothing was deployed, no account or secret was used, no tracked file was edited.
The dev server was started from the README command and stopped at the end.

> **Pre-v1.2 record.** This rehearsal was run on spec-v1.1 (`MULT_K_BP` 4000). Rows below that quote `pnpm sim` figures (177 / 1,088 / 43 and the 2- and 10-bot rows 64 / 5,944 / 23, 342 / 1,099 / 86) or Rust test counts are not changed; on the spec-v1.2 proposal branch `pnpm sim` prints 2 bots 53 / 5,795 / 10, 5 bots 190 / 1,392 / 47, 10 bots 329 / 689 / 72.

Method note: the browser pane starts with leftover localStorage from an earlier session (login flag set, "Tick 42"). I
cleared it first so the run starts at the login screen like a new visitor's would. A real judge's browser would be fresh.

## 1. Step-by-step table

Verdicts: CORRECT (matches the text), AMBIGUOUS (works but a stranger would hesitate or the text is incomplete), WRONG
(contradicted by what happened).

### "Try it in 2 minutes" (mock mode)

| # | README step | Expected from the text | What actually happened | Verdict |
|---|---|---|---|---|
| 0 | Prerequisites line: Node 20+, pnpm 10, internet for fonts | Tools present | Node 24.19.0 and pnpm 10.18.2 present, fonts loaded (online). `node_modules` already existed, so this was not a clean-clone install | CORRECT (offline and clean clone not testable here) |
| 1 | `pnpm install` | Finishes in seconds, harmless build-script notice | "Lockfile is up to date ... Done in 933ms", notice "Ignored build scripts: unrs-resolver" | CORRECT (but warm; a cold install was not measured) |
| 2 | `NEXT_PUBLIC_MOCK=1 pnpm --filter @caravan/web dev` | `Next.js 15.5.28`, `Local: http://localhost:3000`, `Ready` | Exactly that, "Ready in 3.2s" | CORRECT |
| 3 | Open http://localhost:3000, redirects to `/play` | Login card with PLAY badge, Google/Discord buttons, "Demo mode: this login is simulated..." | Redirected to `/play`; a "Loading the caravan" splash first, then the card with all quoted texts | CORRECT |
| 4 | "Continue with Google", "Next" twice | 3-step card, "You have 500.00", "Claim 500.00 dinars" | Exactly that. Screens update about 1 s after each click | CORRECT |
| 5 | "Claim 500.00 dinars", then "Start trading" | Toast "+500.00 dinars added", 1,000.00 in top bar, map "You are in Bandar" | Toast and 1,000.00 correct. The map appeared after a noticeable delay (a few seconds, dev-mode compile) and the screen stayed on the card meanwhile | CORRECT, slow first load not mentioned |
| 6 | Bandar card "Trade here", "Buy" on Spice, lower to 5 with "−", "Buy for ..." | Toast "Bought 5 Spice: -529.39 dinars", "Cargo 5 of 40" | Result identical, down to "-529.39" and "Cargo 5 of 40 units". But the dialog opens at the maximum affordable quantity (9) so "lower to 5" is four clicks; the README does not say that. Spice price seen 103.58 to 108.57 (README: "about 105-111") | CORRECT, minor ambiguity |
| 7 | "Why this price?" | Drawer "Nahid's mind", fixture decision text, "Rule-based", "No AI evidence yet" | All quoted strings present ("Fixture decision: stock is near target, keep the default policy.", "Rule-based", "No AI evidence yet. This merchant is following the basic pricing rules.") | CORRECT |
| 8 | "Plan a journey", cargo 3, Shahr, 1 guard | "Ambush risk 5.2%", "Travel time 3:00", "Guards 1 · 7.20 dinars", per-destination estimate | 5.2%, 3:00, 7.20 all correct. Estimate for Shahr was +61.78 (README: +69.27 "in my run"). With the default 5 spice the same screen showed Shahr at -146.20 est. profit (README warns about this) | CORRECT, but see problem 6 below |
| 9 | "Send caravan to Shahr" | "On the road", 3:00 countdown, "Aboard: Spice 3" | "Caravan to Shahr, 2:58, On the road, Aboard Spice 3, 1 guard hired" | CORRECT |
| 10 | Wait 3 min, "Claim your caravan" | "Safe arrival in Shahr", "Selling it all here now would bring about 417.41 dinars" | Arrived after 3:00 wall clock; "Safe arrival in Shahr / Nothing was lost", "about 424.24 dinars" (second run 396.89). The parenthetical "(an ambush, 5.2% chance, shows what was lost instead)" cannot occur with 3 units: the planner says "If ambushed: nothing to lose" | CORRECT, the ambush alternative is misleading for 3 units |
| 11 | "Go to the market", "Sell", "Sell for ..." | Toast "Sold 3 Spice: +420.82 dinars (+103.82 profit)" in the author's run | "Sold 3 Spice: +400.30 dinars (+77.00 profit)" on my run | CORRECT (README says the number varies) |
| 12 | "Ranks" | "Your rank #2", "Newbie 1,139.62 dinars", fixture players | "Your rank #3", "Newbie 567.55" with Silk Baron 1,824.00, Salt Queen 971.50, Unlucky, Wanderer. Rank depends on money held, which the README states only indirectly | CORRECT |
| 13 | "Stop the server with Ctrl+C. Reloading the page resets the mock world" | World resets on reload | After a reload the world did reset (balance back to 500.00, empty cargo). The "claimed" flag survives in localStorage, so there is no Claim button any more and you play on with 500, not 1,000 | CORRECT, but side effect undocumented |

Time to complete the 12 steps by a careful agent: about 8 to 10 minutes of wall clock, of which 3 minutes is the mandatory
wait in step 10. It is not a "2 minute" path.

### Checks "without a browser" and other checkable claims

| Claim | Command / check | Result | Verdict |
|---|---|---|---|
| `pnpm install --frozen-lockfile` completes in seconds | run | 691 ms (warm) | CORRECT |
| `pnpm typecheck`: shared, web, worker Done | run | all three Done | CORRECT |
| `pnpm test`: all three packages pass | run 5 times | 4 of 5 full runs green; 1 run FAILED: `apps/worker/tests/loop-config.test.ts` "loop > stops promptly on abort (graceful shutdown)", `expected 0 to be greater than or equal to 1` at line 173, while the dev server and other commands were running. Per-package reruns were green | WRONG once (timing-dependent flaky test) |
| shared 35 passed (4 files) | run | 35 passed (4 files) | CORRECT |
| web 272 passed (13 files) | run | 294 passed (14 files) | WRONG (stale; README itself says the count changes) |
| worker 177 passed (10 files) | run | 177 passed (10 files) | CORRECT |
| `pnpm sim` -> `trips: 177 \| median profit/trip (fils): 1088`, `merchant-broke events: 43`, `money conserved on every tick: yes` | run | identical, including 2-bot (64 / 5,944 / 23) and 10-bot (342 / 1,099 / 86) rows of the table | CORRECT |
| `pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7`: 160 decisions, conserved | run | "decisions: 160 (llm 160, baseline 0, keep 0)", "money conserved on every tick: yes". Note it prints "llm" for the decisions, from a FAKE model; the README says so, the program output does not | CORRECT |
| `cd contracts/caravan && cargo test` -> 68 passed, Rust 1.95+, about 2.5 min first run | run (warm target dir) | 68 passed in 40 s with Rust 1.99.1. The 2.5 min cold build was not reproducible here | CORRECT (timing unverified) |
| wasm builds, 389,493 bytes | `cargo build --target wasm32-unknown-unknown --release` | `caravan.wasm` is 389,493 bytes | CORRECT |
| tools/art: 25 passed | `python -m pytest -q` | 25 passed | CORRECT |
| `pnpm --filter @caravan/web lint` and `build` pass | run both (after deleting `apps/web/.next` as the README says) | lint clean, build OK in 40 s; 14 `/api` routes plus 4 cron plus the `dev` and `auth` routes | CORRECT |
| `pnpm --filter @caravan/worker lint` | run | it is `tsc --noEmit`, passes | CORRECT |
| "the 14 routes of spec/API.md plus four cron routes" | count build output | 14 + 4 (plus `auth`, `dev/login`, `dev/logout`) | CORRECT |
| `node scripts/check-env.mjs --target web` prints missing names only | run | prints MISSING names, no values | CORRECT |
| `bash scripts/secret-scan.sh` clean working tree | run | "nothing suspicious found". `--history` not run | CORRECT (history claim not re-run) |
| 31 commits before the window, first commit 2026-10-23 01:16 +03:30, last before window 2026-10-31 18:39 UTC | `git log` | 31, first `3c8d4be` 2026-10-23T01:16:54+03:30, last 2026-10-31T22:09:46+03:30 = 18:39 UTC | CORRECT |
| Every path named in the README | existence check of about 45 paths | all exist except two below | see below |
| `docs/screens/19-*.png` to `22-*.png` | ls | 19-cash-live-deposit, 20-deposit-waiting, 21-deposit-processing, 22-deposit-credited, each at 360/390/1280 | CORRECT |

Paths that do not resolve as written: `OPEN_QUESTIONS.md` in "Known limitations" (the file is `spec/OPEN_QUESTIONS.md`; there
is no root file), and `LICENSE` (admitted missing). The paths are plain code spans, not markdown links, so none is clickable on
GitHub.

## 2. What a judge would be confused by (most severe first)

1. **The README is stale against the repository HEAD.** It was last edited at `dc649e3` (12:46); later commits
   (`5b5d134`, `3f0a4a9`, `7932d26`, `a7cb131`) added a local end-to-end dev backend (`SERVER_BACKEND=dev`, real route
   handlers, simulated contract), a dev login, `docs/DEMO_SCRIPT.md`, `docs/X_POST.md` and `docs/SUBMISSION.md`. The README
   still says "It has never been connected to the real server end to end" (UI row of the status table), "Demo video / X post:
   TODO(owner)" and "Judge rehearsal, integration gate, demo video, X post, submission | Not done", does not mention the
   dev backend at all, and gives 272 web tests where there are 294. A judge cannot tell which of the two is true, and the most
   impressive thing that actually runs (the real routes against a simulated contract) is invisible from the README.
2. **"Try it in 2 minutes" is not 2 minutes.** The heading says "Try it in 2 minutes" (line 44) but step 10 reads "Wait 3
   minutes", and the first visit to every page in `next dev` is slow while it compiles (several seconds with no spinner on
   some clicks: after "Start trading", after "Trade here", after "Go to the market"). Honest timing is 8 to 10 minutes. A
   shorter path (skip the wait, or a "speed up time" switch for the demo) is not offered.
3. **The first screen of the README is a wall of caveats before anything runs.** Lines 1 to 42 hold the status paragraph, three
   TODO bullets, a long "Timeline" section about commit dates and AI authorship, and a problem statement. The runnable section
   starts at line 44. A hurried judge reads "TODO(owner)" three times before seeing what the game is. There is no screenshot or
   GIF anywhere in the README (109 PNGs exist in `docs/screens/`, none is embedded).
4. **The dev server can break in a way the README does not warn about.** The README says "if you ran `dev` first, delete
   `apps/web/.next` before building". The reverse also bites: a `.next` left from an earlier build (it existed here from
   12:35) sat under my first `dev` session, and during the run a full page load of `/play/city/shahr` returned 404 and the server
   log showed `Failed to generate static paths for /play/city/[id]: Cannot find module './vendor-chunks/@swc+helpers@0.5.15.js'`;
   the page then hung on "Loading the caravan" until I restarted `dev`. I cannot prove what corrupted it (I ran tests and
   typechecks concurrently, which should not touch `.next`), but a judge who runs the README's own "Run it locally" block in
   order (`dev`, then `test`, then `build`) is exposed to it.
5. **UI copy overstates what the README says is true.** The onboarding step 3 card reads "four AI merchants watch the market. Ask
   a merchant why it set its price", while the README (rightly) says no AI runs in mock mode. The drawer itself is honest
   ("No AI evidence yet"), but the first-impression text is not. Also the README line 7 "never see a wallet, a key or a fee"
   sits next to a buy dialog that shows "Fee (1%)" and "Each trade pays a 1% fee"; that is a game fee, not a network fee, and
   the README never says so.
6. **The suggested trade path shows a loss.** After "Buy 5 Spice" the planner opens with all 5 spice and shows estimated
   profits of -54.98 (Dasht), -91.45 (Madan), -146.20 (Shahr) in red. The README mentions this ("Larger cargo of spice can show a
   loss", step 8) but only after telling you to buy 5; a stranger learns that the core loop loses money at the quantity the
   README itself chose in step 6. Cause given is "Shahr's merchant only has 500 dinars", which is a design flaw, not a quirk.
7. **Small ambush is a no-op.** With 3 units the planner prints "If ambushed: nothing to lose" even at 20% risk, so the
   README's "(an ambush, 5.2% chance, shows what was lost instead)" can never be seen at the quantity the README tells you to
   use. The risk and guard purchase (7.20 dinars) then buy nothing. This weakens the core "risky route" premise in exactly
   the demo path.
8. **State persistence is half-way.** Login, onboarding and "claimed" flags live in localStorage but the world does not, so
   after any reload you get 500 dinars, no Claim button, and the leaderboard rank text from README (#2, 1,139.62) is not
   reproducible. Also the 2 spice I did not ship in run 1 appeared in the planner at Shahr ("5 of 5"): unshipped cargo travels
   with the player, which the README never states.
9. **Unreliable test command.** `pnpm test` is presented as the one-line check ("all three packages pass"). It failed once in
   five runs (worker abort test), so a judge running it once under load can see red and conclude the project is broken.
10. **Judge-facing questions the README never answers directly**: which of the many docs should I open first, what is the
    project's one-sentence pitch in plain words (the first paragraph needs three reads: "meant to be AI agents", "may ship
    goods", "game state ... in one NEAR smart contract"), and how do I run the version with the real server (that now exists).

## 3. Claims that are not backed or look overstated

Quotes are from `README.md`.

- "(observed on 2026-11-01; amounts drift because the mock moves prices every 5 s)": mostly true; the step-6 number
  reproduced exactly, but step 8, 10, 11 and 12 numbers do not, because the trade size and timing differ. Fine because it is
  disclosed.
- "Try it in 2 minutes": contradicted by the 3-minute wait in step 10 (see above).
- "four merchants that are meant to be AI agents with their own NEAR accounts and treasuries" and "every minute each merchant
  sets its buy/sell spread and price bias ... and each decision is stored with its reason": present tense, describes a design.
  In the only runnable mode the merchants are fixtures; the next paragraph does say so, but the opening paragraph reads as
  if it works. The dry-run prints decisions tagged "llm" although they come from a scripted fake.
- "players sign in with Google or Discord and never see a wallet, a key or a fee": no real sign-in has run ("not run with real
  OAuth apps"); the mock login is a flag in localStorage. The README discloses it, but not in the sentence that makes the claim.
- "The game state and rules live in one NEAR smart contract": true for the code, but nothing has been deployed or run on any
  network, so for a NEAR hackathon judge the verifiable NEAR content today is a unit-tested crate and a simulated chain.
- "Screenshots of every screen at phone and desktop widths are in `docs/screens/`": there are 109 files, each screen at 360,
  390 and 1280 px; true, but nothing in the README points at a gallery or embeds one.
- "Typecheck passes ... `lint` and `build` pass; clippy and rustfmt on the contract were not re-run today": verified for
  lint and build; clippy/rustfmt not re-run by me either.
- "The same simulation with the contract's rules ... 61 / 6,714 / 26, 132 / 933 / 44, 344 / 958 / 74" ("not reproducible with
  a command here"): not checkable by a judge, so it is an unverifiable figure placed next to verifiable ones.
- "Test counts, run on 2026-11-01 ... 272 passed (13 files)": already out of date (294 / 14 files) at HEAD.
- "Merchant treasuries of 5 USDC each (the maximum operator loss in the model: 20 USDC)" and the caps (20 USDC deposits, 10 USDC
  per day withdrawals): implemented, "tested offline", never exercised; stated as such. In the mock the Cash screen is the only
  place a judge can look at them, and it is not part of the numbered steps.
- "history was not rewritten" and "31 commits ... predate the window": verified true. This is a strength, but the README's
  own text admits the organisers' rule is "build the project during the hackathon"; roughly three quarters of the commits
  predate it. A judge applying that rule literally has a reason to stop reading.

## 4. Missing information a judge needs

- Live URL: `Live demo (PLAY mode): TODO(owner): no deployment exists yet.` There is nothing to open without installing
  Node, pnpm and a Rust toolchain. A static export or a hosted mock would make this a 20-second check.
- Demo video / X post / team statement: all `TODO(owner)` in the README (drafts exist in `docs/DEMO_SCRIPT.md`,
  `docs/X_POST.md`, `docs/SUBMISSION.md`, but the README does not link or mention them).
- Any image of the game in the README.
- A one-command start (`pnpm dev:mock` or similar); today the command is long and differs per shell (bash, PowerShell; cmd.exe
  is not covered).
- A statement of what to do if port 3000 is busy, how long first-load compile takes in `dev`, or an option to run the
  production build (`next build && next start`) which is faster for a demo and avoids the `.next` problem.
- How to run the end-to-end dev backend (`SERVER_BACKEND=dev`, `DEV_LOGIN=1`) that the repository now contains.
- A root `LICENSE` file (admitted missing; the crate declares MIT).
- A pointer to a short "what to read, in order" list for a judge with 5 minutes (README, then which doc).
- Expected duration of the cold `cargo test` and of a cold `pnpm install`; both were measured on a warm machine here.
- The Rust and wasm target prerequisites (`rustup target add wasm32-unknown-unknown`) for the wasm build line.
- Which of the numbered checks require network (fonts are fetched at first run; "not tested offline").

## 5. Overall score

**6 / 10 for "could a stranger understand and try this in 2 minutes".**
Every checkable number and string in the README reproduced (the sim table, test counts for three of five packages, the wasm
size, the quoted UI texts, even the 529.39 purchase), which is rare and builds trust, but the "2 minutes" path takes about ten
because of a mandatory 3-minute wait and slow dev-mode page compiles, the first 40 lines are caveats and TODOs, there is no
live link or picture, and the README is already behind the repository (dev backend, test count, demo drafts).

## Appendix: commands run

`pnpm install`; `NEXT_PUBLIC_MOCK=1 pnpm --filter @caravan/web dev` (port 3000, stopped afterwards); `pnpm install
--frozen-lockfile`; `pnpm typecheck`; `pnpm test` (5 times) and each `pnpm --filter @caravan/<pkg> test`; `pnpm sim` with 2, 5
and 10 bots; the worker `dry-run`; `cargo test`; `cargo build --target wasm32-unknown-unknown --release`; `python -m pytest -q`
in `tools/art`; `pnpm --filter @caravan/web lint`, `@caravan/worker lint`; `rm -rf apps/web/.next` then `pnpm --filter
@caravan/web build` (then `.next` removed again, it is git-ignored); `node scripts/check-env.mjs --target web`; `bash
scripts/secret-scan.sh`; read-only `git log`/`git status`. Untracked `scripts/analysis/` in the working tree is not mine.
