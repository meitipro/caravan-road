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
