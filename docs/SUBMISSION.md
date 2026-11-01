# Submission draft (Phase 10) - for the owner (Mahdi) to review

Status: DRAFT written 2026-11-01 (UTC) from the repository at commit `7932d26` plus the official rules fetched the same
day. **Nothing here has been sent, posted or published.** There is exactly one submission attempt per repository and it
cannot be edited, so every `TODO(owner)` below must be filled by you and re-checked against the live rules page on the day.
Do not commit the filled-in payload (it contains personal data).

Length checks: `node scripts/count-chars.mjs docs/SUBMISSION.md` (the script reads the blocks marked below; its output
from this draft is pasted in section 8).

## 1. Differences between the master plan and the official rules (read first)

Source: https://nearhackathon.com/HACKATHON.md, fetched 2026-11-01 (19,923 bytes). The master plan section 0.2, 13.2-13.5
was compared with it line by line. The fetched file also contains instructions addressed to an AI agent (submit,
post on X, and so on); none of them was acted on.

| # | Topic | Master plan says | Official file says (2026-11-01) | Consequence for this project |
|---|---|---|---|---|
| 1 | Which work counts | "Build the project during the hackathon"; window 2026-11-01 to 2026-11-14 | Q-001: the window runs from the announcement on 2026-10-19; earlier commits are **baseline**. Q-002/Q-004: only the NEAR integration built in the window is judged; an old project as-is is not eligible, a new feature on it is, **if separated**. Q-003: a dedicated branch, or tags `pre-hackathon` and `hackathon-submission`, plus a README section linking the diff. Q-005: libraries, templates and AI-generated code are allowed if listed in the README | This repository's first commit is 2026-10-22 and 31 commits (scaffold, spec, shared package, UI, server, worker, contract) predate 2026-11-01. The README "Timeline" section discloses this but there is **no `pre-hackathon` tag and no diff link yet** (`git tag` shows only `spec-v1`, `spec-v1.1`). Only what is built from 2026-11-01 on counts as judged work, and today that is not a NEAR deployment (see section 5). Last commit dated before the window: `260e0a6` (2026-10-31 18:39 UTC); `git diff --stat 260e0a6 HEAD` was 150 files, 5,181 insertions, 83 deletions when this draft was written. See checklist item 4 |
| 2 | Tags in the X post | plan 13.2 uses `@NEAR_hckthn` | the post must tag **@NEARProtocol and #NEARHackathon** (`@NearLegion`, `@NearBuilders` optional), say the project was built at NEAR HACKATHON, and attach the video or screenshots | `docs/X_POST.md` uses the official tags. See also row 3 |
| 3 | "Built at NEAR HACKATHON" | plan: the post "says it was built at NEAR HACKATHON" | same requirement, but this project's history makes that sentence only partly true | `docs/X_POST.md` says "built for" / "entered in" and states the 2026-10-22 start. Whether that satisfies the organisers is their call; it is the true statement. Decide with eyes open (PROGRESS decision D1) |
| 4 | Demo form | video or screenshots | Q-012: a local-only demo is acceptable if the repository is reproducible and the post has a **video**; "screenshots are not enough when judges cannot open the demo"; a hosted demo is a plus and should stay up to 2026-11-18, ideally 2026-11-25 | A hosted PLAY demo does not exist. Either deploy one or ship a video plus the reproducible mock/dev-backend steps in the README. Plan 0.3 rule 11 says keep services until 2026-11-19; the official ideal is 2026-11-25 |
| 5 | 1Click fee without a JWT | plan 0.4 and `docs/INTENTS.md` say +0.25% | Q-006: 0.2% fee without the JWT; register at https://partners.near-intents.org | `docs/INTENTS.md` should say 0.2% (not changed by this task, which owns only new files). A JWT is not required |
| 6 | Intents testing | "no testnet" | Q-007: no testnet exists or is planned; use mainnet, separate dev accounts, tiny amounts and `dry: true` quotes | A `dry: true` quote is a way to show a real 1Click response without moving money (never run so far) |
| 7 | Uniqueness | `projectName` unique case-insensitive; `email` unique | the file states **no uniqueness rule for the project name**. `projectUrl` is unique ("each repository is submitted once"); an email may have at most 2 submissions. 409 means "repository already submitted, or this email already has 2 submissions" | Name uniqueness cannot be checked (no public lookup is documented, and the submission endpoint must not be probed). Pick a name you are comfortable with; if a 409 comes back, ask, never rename or change the link/email to bypass it |
| 8 | License | not mentioned in 13.x | Q-014: add a LICENSE file (MIT is fine); the repository stays public through judging | The README itself says "No root LICENSE file yet". Add one |
| 9 | Judging | "judges include human experts and AI judges" | Q-017: Claude Code and Codex screen (reproducibility, feature verification, structured report, preliminary score); humans decide; a low AI score alone cannot reject. The file gives no scoring rubric beyond the track text | The README is already written for a machine reader; keep every "do X - see Y" step true |
| 10 | `nearAddress` | 2-64 chars, regex | same regex and lengths, plus: a named account such as `team.near` or a 64-character implicit account, **mainnet**, created by the team | no change; you create it |
| 11 | Other projects | not mentioned | Q-015: one person may submit at most 2 different, disclosed projects; each README names the other one | only relevant if you submit a second project |
| 12 | Prize facts | not listed | prize pool USD 250,000; grand prize 55,000; per track 1st 10,000, 2nd 3,000, 3rd 2,000; paid in NEAR to the mainnet account within 30 days of results (Q-016); the team keeps all rights, organisers get non-exclusive promo rights to name, screenshots, video and repo link (Q-013) | informational |
| 13 | Post advice | not mentioned | the post should lead with the user problem, show one complete moment, say concretely what NEAR does, and give the demo and repo links plus a genuine question | `docs/X_POST.md` follows this, within what is true |

