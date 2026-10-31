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
9. **`Idempotency-Key` per call.** `api-client` generates a new key for every call, so a client-side retry after a
   network error is a new action. That is safe (contract rules decide), but server-side replay protection only helps
   callers that reuse a key. Optional: let the UI reuse the key for retries of the same click.
