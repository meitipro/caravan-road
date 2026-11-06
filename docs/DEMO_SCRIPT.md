# Demo video script (Phase 10) - shot by shot, under 2:00

Status: DRAFT written 2026-11-01 for the owner (Mahdi) to record. Nothing has been recorded or posted. Prices, test counts and dry-run lines were re-checked on 2026-11-05/06 after spec-v1.2 (`MULT_K_BP` 3000); the setup facts dated 2026-11-01 below are unchanged records. The video is made
only from what actually runs today: the **local dev backend** (real route handlers, simulated contract, no NEAR network),
the **mock** (fixture merchants), and the **worker's fake-model dry run**. Each of these carries an on-screen badge, so a
viewer can never mistake it for a live network. Plan 13.1 had a "merchant is an agent on NEAR AI Cloud" shot and a LIVE
Intents deposit shot; both would be false today and are replaced (section 6 says how to bring the LIVE scene back).

Design rules for X autoplay: it plays **muted**, so every shot has a burned-in caption (white text on a dark band, at least
28 px at 1280x720, bottom third, one sentence per shot, at most 110 characters). No voice-over is needed. The first
frame is the map, not a logo animation. Total runtime 1:56. Check X's current maximum video length before uploading
(not verified here).

## 1. Setup (do this before recording)

| Step | Command or action | Why |
|---|---|---|
| 1 | Close any running dev server. Delete the folder `apps/web/.data` (git-ignored). | A persisted dev world drifts: on 2026-11-01 an old `.data` was at tick 177 with iron, spice and silk stock at 0 in Dasht, which makes prices sit at the clamp. A fresh world starts every good at its target |
| 2 | PowerShell, repository root: `$env:NEXT_PUBLIC_MOCK="0"; $env:SERVER_BACKEND="dev"; $env:DEV_LOGIN="1"; $env:GAME_MODE="PLAY"; pnpm --filter @caravan/web dev` (bash form and options: `docs/SERVER.md`, "Local end-to-end dev mode") | the dev backend. Checked 2026-11-01 on port 3100: the server became ready, `GET /api/dev/login?name=Sara` returned 303 and `GET /api/state` returned `ok:true` with a PLAY world |
| 3 | Browser window 1280x720, open http://localhost:3000/play | the login card shows a name box and "Play" |
| 4 | Record shots 1-4 and 6-9 here (section 3). The faucet in the dev backend has a 60 s cooldown (it is 1 h in the contract); the world ticks every 60 s | |
| 5 | Stop the dev server. For shot 5b start the mock: `$env:NEXT_PUBLIC_MOCK="1"; pnpm --filter @caravan/web dev` and use the "Why this price?" drawer | run one server at a time (both use the same `.next` folder) |
| 6 | Shot 5a and shot 10 are terminal captures: `pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7` and `pnpm test` plus `cd contracts/caravan && cargo test` | real command output |

Persistent badges (burned in for the whole shot, top-left, small):

<!-- count: badge.dev min=1 max=90 -->
```
LOCAL DEV BACKEND: real API routes, simulated contract, no NEAR network
```

<!-- count: badge.mock min=1 max=90 -->
```
MOCK DATA: fixture merchants, nothing here is live
```

<!-- count: badge.fake min=1 max=90 -->
```
FAKE SCRIPTED MODEL: not NEAR AI Cloud, no network
```

## 2. Timeline (total 1:56)

| # | Time | Length | Source | Badge |
|---|---|---|---|---|
| 1 | 0:00-0:08 | 8 s | dev backend, map | dev |
| 2 | 0:08-0:18 | 10 s | dev backend, login | dev |
| 3 | 0:18-0:28 | 10 s | dev backend, onboarding and faucet | dev |
| 4 | 0:28-0:46 | 18 s | dev backend, Bandar market, buy spice | dev |
| 5a | 0:46-0:54 | 8 s | terminal, worker dry run | fake |
| 5b | 0:54-1:00 | 6 s | mock, "Why this price?" drawer | mock |
| 6 | 1:00-1:14 | 14 s | dev backend, journey planner and departure | dev |
| 7 | 1:14-1:20 | 6 s | dev backend, caravan on the road, countdown | dev |
| 8 | 1:20-1:36 | 16 s | dev backend, arrival, then sell | dev |
| 9 | 1:36-1:44 | 8 s | dev backend, ranks | dev |
| 10 | 1:44-1:56 | 12 s | terminal and end card | none |