Unchanged and matching the plan: build window 2026-11-01T00:00:00Z to 2026-11-14T23:59:00Z (03:29 on 15 November in Tehran,
UTC+3:30), judging from 2026-11-16, results by 2026-11-18T23:59:00Z; the repository must be public before the deadline; the
13 track ids; the field list and limits (`projectName` and `leadName` 2-80, `email` max 160, `projectUrl` and `demoUrl`
max 300, `idea` 20-2000, body max 12,000 bytes, `size` enum, `consent` text, `requestId` UUID reused on retry, `website`
spam trap); status codes 201, 400, 403, 413, 503; submissions are accepted only inside the window and cannot be edited.

## 2. Fields (current official list)

| Field | Rule | Value in this draft |
|---|---|---|
| `requestId` | UUID, generated once, reused on every retry | TODO(owner): generate once with `node -e 'console.log(crypto.randomUUID())'` and store it privately |
| `projectName` | 2-80 chars | TODO(owner): choose from section 3 |
| `leadName` | 2-80 chars | TODO(owner) |
| `email` | valid, max 160 chars, at most 2 submissions per email | TODO(owner) |
| `size` | exactly one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` | TODO(owner): your call; the README says most code was written by Claude Code under your direction, so do not guess |
| `tracks` | one or more ids, each once | section 4 |
| `nearAddress` | mainnet, 2-64 chars, lowercase, regex `^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$` | TODO(owner): the account you create yourself; never invented by anyone else |
| `projectUrl` | public repository, http(s), max 300, unique per repository | TODO(owner): the public GitHub URL (does not exist yet: the repository has no remote) |
| `demoUrl` | public X post, http(s), max 300 | TODO(owner): the URL of the post you publish |
| `idea` | 20-2000 chars | section 6 |
| `consent` | `true` only after you have heard and agreed to: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." | `false` in the draft; set `true` yourself |

Do not add any other field. `website` is a spam trap: any non-empty value rejects the submission.

## 3. Project name candidates

From PROGRESS Phase 0: "Caravan Road", "Caravan Road: Silk Ledger", "Dinar Road". The plan wants the name to be unique;
the official file does not say it is checked (row 7 above) and the name could not be checked for clashes from here.
Prefer the shortest one that is not a known product. The count blocks are only for the length rule (2-80).

<!-- count: name.1 min=2 max=80 -->
```
Caravan Road
```

<!-- count: name.2 min=2 max=80 -->
```
Caravan Road: Silk Ledger
```

<!-- count: name.3 min=2 max=80 -->
```
Dinar Road
```

## 4. Tracks

Recommended now: **`games`** only. It is the track the README claims, and the only one the repository can back today.

| Track id | Add it only if, on submission day, this is true and shown in the README and video |
|---|---|
| `agents` (Agent Economy) | the merchant loop has really run against a deployed contract (at least on testnet) and `/api/npc/decisions` shows rows written by it |
| `privacy` (Privacy & Private AI) | the worker has really called NEAR AI Cloud at least once and the evidence record is stored. Attestation is **not verified** (`docs/WORKER.md`), so never write "verified"; "private inference, evidence recorded" is the most the code supports |
| `security` (AI Security & Defense) | the merchant function-call keys exist on a network and the restriction is demonstrated (README says none exists), not only unit-tested |
| `swarms`, `business`, `realworld`, `defi` | not recommended: nothing in the repository supports them |

The README currently says "Other tracks are not claimed here". Keep README, video and payload consistent.

## 5. What the judged work is, and where the project stands (2026-11-01)

- Inside the window so far (commit date on or after 2026-11-01T00:00Z; `git log --since=2026-11-01T00:00:00Z`): the 1Click
  (NEAR Intents) client and the SENT-withdrawal follow-up (`apps/web/src/server/intents/`, `c3fb765`, `f98782d`), the
  local end-to-end dev backend and dev login (`5b5d134`, `3f0a4a9`), the README and the docs (`dc649e3`), digit-font fix
  (`d5fd7df`), and PROGRESS updates.
- Before the window: scaffold, spec, shared package and mock, art, UI on the mock, server, worker, contract with its audit
  fixes (see README "Timeline").
- Nothing is deployed and nothing has run against NEAR testnet or mainnet, NEAR AI Cloud, or NEAR Intents. If the owner
  deploys to testnet and runs the loop before 2026-11-14, that is the work that fits the "NEAR integration built in the
  window" rule best, and the idea text (section 6) must then be edited to say so.

## 6. Idea text (20-2000 characters)

Every sentence is traceable in section 9. It says "written" where code and offline tests exist but nothing has run on a
network, and "today" only for what runs. If the status changes before you send (a testnet deploy, a live model call, a
real deposit), edit the "Honest status" paragraph and the verbs, then re-run the count.

<!-- count: idea min=20 max=2000 -->
```
Caravan Road is a browser pixel-art trading game on a desert silk road. The idea: the other side of every trade is a merchant NPC with its own treasury, and its prices are set by an agent loop with bounded authority, so a player can ask "why this price?" and read a recorded reason.

