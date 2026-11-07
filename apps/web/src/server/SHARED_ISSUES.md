# Issues found by the server owner (Phase 3)

Nothing in `packages/shared` or `spec/` was edited. Items for the owners of those areas:

1. **Lint blocks on the UI.** `apps/web/src/components/Shell.tsx:112` has `<a href="/api/auth/signout">`. Now that
   the Auth.js route `app/api/auth/[...nextauth]` exists, `@next/next/no-html-link-for-pages` flags it and
   `pnpm --filter @caravan/web lint` fails. Fix (UI owner): add
   `// eslint-disable-next-line @next/next/no-html-link-for-pages` above it (a full page navigation is intended).
   `next build` and typecheck are not affected.
2. **No `Event` view on the contract.** `/api/state` must attach "the last 20 contract events" (plan 6.6 task 4), but
   spec 2.14 has no events view and `Event` is undefined (OPEN_QUESTIONS #1). `NearContract.recentEvents()` can only
   return events from transactions this server instance submitted (parsed from `EVENT_JSON:` logs). Worker/other
   instances' events are invisible. Proposal: add a `get_events(from_id, limit)` view backed by a small ring buffer in
   the contract, or an indexer. `FakeContract` keeps a ring buffer of 200.
3. **Panic convention.** The server maps a panic by its leading ErrorCode token (`SLIPPAGE: price moved`). This
   matches `contracts/caravan/src/errors.rs` as of today. Natural-language fallbacks (`warehouse full`, `paused`, ...)
   exist in `errors.ts` but unknown text becomes `INTERNAL`.
4. **Contract view shapes are assumed.** `contract/near.ts` normalises `get_world` (merchants with nested `policy`,
   `now_ns` strings), `get_player`, `get_stalls`, `get_journey` (status string), `get_withdraw`, `get_config`, and
   calls `get_players({from_index, limit})`, `get_merchant({city})`. `get_world` in `types.rs` has no `stalls`, so
   the server also calls `get_stalls`. Please confirm names and argument names when `lib.rs` lands.
5. **`request_withdraw` arguments.** The server sends `{fils, dest_asset, dest_address}` (the contract's
   `WithdrawalView` stores both). Operator calls: `credit_deposit {account_id, fils, reference}`,
   `mark_withdraw {id, reference}`, `refund_withdraw {id}`, `set_paused {paused}`. Withdraw statuses follow
   `WithdrawStatus` (PENDING, SENT, DONE, REFUNDED).
6. **Plan 6.4b `<ROOT>`.** `p<8hex>.<ROOT>` can only be created by its parent account, so the server uses
   `RELAYER_ACCOUNT_ID` as ROOT (player accounts are `p<8hex>.<RELAYER_ACCOUNT_ID>`). The contract's
   `player_suffix` config (if set) must equal `.<RELAYER_ACCOUNT_ID>`. The relayer key must be a full-access key.
7. **`/api/state` blocks on first sign-in.** Creating the account (create tx + `register()`) takes a few seconds on
   a real network. The UI needs a loading state for the first `getState()` of a new user.
8. **`.env.example`.** The scaffold's `GOOGLE_CLIENT_ID` / `DISCORD_CLIENT_ID` names were replaced by the Auth.js
   inferred names `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`.
11. **UI requests for the dev backend** (`SERVER_BACKEND=dev`, see docs/SERVER.md). None is required: a link to
   `/api/dev/login?name=Sara&next=/play` signs a tester in. Nice to have when `NEXT_PUBLIC_MOCK=0` and the server
   reports dev login: a name box that does `POST /api/dev/login {"name": ...}` instead of the Google/Discord buttons,
   and a logout that calls `/api/dev/logout` instead of `/api/auth/signout`. The login route answers 404 whenever dev
   login is off, so the UI can probe it with one request to decide which login to show.
12. **`next.config.ts` and PGlite.** The server loads PGlite through a native dynamic import because webpack breaks its
   WASM lookup inside `next dev`. If the config owner prefers, `serverExternalPackages: ["@electric-sql/pglite"]` does
   the same.
10. **Withdrawal listing view (review fix 6).** `NearContract.getWithdrawals` assumes
   `get_withdrawals({from_id, limit})` returning ascending ids, each with `id`, `account_id`, `fils`, `dest_asset`,
   `dest_address`, `status`, so the server can find debits that have no database row. Please add it (or tell us the
   real name). Also: a relayed call's return value is read from the receipt executed by the contract account, so
   `request_withdraw` must return its id as JSON (a bare number).
9. **`Idempotency-Key` per call.** `api-client` generates a new key for every call, so a client-side retry after a
   network error is a new action. That is safe (contract rules decide), but server-side replay protection only helps
   callers that reuse a key. Optional: let the UI reuse the key for retries of the same click.
13. **Live walkthrough findings (UI session, dev backend, DEV_TICK_SECONDS=5).** Item 11 is done in the UI (name box + Play, Log out via /api/dev/logout). Full loop worked against the real routes: login, faucet 500.00, buy 10 Grain in Bandar, guard 1, journey, claim, sell, Ranks. Observations for the server/economy owners, none blocking:
   a. Journey duration is wall-clock (3:00 to Bandar-Shahr, 6:00 to Madan) and ignores `DEV_TICK_SECONDS`, so a dev walkthrough still waits 3 to 6 minutes. A `DEV_JOURNEY_SCALE` would make demos quick.
   b. `/api/leaderboard` returns only human players. The four NPC merchants are not in the table, so a new player is rank #1 with 500 dinars. Intended? The mock shows NPCs in the list.
   c. Price impact looks large for small trades: Bandar grain was 10.44 for the first buyer, 12.92 and 14.96 for the next two accounts a few minutes later (+43%) after only 10-unit buys. The planner estimate (taken at departure) then differs a lot from the sale price (101.48 estimated, 114.10 paid for 10 grain). Please check the dev ticker/NPC drift against docs/ECONOMY.md.
   d. `GET /api/dev/login` with no name answers 400 (dev login on) or 404 (off). The UI uses that as its probe, so please keep this behaviour stable.
14. **Contract rejections come back as HTTP 500 `INTERNAL` on the dev backend (found by the stalls walkthrough, UI session).** `relayer.submit()` maps the panic correctly (the server log says `contract panic mapped to RATE_LIMIT: RATE_LIMIT: too many open stalls`), but then `toResult()` in `src/server/http.ts:32` does not recognise the error: the log continues with `unhandled route error: ApiError: Too many requests. Please slow down.` and the route answers `500 {"code":"INTERNAL","message":"Something went wrong. Please try again."}`. Reproduced twice with two players against `SERVER_BACKEND=dev` (`next dev`): the 6th `POST /api/stall/create` (expected `RATE_LIMIT`) and `POST /api/stall/buy` on a stall whose seller had started a journey (expected `NOT_IN_CITY`; log: `contract panic mapped to NOT_IN_CITY ... unhandled route error: ApiError: You are not in that city.`). So the UI shows the generic "Something went wrong on our side" instead of the mapped text, and the status is 500 instead of 4xx, for every contract rule the relayer maps. Likely cause: `e instanceof ApiError` fails because `src/server/errors.ts` is bundled as two module instances in `next dev` (the cached `getServices()` container keeps the class of the route that created it, the throwing code and `http.ts` live in different route bundles). Suggested fix (server owner): identify the error without `instanceof`, for example `e instanceof Error && e.name === "ApiError" && typeof (e as {code?: unknown}).code === "string"`, or a `Symbol.for("caravan.ApiError")` brand, and add a test that loads `errors.ts` through two module registries (`vi.resetModules()`). Not checked in a production build (the dev flags refuse `NODE_ENV=production`), so it may or may not affect Vercel.
15. **`FakeContract.stallCancel` is looser than the contract (dev backend only).** `contract/fake.ts` `stallCancel` has no travelling check and no city check, and answers `BAD_REQUEST` for someone else's stall. `contracts/caravan/src/game.rs` `try_stall_cancel` answers `UNAUTHENTICATED` ("not your stall") for a foreign stall, `IN_TRANSIT` while the seller travels and `NOT_IN_CITY` when the seller is not in the stall's city. Seen in the walkthrough: after arriving in Shahr, the seller could cancel a Bandar stall through the API and the dev backend accepted it. The UI follows the contract (the Cancel button is disabled with a reason unless the player stands in the stall's city and is not travelling), so the dev backend currently cannot show that the rule holds. Also note for the UI mapping: a real `UNAUTHENTICATED` here would read "Please log in to continue", which is misleading; the screen never offers Cancel on other players' stalls, so a player cannot trigger it.
16. **Persistent dev world drifts to an unplayable market (observation).** After earlier sessions, `apps/web/.data` held a world at tick 278 where Bandar had 0 grain, 0 salt and 0 iron (only 80 spice at about 101 dinars and 60 silk at about 168), so a new player with 500 dinars could not buy anything cheap there. The stalls walkthrough had to start from a fresh `.data` (moved aside and restored afterwards). Related to 13c (price impact and NPC drift); worth checking `docs/ECONOMY.md` rebalancing against the dev ticker over hundreds of ticks.

17. **UI changes still needed for the contract parity fixes (server side is done, UI untouched).**
   a. **Asset ids.** `ui/cash-assets.ts` uses ids like `usdc-near` that 1Click does not know; the server now answers
      `BAD_REQUEST "That asset is not supported"` for them, before any money moves. Read the real ids from `GET /api/tokens`
      (LIVE only, public: `{assets: [{id, symbol, chain, decimals}]}`, e.g. `nep141:...omft.near`) and send those as
      `origin_asset` (deposit quote) and `dest_asset` (withdraw). In PLAY the route answers `MODE_NOT_ALLOWED`.
   b. **Minimum withdrawal 1,000 fils (10 dinars).** `PARAMS.MIN_WITHDRAW_FILS` is exported from `@caravan/shared`; disable the
      withdraw button below it. Also: one open withdrawal at a time (a second answers BAD_REQUEST "...withdrawal in
      progress") and the daily 10 USDC cap is per UTC day and a refunded withdrawal still counts (BAD_REQUEST "Daily
      withdrawal limit reached ... resets at 00:00 UTC"). Show these messages as they come.
   c. **Faucet (PLAY only), from the contract's `get_config` / `try_faucet`.** Cooldown is 3,600 s (`faucet_cooldown_seconds`),
      not the mock's 60 s. The faucet is refused with BAD_REQUEST once the player's `faucet_worth` is at least
      `faucet_max_balance_fils` (5,000 fils = 50 dinars), where `faucet_worth = fils + base value of inventory + goods in
      stall escrow + cargo of a journey that is IN_TRANSIT` (base value = quantity x base price). It pays `faucet_fils`
      (50,000 = 500 dinars). The UI should hide or disable the button (with the reason) using these numbers instead of the mock's rule.
   d. **Server-side notes, no UI work:** deposit lifetime cap is 200,000 fils (20 USDC) and never goes down; a deposit that would
      pass it ends in FAILED for manual refund.
   e. Not verified live (no keys): near-api-js' thrown-outcome shape for relayed failures (`transactionResult`) and the exact
      JSON of the delegate errors are read from the nearcore/near-api-js sources, not from a testnet run. Confirm in
      `smoke:testnet` that a deliberately stale nonce is retried once and that a contract panic via `playerCall` reaches the
      client as its mapped code (not INTERNAL).

## Resolved (server owner)

- 14: `ApiError` / `ContractPanic` are identified by a `Symbol.for` brand (`isApiError`, `isContractPanic`), not `instanceof`;
  verified under `next dev` (a 6th stall answers 429 `RATE_LIMIT`, a buy from a stall whose seller left answers 409
  `NOT_IN_CITY`, no `unhandled route error` in the log). A contract `UNAUTHENTICATED` panic maps to `BAD_REQUEST` (400)
  so the UI never shows "log in" for "not your stall". Production builds are unaffected (the brand is plain JS).
- 15: strict `FakeContract.stallCancel` now answers BAD_REQUEST (unknown), UNAUTHENTICATED (foreign, reaches clients as
  BAD_REQUEST), IN_TRANSIT, NOT_IN_CITY in the contract's order.
- 16: `pnpm --filter @caravan/web dev:reset` or `DEV_RESET=1` resets the dev world; the dev ticker keeps markets playable
  (`devKeepAlive`, dev only). The real rules are untouched.