## 3. Shots (screen, caption, backing)

Captions are the exact burned-in text. Each is measured by `node scripts/count-chars.mjs docs/DEMO_SCRIPT.md`.

### Shot 1 (0:00-0:08): the world

Screen: the map "Silk Road" with four cities and the route labels (`docs/screens/live-04-map-1280.png` shows it), slow
hover over the Bandar to Shahr road.

<!-- count: caption.1 min=1 max=110 -->
```
Caravan Road: a trading game where the merchants have their own treasuries.
```

Backing: four merchants with treasuries of 5 USDC each (`spec/ECONOMY.md` 2.5 `MERCHANT_TREASURY_FILS`, enforced in
`contracts/caravan`, 68 tests; the dev backend uses the same rules through `FakeContract`, `docs/SERVER.md`).

### Shot 2 (0:08-0:18): sign-in

Screen: the login card, type a name (for example "Sara"), click "Play". The card says "Local test server: pick any name to
start a practice account." Keep that line readable.

<!-- count: caption.2 min=1 max=110 -->
```
No wallet, no gas, no seed phrase on screen. This is a local test login.
```

Backing: `apps/web/src/ui/vocabulary.test.ts` (chain words only in the Advanced drawer and the evidence page), 332 web
tests pass (clean checkout of `32141a2`, run 2026-11-06). Not claimed: Google or Discord sign-in. It is written (Auth.js, `apps/web/src/server/auth/config.ts`) but
no OAuth app exists, so the video must not show or name it.

### Shot 3 (0:18-0:28): free dinars

Screen: onboarding step 3 and the "Claim 500.00 dinars" button, then the toast "+500.00 dinars added" and balance 500.00
in the top bar, then the map ("You are in Bandar").

<!-- count: caption.3 min=1 max=110 -->
```
PLAY mode: claim 500 free dinars and start trading.
```

Backing: `POST /api/faucet` (PLAY only, `docs/SERVER.md`); `docs/screens/live-03-claimed-1280.png`; on 2026-11-01 a fresh dev
player returned `fils: "0"` before claiming.

### Shot 4 (0:28-0:46): buy where it is cheap

Screen: "Open Bandar market", Spice row, "Buy", set quantity 3, "Buy for ..."; toast "Bought 3 Spice"; "Cargo 3 of 40 units"
(README step 5 shows the same flow on the mock; on 2026-11-05, with 3 units, spice cost 114.50 dinars each plus the 1% fee, "Bought 3 Spice: -346.93 dinars"; on the dev backend the price depends on stock at that moment, so read it off the screen).

<!-- count: caption.4 min=1 max=110 -->
```
Prices come from stock. Buy where a good is cheap.
```

Backing: `packages/shared/src/quote.ts` (price curve), golden vectors `packages/shared/src/quote.test.ts` and
`contracts/caravan/src/tests/math_tests.rs` (35 shared tests and 68 contract tests pass); `docs/ECONOMY.md` sections 4 and 6; screens
`docs/screens/live-05-market-*.png`, `live-06-buy-sheet-*.png`.

### Shot 5a (0:46-0:54): merchants decide every minute (terminal)

Screen: the terminal running `pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7`; scroll so lines such as
`[FAKE] t+  5  Captain Nahid  llm  model=fake-scripted attested=false spread=1000 bias=  -621 calm  ship 4 spice -> shahr | ...` (a ship line) are visible, then the last lines
(`decisions: 160 (FAKE-model (source=llm) 159, baseline 0, keep 1)`, `money conserved on every tick: yes`, the "=== FAKE MODEL ===" banner; run 2026-11-05). Badge "fake".

<!-- count: caption.5a min=1 max=110 -->
```
Each merchant picks a spread and a price bias every minute, inside hard limits.
```

Backing: `apps/worker/src/` (features, validation, clamps, baseline fallback); run 2026-11-01 and again 2026-11-05: 160 decisions, money conserved
on every tick; `docs/WORKER.md`, `spec/NPC.md`. The word "llm" in that output is the label of the **fake scripted model**
(`docs/NPC_EVAL.md`); the badge says so.

### Shot 5b (0:54-1:00): why this price (mock)

Screen (mock server): Market, "Why this price?" opens "Nahid's mind" (or "Sohrab's mind"): mood, spread and bias bars,
"Last decisions", the "Rule-based" tag and the line "No AI evidence yet" (`docs/screens/15-merchant-mind-1280.png`).