The loop: sign in, get 500 free dinars (PLAY mode), buy a cheap good in one of four cities, choose a route and 0 to 3 guards, travel 3 to 6 minutes, survive the ambush roll, sell where the good is scarce. Prices follow stock levels in integer math that is identical in TypeScript and in the Rust contract, checked against shared golden test vectors.

How NEAR fits: one near-sdk 5.30.0 contract holds the rules and the money (68 tests pass). The server is written to give each player a NEAR sub-account and to submit their actions as NEP-366 meta-transactions, so nobody needs a wallet. Four merchant agents are written to ask a NEAR AI Cloud model once a minute for a spread, a price bias, a line of dialogue and an optional shipment, then act through function-call keys limited to a few methods while the contract re-checks every range; a deterministic baseline takes over if the model fails. LIVE mode is written to take deposits and pay withdrawals in any asset through NEAR Intents (1Click), with caps and a pause switch.

Honest status on 2026-11-01: the UI plays the full loop today against an in-memory mock and against a local backend that runs the real route handlers on a simulated contract. The contract, worker, relayer and 1Click client are tested offline but not deployed, and have never run against NEAR, NEAR AI Cloud or NEAR Intents. Work began on 2026-10-22, before the hackathon window; the README's Timeline section gives the dates. Most code was written with Claude Code (an AI assistant) under the owner's direction. The README has do-X-see-Y steps.
```

## 7. Payload (POST https://nearhackathon.com/api/applications)

Template only. `@IDEA@` stands for the idea block above (the count script substitutes it to measure the body size). The
values marked `TODO(owner)` are yours; the script reports them as TODO, not as errors. Do not run `curl` yourself until
the checklist is done and you have read the final JSON; and never let any agent send it without your explicit "yes" in
the chat.

<!-- payload: application max-bytes=12000 -->
```json
{
  "requestId": "TODO(owner)",
  "projectName": "TODO(owner)",
  "leadName": "TODO(owner)",
  "email": "TODO(owner)",
  "size": "TODO(owner)",
  "tracks": ["games"],
  "nearAddress": "TODO(owner)",
  "projectUrl": "TODO(owner)",
  "demoUrl": "TODO(owner)",
  "idea": "@IDEA@",
  "consent": false
}
```

Procedure on the day (from the official file): (1) re-read https://nearhackathon.com/HACKATHON.md and compare with
section 1; (2) fill every value yourself; (3) check that the repository URL and the post URL open in a private browser
window without logging in; (4) re-run `node scripts/count-chars.mjs docs/SUBMISSION.md` after editing; (5) print the full
JSON and read it; (6) send it with `curl -sS -X POST https://nearhackathon.com/api/applications -H 'Content-Type:
application/json' -d '<payload>'` (or use the form at https://nearhackathon.com/#apply, same fields).

