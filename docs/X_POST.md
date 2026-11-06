# X post drafts (Phase 10) - for the owner (Mahdi) to publish himself

Status: DRAFT written 2026-11-01. **Nothing has been posted.** The owner publishes the post from his own account; nobody
else does. Replace `{REPO_URL}` and `{GAME_URL}` yourself (they are `TODO(owner)`: the repository is not public yet and no
hosted game exists). The post's own URL then goes into `demoUrl` of the submission (`docs/SUBMISSION.md`).

## What the official rules ask of the post (https://nearhackathon.com/HACKATHON.md, read 2026-11-01 and again 2026-11-05: the post requirements below are unchanged)

- public, on X, from the team's side; says the project was built at NEAR HACKATHON; tags **@NEARProtocol** and
  **#NEARHackathon** (optional: @NearLegion, @NearBuilders); has the **demo video** (or screenshots) attached. A local-only
  demo is accepted only with a video: "screenshots are not enough when judges cannot open the demo" (Q-012).
- advice: lead with the user problem, show one complete moment, say concretely what NEAR does, give the demo and repo
  links, ask a real question. Skip architecture slides.
- The master plan's tag `@NEAR_hckthn` is not the official tag; use the two above.

## The one wording decision that is yours

The organisers want "built at NEAR HACKATHON". The truth recorded in the README "Timeline" section is: the first commit is
2026-10-23 01:16 +03:30 (2026-10-22 21:46 UTC); 31 of the 40 commits existing on 2026-11-01 predate the window (scaffold,
spec, UI on a mock, server, worker, contract). So these drafts say **"started Oct 22, built for #NEARHackathon"** and never
"built entirely during" the hackathon. If, by 2026-11-14, you do real NEAR work inside the window (for example a testnet
deploy), you can honestly add "NEAR integration finished during the hackathon" **only** for what you did. PROGRESS decision
D1 records that you accepted the risk that the organisers treat pre-window work as a violation; do not paper over it.

## Facts every variant must stay inside (checked 2026-11-01; counts re-run 2026-11-05)

| Fact | Source |
|---|---|
| The loop (buy, route, guards, ambush, sell, leaderboard) runs in the browser against a mock and against a local dev backend | README "Try it in 2 minutes"; `docs/SERVER.md` "Local end-to-end dev mode" |
| The merchants are "meant to be" AI agents: the worker, validation and fallback are written and tested (180 tests), but it has never called NEAR AI Cloud; the dev backend uses a rule-based stand-in | `docs/WORKER.md`, `docs/NPC_EVAL.md` (fake model), `apps/web/src/server/dev/ticker.ts` |
| Contract: 68 tests pass (run 2026-11-05, price curve `MULT_K_BP` 3000 = spec-v1.2), not deployed | `contracts/caravan`, README |
| NEAR Intents (1Click) client and meta-transaction relayer: written, tested offline, never run on a network | `docs/INTENTS.md`, `docs/SERVER.md` |
| TEE attestation is **not** verified; never write "verified" | `docs/WORKER.md` |
| No hosted demo, no public repository yet | README, PROGRESS |
| Most code was written with Claude Code under the owner's direction | README "Timeline" |

Do not write: "AI merchants powered by NEAR AI Cloud" (not running), "cash out via NEAR Intents" (never run), "play free"
without a working hosted link, "trustless" or "verified", any prize or rank claim, any number that is not in the table.

## Variant A (default: video and repo, no hosted game)

Use when there is no hosted game. Attach the video.

<!-- count: variantA min=1 max=280 tokens=REPO_URL:23,GAME_URL:23 -->
```
Caravan Road: a trading game where the merchants are meant to be AI agents with their own treasuries and a stored reason for every price. Buy cheap, send a caravan, dodge ambushes, sell dear. Started Oct 22, built for #NEARHackathon @NEARProtocol. Repo: {REPO_URL}
```

## Variant B (only if a hosted PLAY demo exists and you have played it end to end)

Conditions: the `{GAME_URL}` page opens without any setup, the loop works there, and the services will stay up until at
least 2026-11-19. Do not use this variant otherwise. Attach the video.

<!-- count: variantB min=1 max=280 tokens=REPO_URL:23,GAME_URL:23 -->
```
Buy cheap in Bandar, send a caravan, sell dear in Shahr. Caravan Road is a pixel-art trading game, no wallet needed. Play free: {GAME_URL} Repo: {REPO_URL} Started Oct 22, built for #NEARHackathon @NEARProtocol. Which route would you take?
```

## Variant C (question-led, video and repo)

<!-- count: variantC min=1 max=280 tokens=REPO_URL:23,GAME_URL:23 -->
```
Would you trust a game merchant whose prices come from an AI agent that can only move two dials, spread and bias, inside limits a contract checks? That is the bet in Caravan Road, my #NEARHackathon entry @NEARProtocol (started Oct 22). Repo: {REPO_URL}
```

## Replies under the post (post them as a thread, in this order)

Reply 1 states the status. Re-read it on posting day and edit it to what is true then (for example if a testnet deploy
has happened); the counts must still pass.

<!-- count: reply1 min=1 max=280 tokens=REPO_URL:23,GAME_URL:23 -->
```
Honest status: the UI runs on a mock and on a local dev backend. The contract (68 tests), the AI merchant worker and the NEAR Intents client are tested offline, not deployed, never run live. The README has "do X, see Y" steps and a "what is real" table. {REPO_URL}
```

Reply 2 is the stack, worded as "written", because none of it has run on a network yet.

<!-- count: reply2 min=1 max=280 tokens=REPO_URL:23,GAME_URL:23 -->
```
Stack: near-sdk 5.30 contract, NEP-366 meta-transactions with per-player sub-accounts, function-call keys for merchants, a NEAR AI Cloud client, a NEAR Intents (1Click) client, Auth.js social login. All written; which parts ran live is in the README.
```

## Notes

- The limits above are the standard 280 characters; each link counts 23 on X (the script counts `{REPO_URL}` and
  `{GAME_URL}` as 23). A Premium account allows longer posts, but the drafts stay within 280 so they work everywhere.
- No emojis, no hashtags other than the required one, so the required tags are not buried.
- After posting: open the post in a private browser window and check it is public, shows the video, and carries both
  tags. Then copy its URL into `demoUrl`.
- Before posting, re-run `node scripts/count-chars.mjs docs/X_POST.md` after any edit.
