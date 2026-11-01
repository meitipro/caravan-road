# Issues found against the shared package and the spec

Not fixed here (not owned by the UI). Please decide in the owning phase.

1. **No asset list endpoint.** Deposit and withdraw take `origin_asset` / `dest_asset` strings but the API has no way to list supported assets, their decimals or address kinds. The UI uses a static provisional list in `src/ui/cash-assets.ts`.
2. **Deposit / withdraw status vocabulary is undefined.** `status` is a free string. The UI maps several likely words (`PENDING_DEPOSIT`, `PROCESSING`, `SUCCESS`, `EXPIRED`, `REFUNDED`, `FAILED`) in `mapCashStatus()`.
3. **Mock faucet cooldown is 60 s and the real one is unknown** (OPEN_QUESTIONS #4). The UI starts a local 60 s wait after a claim and otherwise relies on `RATE_LIMIT`.
4. **A merchant treasury (500 dinars at the start) limits what a player can sell.** One caravan of spice or silk can easily exceed it, so a sale shows `MERCHANT_BROKE`. The UI caps the quantity to what the merchant can pay and says so, but the economy tuning phase should check that early sales are not frustrating.
5. **Mock state is in memory.** A reload during a journey loses it in mock mode (the shared mock has no persistence). The real server keeps it.
6. **Tick length in the mock is 5 s, the spec says 60 s.** The UI only shows the tick number, never a countdown.
7. **Merchant to portrait mapping is not specified.** `src/ui/game-meta.ts` assumes dasht=golnar, madan=rostam, bandar=nahid, shahr=sohrab.
8. **Login button target.** In real mode the buttons navigate to `/api/auth/signin?provider=...`; the server phase should confirm the Auth.js route or replace `startLogin()` in `src/ui/session.ts`.
9. **Dev login (done).** With `NEXT_PUBLIC_MOCK=0` the login screen probes `GET /api/dev/login` once (404 means off). When it answers 400 the OAuth buttons are replaced by a name box and Play (`POST /api/dev/login`), and Log out calls `/api/dev/logout`. Helpers in `src/ui/session.ts`; walkthrough script `src/ui/shoot/live.mjs` writes `docs/screens/live-*.png`.