<!-- count: caption.5b min=1 max=110 -->
```
Every decision is stored with its reason. NEAR AI Cloud is written, not connected yet.
```

Backing: `apps/web/src/components/Mind.tsx` (the badge reads "Private AI (TEE) verified" only when `attested` is true; the
worker never sets it, `docs/WORKER.md`). The dev backend's stand-in (`apps/web/src/server/dev/ticker.ts`) writes no decision
rows, which is why this one drawer comes from the mock.

### Shot 6 (1:00-1:14): plan the route

Screen: back on the dev backend: "Plan a journey", cargo 3 spice, destination Shahr (3:00), choose 1 guard. The summary
shows "Ambush risk 5.2%", "Travel time 3:00", "Guards 1 - 7.20 dinars" (README step 6, observed on the mock on 2026-11-05 and 2026-11-06, with "est. profit" for Shahr +11.10 dinars; the risk, time and guard numbers
come from the shared formulas, so they should match on the dev backend; the profit estimate depends on stock, so confirm on screen when recording). Click "Send
caravan to Shahr".

<!-- count: caption.6 min=1 max=110 -->
```
Pick a route and hire guards. One guard cuts the ambush risk from 8% to 5.2%.
```

Backing: `spec/ECONOMY.md` 2.4 (Bandar-Shahr 8%, 180 s) and 2.5 (`GUARD_RISK_FACTOR_BP` 6500, so 800 x 0.65 = 520 bp);
`docs/ECONOMY.md` section 3; `docs/screens/live-08-planner-*.png`.

### Shot 7 (1:14-1:20): on the road

Screen: "On the road", the caravan sprite on the map, the 3:00 countdown. Record the real 3 minutes and cut to the end of
it; show the caption so a viewer knows time was skipped.

<!-- count: caption.7 min=1 max=110 -->
```
3 minutes later (cut).
```

Backing: `docs/screens/live-09-in-transit-*.png`. Do not speed up the countdown digits in a way that looks like a real 6 s trip.

### Shot 8 (1:20-1:36): arrival, then sell

Screen: the notice "Your caravan reached Shahr. Claim it!", "Claim your caravan", the result card, "Go to the market",
Spice, "Sell for ...", toast with the profit or loss. **Record whatever really happens.** The ambush roll is random; at 5.2%
most runs are a safe arrival. Use the caption that matches the result:

<!-- count: caption.8a min=1 max=110 -->
```
Safe arrival. Sell where the good is scarce. Profit is not guaranteed.
```

<!-- count: caption.8b min=1 max=110 -->
```
Ambushed: 30% of each good is lost. The risk is real, so is the loss.
```

Backing: ambush loss `AMBUSH_LOSS_BP` 3000 (floor of 30% per good, contract rule, `contracts/caravan/DECISIONS.md`);
`docs/screens/live-10-arrived-*.png`, `live-11-result-*.png`, `live-12-sell-sheet-*.png`, `live-13-after-sell-*.png`. If the
sale is a loss, say so in the caption instead of cutting it (for example "A loss this time. Prices moved while we travelled.").

### Shot 9 (1:36-1:44): leaderboard

Screen: "Ranks". On the dev backend there is one local player, so the board shows only that name.

<!-- count: caption.9 min=1 max=110 -->
```
Leaderboard by net worth. One local player in this test world.
```

Backing: `GET /api/leaderboard` (`docs/SERVER.md`); `docs/screens/live-14-ranks-*.png`. (The mock board adds fixture players
such as "Silk Baron"; do not show the mock board here.)

### Shot 10 (1:44-1:56): honest status and end card

Screen: first 6 s, a terminal with the test results (`pnpm test` summary lines and `test result: ok. 68 passed` from
`cargo test`); then 6 s of a plain end card: the Caravan Road logo, the repository URL, the sentence below.

<!-- count: caption.10a min=1 max=110 -->
```
Not live yet: contract deploy, NEAR AI Cloud, NEAR Intents. All written, tested offline.
```

<!-- count: caption.10b min=1 max=110 -->
```
Open source. Try it locally: README, "Try it in 2 minutes". Repo: TODO(owner)
```

