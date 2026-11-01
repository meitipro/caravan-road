# Open issues: NEAR Intents (1Click) client

Written by the Phase 7 implementer. Docs read: the OpenAPI document
<https://1click.chaindefuser.com/docs/v0/openapi.yaml> (version 0.1.10) and the guides under
<https://docs.near-intents.org/integration/distribution-channels/1click-api/> (see the header of
`oneclick.ts` for the exact list). Nothing here touched the network: the client has only ever talked to a mock.

Items 1-6 are documentation ambiguities or contradictions with the plan (the client takes the conservative
reading and fails closed). Items 7-13 are interface, ownership or process gaps that need a decision from the owner of
the file named in each item (I did not edit those files).

## Documentation ambiguities

1. **Auth header: the plan says "JWT"; the docs now prefer a different header.** The authentication guide says
   to send the partner JWT as `X-API-Key` and that `Authorization: Bearer` "is also accepted"; the OpenAPI marks
   `X-API-Key` as recommended and Bearer as "legacy". The client sends `X-API-Key` by default
   (`authHeader: "bearer"` is a constructor option, not wired to an environment variable). The quickstart page still
   shows Bearer in its curl example. The first live call will show which is accepted; if `X-API-Key` is refused,
   flip the default in `create.ts`.
2. **No quote id.** 1Click returns `correlationId` (tracing), `signature` and a `depositAddress`; there is no quote
   id, and `GET /v0/status` is keyed by `depositAddress` (plus `depositMemo` on some chains). The client therefore
   sets `IntentQuote.quoteId = depositAddress`. Chains that need a memo (`depositMemo` in the answer; the docs name
   Stellar, XRP and TON in the field description) are **refused** because `IntentQuote` has no memo field. Request
   `depositMode` is left at its default `SIMPLE`.
3. **Asset id of USDC on NEAR is not in the docs.** The guides only show the format (`nep141:wrap.near`,
   `nep141:<chain>-<contract>.omft.near`). The client does not hard-code it: it reads `ONECLICK_USDC_ASSET_ID` and,
   at runtime, requires that exact id in `GET /v0/tokens` with `blockchain: "near"`, symbol `USDC`, 6 decimals and
   contract equal to the id's suffix. Otherwise every money call fails closed. **Needs:** the operator copies the id
   from the live token list (see `docs/INTENTS.md`). `env.ts` and `.env.example` are outside this component: please
   add `ONECLICK_USDC_ASSET_ID` to `.env.example` (the client reads it from `process.env`).
4. **Withdrawal target: is the NEAR deposit address ready to receive USDC?** For `depositType: ORIGIN_CHAIN` with a
   NEAR origin asset, the docs do not say whether the returned `depositAddress` is a named or implicit account, nor
   whether it is already registered (`storage_deposit`) with the USDC contract. The client sends a plain
   `ft_transfer` with 1 yoctoNEAR. If the receiver is unregistered the receipt fails, nothing moves
   (NEP-141 is atomic) and the withdrawal is refunded to the player, so the failure mode is safe but would make
   every withdrawal fail. **Needs:** the tiny live withdrawal test. If it fails, add a `storage_deposit` step in
   `treasury.ts` (costs a little NEAR per new address).
5. **Fees on withdrawals.** `EXACT_INPUT` from USDC sends exactly the debited amount in and delivers `amountOut`
   (net of `withdrawFee` and the market fee). The player is debited the full amount and receives less. There is no
   withdrawal preview in the interface (item 8).
6. **Docs have no full example response bodies for `/v0/quote` and `/v0/status`.** Fixtures in the tests are
   assembled from the OpenAPI per-field `example:` values (amounts `1000000`, `995000`, `9950000`, `9900000`,
   `timeEstimate` 120, the correlation id, `swapDetails` examples, the status names) and the token list example from
   the quickstart. The mock echoes the request in `quoteRequest`, which the OpenAPI marks as required in
   `QuoteResponse`. If the real server normalises an address (case is tolerated; anything else is not), the echo
   check fails closed and the quote is refused. Rate limits are not documented; GET retries are capped at 2.

## Interface and ownership gaps (not changed by me)

7. **Sent withdrawals are never followed (`game/cron.ts`).** `cronWithdrawals` marks a withdrawal `SENT` and stops;
   plan 10.2 step 4 wants "cron follows status; success -> DONE; failure/refund -> refund_withdraw". The client
   already offers `withdrawalStatus(quoteId)` (not part of `IntentsClient`) returning `PENDING | SUCCESS | REFUNDED |
   FAILED` plus `refundedMicro`. **Needs:** a cron step for rows in `SENT` that calls it, then `refund_withdraw` on
   `REFUNDED`/`FAILED`. Until then a withdrawal that 1Click refunds back to the treasury is not returned to the
   player automatically: watch `https://explorer.near-intents.org` for the deposit address.
8. **Asset list and previews have no route.** `listTokens()` (GET /v0/tokens, cached) and `previewDeposit()` (dry
   quote) exist on `OneClickIntents`, but spec 2.13 has no `/api/tokens` or preview endpoint and `IntentsClient` has
   neither method. The UI therefore cannot show the supported assets or the final amount before the real quote.
   **Needs:** a spec decision (new endpoints, spec-v1.2) and the interface additions.
9. **Quote `signature` is not stored.** The docs say it "must be saved ... to resolve any disputes". There is no
   column or field for it. Only the `correlationId` is logged (prefix, never the address in full).
10. **`cron.ts` compares `IntentStatus.asset` with the deposit's `origin_asset`.** What actually arrives at the
    treasury is USDC on NEAR, not the origin asset. The client returns the quote's `originAsset` as `asset` and
    verifies the destination asset (our USDC) itself, so the check is satisfied meaningfully only because of that
    contract. A cleaner interface would carry both assets.
11. **Money crons do not know about `EXPIRED` from the provider.** 1Click has no such status (its statuses are
    `PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED`). `EXPIRED` stays
    the cron's own decision (deadline + 1 h grace on a still-pending row), and a 404 for an unknown address is
    reported as `PENDING` so that rule applies. An `INCOMPLETE_DEPOSIT` is `PENDING` until the deadline; the
    provider refunds to the player's refund address after it.
12. **Duplicate-send protection is two-layered.** The DB compare-and-set (`REQUESTED -> SENDING`) is the real guard.
    The client adds a per-process set of already used withdrawal refs (a repeat throws, so the row stays
    `SENDING`). It does not survive a restart; a crash after `ft_transfer` but before the DB update leaves the row in
    `SENDING` for a human, which is what `cron.ts` already documents.
13. **Terms of use.** The API has its own terms
    (<https://docs.near-intents.org/security-compliance/terms-of-service.md>) and a risk/compliance page. I did not
    review them; Mahdi should read them before going LIVE.
