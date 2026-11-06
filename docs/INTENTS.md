# NEAR Intents (1Click) integration

Code: `apps/web/src/server/intents/`. Open questions and gaps: `apps/web/src/server/intents/OPEN_ISSUES.md`.
Status: implemented and tested **offline only** (mocked HTTP, fake treasury chain). Nothing has been sent to the
real 1Click API or to mainnet. NEAR Intents has no testnet ([FAQ](https://docs.near-intents.org/resources/faqs.md)),
so the first real call is a LIVE call with tiny amounts.

## What the server does

```
POST /api/deposit/quote  -> IntentsClient.quote()   -> POST /v0/quote (dry:false)     deposit address + deadline
GET  /api/deposit/status -> database row (no provider call)
cron /api/cron/deposits  -> IntentsClient.status()  -> GET  /v0/status?depositAddress=...   credit_deposit once
POST /api/withdraw       -> debit on chain (request_withdraw), row REQUESTED
cron /api/cron/withdrawals -> IntentsClient.withdraw() -> POST /v0/quote, then USDC ft_transfer from the treasury
```

Sources: [OpenAPI](https://1click.chaindefuser.com/docs/v0/openapi.yaml),
[Making a request](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md),
[Authentication](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md),
[Swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md).

## Fees and authentication (read on 2026-11-05)

Read directly (HTTP 200, plain Markdown) on 2026-11-05. None of the three pages states a last-updated date, so check
them again before relying on any figure.

| Source | What it says about the 1Click fee |
|---|---|
| NEAR Intents docs, [Fees](https://docs.near-intents.org/resources/fees.md), section "1Click Swap API Fees" (3,980 bytes) | Platform fees are charged **in addition to** the 0.0001% on-chain protocol fee and are not applied to `ANY_INPUT` quotes. **Without an API key:** an additional **0.25% (25 bps)** on every non-`ANY_INPUT` quote (any `appFees` you submit are kept and the 25 bps is added on top). **With an API key and no `appFees`:** **0.20% (20 bps)** normally, **0.01% (1 bp)** for stablecoin pairs (USDC, USDT, DAI) and same-asset multichain routes. **With a key and `appFees`:** split 50/50, 1Click keeping at least 20 bps (1 bp on those stablecoin / same-asset routes), subject to partner-specific configuration. A tip on the page says to apply for an API key to get the authenticated schedule rather than the extra 25 bps |
| NEAR Intents docs, [API Keys](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md) (4,504 bytes) | Unauthenticated requests pay an additional 0.25% (25 bps) platform fee on every non-`ANY_INPUT` quote; authenticated requests use the partner fee schedule (typically 20 bps, or 1 bp on stablecoin and same-asset multichain routes). The JWT comes from the [Partner Dashboard](https://partners.near-intents.org/home) and is sent as the `X-API-Key` header (`Authorization: Bearer` is also accepted for the same JWT) |
| Hackathon rules, [HACKATHON.md](https://nearhackathon.com/HACKATHON.md), Q-006 (21,697 bytes) | The JWT is **not required**; "without it, 0.2% fee"; register at https://partners.near-intents.org |

**Do they agree? No, on the no-JWT number.** The docs say the no-JWT case costs an additional 0.25%; the hackathon file says
0.2%. Two readings, both shown:

1. *The docs' reading (the primary source for the API):* **no JWT = an additional 0.25% (25 bps)** on every non-`ANY_INPUT`
   quote. The docs do not say whether the 25 bps replaces or is added to the 0.20% schedule; the table row ("additional", with appFees kept and 25 bps added on top) and the tip ("instead of" the extra 25 bps) can be read either way, so the total without a key is either
   0.25% or 0.45%, plus the 0.0001% protocol fee. Only a real (or `dry: true`) quote can show which; that was not done.
2. *The hackathon file's reading:* **no JWT = 0.2%**. That equals the docs' fee **with** a key (20 bps), not their no-key
   surcharge. The fees page also lists a separate 0.2% fee for swaps made through the near-intents.org web app, which is a
   different product from the 1Click API (a possible origin of the 0.2%; my inference, not stated anywhere).

**With a JWT the docs apply, and they are the only source that covers it:** 0.20% (20 bps) per quote, and 0.01% (1 bp) when
the route is a stablecoin pair or a same-asset multichain route, plus the 0.0001% protocol fee. The hackathon file says
nothing about the with-JWT case, so it does not conflict there. For Caravan Road that would mean 1 bp for a USDC deposit
from another chain to USDC on NEAR if 1Click classifies that as a same-asset or stablecoin route, and 20 bps for a swap
from another asset (for example NEAR or ETH) into USDC; whether a given route counts as same-asset was not checked. The
fee actually charged is whatever the quote response says. Either way the cost is small, and a JWT is not required for the
hackathon (Q-006), but it changes the fee and the header the server must send. The code sends the JWT as the `x-api-key`
header by default and as `Authorization: Bearer` only if configured (`authHeader` in `apps/web/src/server/intents/http.ts`);
that matches the page as read today (nothing was sent to the API to test it).
`PROGRESS.md` D4 says this file "should read 0.2%": that is the hackathon file's no-JWT figure, which the docs contradict.

### Deposit (any supported asset in, USDC on NEAR to the treasury)

`POST /v0/quote` with `dry:false`, `swapType: EXACT_INPUT`, `depositType: ORIGIN_CHAIN`, `originAsset` = the asset
the player picks (must be in `GET /v0/tokens`), `destinationAsset` = USDC on NEAR (`ONECLICK_USDC_ASSET_ID`),
`recipient` = `TREASURY_ACCOUNT_ID` with `recipientType: DESTINATION_CHAIN`, `refundTo` = the player's refund
address with `refundType: ORIGIN_CHAIN`, `slippageTolerance: 100` (1%), `deadline` = now + 2 h.
`previewDeposit()` sends the same request with `dry:true` (no address is created).

The player sends from their own wallet to `quote.depositAddress`. The server uses the deposit address as the quote id
(1Click has no other key; see OPEN_ISSUES 2). Chains that need a memo are refused.

Status mapping (`IntentState` is what `game/cron.ts` understands):

| 1Click `status` | `IntentState` | Effect in the cron |
|---|---|---|
| `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `INCOMPLETE_DEPOSIT`, `PROCESSING` | `PENDING` | waits; after `deadline` + 1 h the cron marks the row `EXPIRED` |
| `SUCCESS` | `SUCCESS` with `receivedFils` = `swapDetails.amountOut / 100`, the echoed `recipient` and `originAsset` | cron checks recipient = treasury and asset, credits `min(received, expected)` once |
| `REFUNDED` | `REFUNDED` | row `FAILED`, no credit (1Click returned the funds to `refundTo`) |
| `FAILED` | `FAILED` | row `FAILED`, alert, manual review |
| unknown address (HTTP 404) | `PENDING` | handled by the deadline rule |
| any other string | error (zod) | cron logs and retries; never credits |

`SUCCESS` for a quote that does not settle in our USDC to a chain address is reported as `FAILED` with an alert.
Conversion: 1 USDC = 1,000,000 micro = 10,000 fils, `fils = micro / 100`, truncating.

### Withdrawal (USDC from the treasury to any supported asset and address)

1. Checks: positive amount, destination asset is in the token list, `ftBalance(treasury) >= amount`.
2. `POST /v0/quote`: `originAsset` = USDC on NEAR, `depositType: ORIGIN_CHAIN`, `destinationAsset` = the player's
   choice, `recipient` = their address (`DESTINATION_CHAIN`), `refundTo` = the treasury account.
3. The echoed request, `amountIn`, deadline, and the deposit address (must look like a NEAR account) are verified.
4. `ft_transfer` of exactly `amountIn` USDC (1 yoctoNEAR attached) to the deposit address; then an optional
   `POST /v0/deposit/submit` (best effort).
5. Result to the cron: `{ ok:true, quoteId: depositAddress, txHash }`.

Failure handling: anything that fails **before** the transfer, or a transfer whose receipt failed, returns
`{ ok:false }` (the cron refunds the player on chain). A transfer whose outcome is unknown (network error, timeout)
**throws**; the cron leaves the row in `SENDING` for a human and never retries. See OPEN_ISSUES 7 for the missing
follow-up of `SENT` withdrawals.

## Safety properties (each has a test in `src/server/__tests__/oneclick*.test.ts`)

* Fails closed: `createIntentsClient()` returns the `unconfigured` client (`configured = false`, money routes answer
  `PAUSED`) unless `GAME_MODE=LIVE`, `NEAR_NETWORK=mainnet` and `ONECLICK_JWT`, `TREASURY_ACCOUNT_ID`,
  `TREASURY_PRIVATE_KEY`, `NEAR_RPC_URL`, `ONECLICK_USDC_ASSET_ID` are all present and well formed. It logs only
  variable names.
* The credential lives in a `#private` field of the HTTP layer, is never in a URL or an error, is scrubbed from provider
  messages and logs, and does not appear in `JSON.stringify`/`util.inspect` of the client. Redirects are refused.
* Every answer is parsed with zod (closed status enum, digit-only amounts); the echoed request must equal what was
  sent (assets exact, addresses case-insensitive, amounts exact). Memos, missing deadlines or deadlines under 5 minutes
  away are refused.
* The USDC asset is checked against the live token list (symbol, chain, 6 decimals, contract).
* Timeouts (10 s); retries only for GET (network, timeout, 429, 5xx; at most 2); POST is never retried.
* Addresses are never logged in full (`0x12...abcd`); only a prefix of the `correlationId` is.

## Environment variables (names only)

| Name | Where | Meaning |
|---|---|---|
| `ONECLICK_JWT` | `env.ts` | partner JWT from the 1Click partner dashboard |
| `TREASURY_ACCOUNT_ID`, `TREASURY_PRIVATE_KEY` | `env.ts` | the hot wallet that receives deposits and pays withdrawals |
| `NEAR_RPC_URL` | `env.ts` | mainnet RPC |
| `ONECLICK_USDC_ASSET_ID` | read by `intents/create.ts` | `assetId` of USDC on NEAR from `GET /v0/tokens` (not in `.env.example` yet, see OPEN_ISSUES 3) |

## What Mahdi must do for a real LIVE test

All of these are his actions; nothing here has been done.

1. **Get the JWT.** Request an API key in the partner dashboard (<https://partners.near-intents.org/home>, per the
   [authentication page](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md)).
   The fee wording differs between sources: see "Fees and authentication (read on 2026-11-05)" above, which shows both readings
   (docs: an additional 0.25% without a key, 0.20% or 0.01% for stablecoin routes with one; hackathon file Q-006: 0.2% without
   the JWT, JWT not required) and which applies with a JWT (the docs). Either way the amount is small. Put the JWT in the
   host's secret store as `ONECLICK_JWT`; never paste it in chat.
2. **Treasury account.** Create a separate mainnet NEAR account for the treasury (not the prize account, not the
   relayer). Register it with the USDC contract (`storage_deposit`) so it can receive USDC, and give it a few cents of
   NEAR for gas. Fund it with a **few USDC** only (it is a hot wallet; its balance is also what withdrawals can pay).
3. **USDC asset id.** Open `https://1click.chaindefuser.com/v0/tokens` in a browser, find the entry with
   `"blockchain":"near"` and `"symbol":"USDC"` (6 decimals) and put its `assetId` into `ONECLICK_USDC_ASSET_ID`.
   The server refuses to start the money path if the list does not confirm it.
4. **Deploy** the contract on mainnet and set `GAME_MODE=LIVE`, `NEAR_NETWORK=mainnet`, `NEAR_RPC_URL`,
   `CARAVAN_CONTRACT_ID`, operator and relayer keys (see `docs/SERVER.md`). Check `/api/cron/health` is `ok`.
5. **Tiny deposit test.** Sign in, request a quote for about 1 USDC-equivalent from a wallet you control, send exactly
   the quoted amount to the deposit address before the deadline, and watch the status. Confirm the dinars are credited
   exactly once, then run the deposits cron twice more and see no second credit. Record the explorer links
   (<https://explorer.near-intents.org>, search by deposit address).
6. **Tiny withdrawal test.** Withdraw about 0.5-1 USDC worth to an address you control on another chain. Confirm the
   treasury transfer, the destination receipt, and the row ending `SENT`. If the transfer fails because the deposit
   address is not registered with USDC, stop and report it (OPEN_ISSUES 4); the player is refunded automatically.
7. **Keep the kill switch ready:** set `PAUSE_ALL=true` in the flags table if anything looks wrong.
8. Read the API terms of use and the risk/compliance page before going public (OPEN_ISSUES 13).