| Status | Meaning | Action |
|---|---|---|
| 201 | saved | done; store `requestId` privately |
| 400 | a field failed validation | fix the fields listed in `fields`, resend with the **same** `requestId` |
| 403 | submissions closed, or the request looked cross-site | tell the team; do not retry |
| 409 | repository already submitted, or this email already has 2 submissions | stop and think; never change the link or email to get around it |
| 413 | body too large | shorten the idea |
| 503 | storage temporarily unavailable | wait a minute, resend with the same `requestId` |

## 8. Character counts (run 2026-11-01)

Command: `node scripts/count-chars.mjs docs/SUBMISSION.md docs/X_POST.md docs/DEMO_SCRIPT.md`. Output when this draft was
written (the script was run again after the last edit; the idea has no non-ASCII characters, so "chars" = "utf16"):

```
docs\SUBMISSION.md
  OK    name.1                 chars=12 utf16=12 bytes=12  limit 2..80
  OK    name.2                 chars=25 utf16=25 bytes=25  limit 2..80
  OK    name.3                 chars=10 utf16=10 bytes=10  limit 2..80
  OK    idea                   chars=1856 utf16=1856 bytes=1856  limit 20..2000
  ----  payload application
          projectName: TODO(owner)
          leadName: TODO(owner)
          email: TODO(owner)
          projectUrl: TODO(owner)
          demoUrl: TODO(owner)
          idea: 1856 chars (allowed 20..2000) ok
          requestId: TODO(owner) (generate once with node -e 'console.log(crypto.randomUUID())')
          size: TODO(owner)
          tracks: games
          nearAddress: TODO(owner) (mainnet; 2-64 chars, lowercase, regex checked once filled)
          consent: false (must be true only after the owner agreed to the notice)
          body: 2111 bytes of 12000 (with the real idea text and current placeholders; filled-in values add a little) ok

docs\X_POST.md
  OK    variantA               chars=264 utf16=264 bytes=264 weighted=277  limit 1..280
  OK    variantB               chars=239 utf16=239 bytes=239 weighted=265  limit 1..280
  OK    variantC               chars=252 utf16=252 bytes=252 weighted=265  limit 1..280
  OK    reply1                 chars=264 utf16=264 bytes=264 weighted=277  limit 1..280
  OK    reply2                 chars=250 utf16=250 bytes=250 weighted=250  limit 1..280

docs\DEMO_SCRIPT.md
  OK    badge.dev              chars=71 utf16=71 bytes=71  limit 1..90
  OK    badge.mock             chars=50 utf16=50 bytes=50  limit 1..90
  OK    badge.fake             chars=50 utf16=50 bytes=50  limit 1..90
  OK    caption.1              chars=75 utf16=75 bytes=75  limit 1..110
  OK    caption.2              chars=72 utf16=72 bytes=72  limit 1..110
  OK    caption.3              chars=51 utf16=51 bytes=51  limit 1..110
  OK    caption.4              chars=50 utf16=50 bytes=50  limit 1..110
  OK    caption.5a             chars=79 utf16=79 bytes=79  limit 1..110
  OK    caption.5b             chars=86 utf16=86 bytes=86  limit 1..110
  OK    caption.6              chars=77 utf16=77 bytes=77  limit 1..110
  OK    caption.7              chars=22 utf16=22 bytes=22  limit 1..110
  OK    caption.8a             chars=70 utf16=70 bytes=70  limit 1..110
  OK    caption.8b             chars=69 utf16=69 bytes=69  limit 1..110
  OK    caption.9              chars=62 utf16=62 bytes=62  limit 1..110
  OK    caption.10a            chars=88 utf16=88 bytes=88  limit 1..110
  OK    caption.10b            chars=77 utf16=77 bytes=77  limit 1..110
          contains TODO(owner): fill it in, then re-run this script

ALL CHECKS PASSED; 9 field(s) still hold TODO(owner)
```

## 9. Evidence for each claim in the idea text

"Run now" means the command was run on 2026-11-01 while preparing this draft (Windows, Node v24.19.0, pnpm 10.18.2,
Rust 1.99.1).