Backing: README "What is real and what is not"; test counts run 2026-11-05: shared 35, web 332 (`32141a2`, 2026-11-06), worker 180, contract 68
(`cargo test`, 33 s warm), tools/art 25 (on 2026-11-01 one worker timing test failed once under CPU load and passed alone; it passed in the 2026-11-05 run). The repository URL is
`TODO(owner)`: it does not exist yet; replace the placeholder in the caption before burning it in (the count stays well
under the limit). If a hosted PLAY demo exists by then, add its URL (`TODO(owner)`) and change "Try it locally" to the
hosted link; otherwise leave the sentence as it is.

## 4. Claim ledger (everything the video says or shows)

| Claim shown or captioned | Backed by | Status |
|---|---|---|
| merchants have treasuries | `MERCHANT_TREASURY_FILS`; contract and `FakeContract` | tested offline; simulated contract only |
| no wallet, gas or seed phrase on screen | `vocabulary.test.ts` | tested (UI text) |
| 500 free dinars in PLAY | faucet route and rules | dev backend (real routes, simulated contract) |
| prices come from stock; golden vectors | `packages/shared/src/quote.ts`, `contracts/caravan/src/math.rs` | 35 and 68 tests pass |
| merchants set spread and bias every minute inside limits | `apps/worker`, `spec/NPC.md`; the dev backend stand-in applies the baseline rules each tick | worker: fake model dry run only; dev backend: rule-based stand-in |
| decisions stored with a reason | `apps/worker/src/db.ts` (written), `Mind.tsx` | **not** run against a database or the real service; the drawer is mock data |
| guards cut risk 8% to 5.2% | `spec/ECONOMY.md` 2.4, 2.5 | shared formula; confirm on screen |
| ambush loses 30% per good | `AMBUSH_LOSS_BP`, contract rule | tested offline |
| leaderboard | `/api/leaderboard` | dev backend |
| not live: deploy, NEAR AI Cloud, Intents | README | true on 2026-11-01 |

Never in the video: "powered by NEAR AI Cloud", "verified", "attested", "TEE" as a present-tense claim, Google or Discord
sign-in, a deposit or withdrawal, a mainnet or testnet address, any hosted URL that does not work, any key or `.env` file.
Before exporting: scan every frame for the contents of `.env.local`, terminal history with secrets, and personal data
(your e-mail, your real name unless you want it shown).

## 5. Alternative if only the mock is available

If the dev backend does not start on the recording day, record shots 2-9 on the mock (`NEXT_PUBLIC_MOCK=1`, steps in the
README) and change the badge to `badge.mock`; the fake login there says "Demo mode: this login is simulated and nothing
leaves your browser." Shot 9 then shows fixture players, so use the caption "Leaderboard (fixture players in this mock)".

## 6. LIVE deposit scene (TODO(owner), mainnet): not in this cut

Plan 13.1 wanted a 15 s scene "deposit through NEAR Intents". It is **not** included because no deposit has ever happened:
the Intents client has only run against mocked HTTP and there is no deployed contract, treasury or 1Click JWT. The Cash
screen with a LIVE deposit exists as a UI preview on canned data (`/play/cash?live=1`, `docs/screens/19-*.png` to
`22-*.png`); showing it would need a badge "UI PREVIEW: canned data, no money moved" and is not recommended.

If you want the real scene, it is yours to do on mainnet, in this order, and only if it succeeds: follow `docs/INTENTS.md`
"What Mahdi must do for a real LIVE test" steps 1-6 (tiny amounts, separate treasury account), deploy per `docs/DEPLOY.md`,
record the browser while the dinars are credited once, keep the explorer link (https://explorer.near-intents.org), and add
a 10-15 s shot after shot 8 with a caption that states only what happened (for example "Real deposit through NEAR
Intents, small amount, credited once. TODO(owner): wording"). Remove shot 9 (leaderboard) to stay under 2:00. If the
attempt fails, leave the scene out and claim nothing about LIVE anywhere (master plan 13.1).

## 7. Export checklist

- Length under 2:00 (this script: 1:56). Format 16:9, 1280x720 or larger, H.264 MP4, captions burned in, no audio required.
- Watch it once with the sound off and once with the window at phone width; every caption must be readable.
- Check each caption against section 4; replace `TODO(owner)` in caption 10b with the real URL.
- Re-run `node scripts/count-chars.mjs docs/DEMO_SCRIPT.md` after editing caption text.
- Upload with the X post (`docs/X_POST.md`); the owner posts, nobody else.