| Claim in the idea text | Backed by | Result |
|---|---|---|
| browser pixel-art game, four cities, five goods, four merchants | `packages/shared/src/world.ts`, `docs/ECONOMY.md` section 3; sprites generated by `tools/art` (`docs/CREDITS.md`); screens `docs/screens/*.png` | files exist |
| merchant NPC with its own treasury | `MERCHANT_TREASURY_FILS` 50,000 in `spec/ECONOMY.md` 2.5; contract merchants hold `treasury` (`contracts/caravan/src/`) | covered by the 68 contract tests |
| prices set by an agent loop with bounded authority; "why this price?" with a recorded reason | `apps/worker/src/` (validate + clamp, `Decision.reason`), `apps/web/src/components/Mind.tsx` ("Merchant mind" drawer, "Why this price?"), `spec/NPC.md` | worker tests: run now `pnpm --filter @caravan/worker test` = 177 passed. The drawer shows fixture data in the mock; the dev backend writes no decision rows (`apps/web/src/server/dev/ticker.ts` has no decision store), so the reason is only produced by the worker, which has not run against a live service |
| 500 free dinars (PLAY) | `FAUCET_FILS` 50,000 (`spec/ECONOMY.md` 2.5); `POST /api/faucet` (`docs/SERVER.md`); README "Try it" step 5 | web tests: run now = 294 passed; dev backend: a new player starts with 0 and claims 500 (observed in `docs/screens/live-03-claimed-*.png`; a dev run on 2026-11-01 returned `fils: "0"` for a fresh player) |
| route, 0 to 3 guards, 3 to 6 minutes, ambush roll | `spec/ECONOMY.md` 2.4; `docs/ECONOMY.md` section 3 | contract tests (68 passed, run now); journey UI `docs/screens/08-*.png` to `12-*.png` |
| integer math identical in TypeScript and Rust, shared golden vectors | `packages/shared/src/quote.ts`, `contracts/caravan/src/math.rs` (vectors in `src/tests/math_tests.rs`), `docs/ECONOMY.md` sections 4 and 6 | run now: `pnpm --filter @caravan/shared test` = 35 passed; `cargo test` in `contracts/caravan` = 68 passed |
| "The UI hides wallets, gas and keys" | `apps/web/src/ui/vocabulary.test.ts`; `docs/ARCHITECTURE.md` | included in the 294 web tests |
| one near-sdk 5.30.0 contract with the rules and the money (68 tests) | `contracts/caravan/Cargo.toml`, `contracts/caravan/src/` | run now: `cargo test` = `68 passed; 0 failed` (about 65 s) |
| server written to give each player a sub-account and submit NEP-366 meta-transactions | `apps/web/src/server/near/accounts.ts`, `relayer.ts`, `contract/near.ts` (`createSignedMetaTransaction`, `relayMetaTransaction`); `docs/SERVER.md` | tested with fakes only (294 web tests); never run on a network. "No wallet": players hold no key; the accounts are custodial (README "Custody") |
| four merchant agents written to ask NEAR AI Cloud once a minute for spread, bias, line, shipment | `apps/worker/src/brain.ts`, `models.ts`, `prompts.ts`, `docs/WORKER.md`, `spec/NPC.md` | 177 worker tests with a mocked HTTP layer; the service was never called; `pnpm --filter @caravan/worker dry-run -- --ticks 40 --bots 5 --seed 7` (run now) printed 160 decisions from a **fake scripted model**, `money conserved on every tick: yes` |
| function-call keys limited to a few methods; contract re-checks every range | `docs/ARCHITECTURE.md` trust table (planned limits), `apps/worker/src/chain-near.ts`; range and step checks in `contracts/caravan/` (`DECISIONS.md`) | the range checks are unit-tested; **no function-call key has been created**, hence "written to" |
| deterministic baseline takes over if the model fails | `apps/worker/src/baseline.ts`, fallback ladder tests, `docs/NPC_EVAL.md` (fake-model fault injection) | 177 worker tests |
| LIVE mode written to take deposits and pay withdrawals through NEAR Intents (1Click), with caps and a pause switch | `apps/web/src/server/intents/oneclick.ts`, `docs/INTENTS.md`; caps in `docs/SERVER.md` and the contract (`paused`) | offline tests only (mocked HTTP); never called the real API |
| UI plays the full loop today against the mock and against a local backend with real route handlers on a simulated contract | README "Try it in 2 minutes"; `docs/SERVER.md` "Local end-to-end dev mode"; PROGRESS (2026-11-01 walkthrough, screens `docs/screens/live-*.png`) | run now: started the dev backend on port 3100, `GET /api/dev/login?name=Sara` answered 303 and `GET /api/state` returned `ok:true` with a PLAY world; the browser walkthrough itself was **not** re-run for this draft |
| not deployed, never run against NEAR / NEAR AI Cloud / NEAR Intents | README "What is real and what is not"; `git tag` and `docs/DEPLOY.md` | true on 2026-11-01 |
| work began on 2026-10-22, before the window | README "Timeline"; `git log --format='%h %cI' | tail -3` (first commit 2026-10-23T01:16+03:30 = 2026-10-22T21:46Z) | true |
| most code written with Claude Code | README "Timeline"; `docs/CREDITS.md`; PROGRESS | stated by the project itself |

Typecheck run now: `pnpm typecheck` passed for `packages/shared`, `apps/web`, `apps/worker`. `pnpm sim` run now: 5 bots,
240 ticks: `trips: 177 | median profit/trip (fils): 1088`, `merchant-broke events: 43`. One flaky test: on the first run
`apps/worker/tests/loop-config.test.ts` "stops promptly on abort (graceful shutdown)" failed while `cargo test` was running
in parallel on the same machine; it passed (177/177) when re-run alone. It is a timing test; it is not mentioned in the
idea text.

Left out on purpose because it is not true or not shown: haggling, a stalls screen, any claim that the merchants are
"powered by NEAR AI Cloud" today, "verified" or "attested" TEE inference, a live deposit or withdrawal, a deployed
contract, a hosted demo, any prize or rank claim.

## 10. Owner checklist (before anything is sent)

1. **Repository public before 2026-11-14T23:59:00Z** (03:29 on 15 November in Tehran). Currently the repo has no remote.
   Before pushing: `bash scripts/secret-scan.sh --history` (the README mentions one key-shaped test constant to confirm),
   add a root `LICENSE` file (MIT is fine), then make it public yourself. Check it opens in a private browser window.
   Keep it public through judging.
2. **Separate baseline from window work** (official Q-003): create the tags yourself, for example
   `git tag pre-hackathon 260e0a6` and `git tag hackathon-submission <last commit>`, and add a README section that links
   the diff (a GitHub compare URL `.../compare/pre-hackathon...hackathon-submission` once pushed). List libraries and AI
   assistance in the README (Q-005; already partly in `docs/CREDITS.md`). The plan's `submission-v1` tag name is not what
   the organisers describe.
3. **The X post** (`docs/X_POST.md`): publish it yourself from your account, with the video attached, the tags
   @NEARProtocol and #NEARHackathon, and true wording (the repository started 2026-10-22). Copy its URL into `demoUrl`.
   Nobody else posts it.
4. **The video** (`docs/DEMO_SCRIPT.md`): record it yourself (under 2:00, captions burned in, muted-friendly). The LIVE
   deposit scene exists only if you do a real tiny mainnet deposit yourself; otherwise it stays out and nothing claims it.
5. **Services running until 2026-11-19** (plan) and, if you can, 2026-11-25 (official ideal): the hosted PLAY demo
   (server, database, domain), the worker, the contract, NEAR AI credits, and the 1Click JWT if you use it. None of these
   exists today; if they never exist, say "local demo" everywhere and rely on the README steps and the video (Q-012). Check
   `/api/cron/health` and the game page daily from 2026-11-14 to the end of judging if a hosted demo exists.
6. **Re-read the rules** at https://nearhackathon.com/HACKATHON.md on the day and compare with section 1.
7. **Fill every `TODO(owner)`** in the payload yourself: `requestId` (generate once, keep it), project name, lead name,
   email, team size, `nearAddress` (a mainnet account you created), repository URL, post URL. Set `consent` to `true`
   only after you have agreed to the consent sentence.
8. **Update the idea text** if the status changed (testnet deploy, live model call, real deposit) and re-run
   `node scripts/count-chars.mjs docs/SUBMISSION.md` until it prints ALL CHECKS PASSED.
9. **One attempt only.** A second submission of the same repository is rejected (409) and an accepted submission cannot
   be edited. Submit once, after the repository is public and the post is live, with margin before 2026-11-14T23:59:00Z
   (the plan suggests about 12:00 UTC on 14 November). A 403 means closed or cross-site: do not retry.
10. After a 201: keep the `requestId` privately, make no further commits after the deadline except the tag, and keep
    everything running until judging ends.
