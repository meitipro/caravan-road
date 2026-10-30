# UI rules (Phase 4)

Copied from the master plan, section 7.2. Follow them in every UI task.

1. Edit only `apps/web/src/app/play`, `src/components`, `src/ui`, `public/assets` (plus minimal Next.js config). Never `src/app/api`, `src/server`, `packages/shared`, `contracts`, `apps/worker`, `spec`.
2. Data comes only from the api-client and the types of `@caravan/shared` (`getApi()` in `src/ui/api.ts`). No direct `fetch` to `/api` in components. `NEXT_PUBLIC_MOCK=1` runs everything on the in-memory mock.
3. Money values are strings of fils. Format them with `formatDinar()` (2 decimals, `src/ui/format.ts`). Never use `Number` arithmetic on money: use `bigint`.
4. UI language is English. Merchant lines carry `en` and `fa` with an EN/FA toggle. Persian uses Vazirmatn and is RTL-aware (`dir="rtl"`).
5. Hide blockchain vocabulary: no "wallet", "gas", "sign", "hash" outside the Advanced drawer (`components/Advanced.tsx`) and the proof page (`components/ProofScreen.tsx`). `src/ui/vocabulary.test.ts` enforces this on user-facing text.
6. Visual identity: pixel-art desert caravan. Only the CSS variables of `src/ui/tokens.css` (palette from spec 2.15). Fonts: Pixelify Sans (headings), Inter (body, numbers and buttons for legibility), Vazirmatn (Persian), all SIL OFL 1.1, loaded with `next/font`. Images use `image-rendering: pixelated` at integer scales. 8 px grid, 4 px radius, hard shadows without blur. Contrast at least 4.5:1, keyboard accessible, a loading, an empty and an error state for every data view.
7. After each task run `pnpm --filter @caravan/web typecheck`, `lint`, `test`, `build`. Screenshots at 390 px and 1280 px go to `docs/screens/` (`node apps/web/src/ui/shoot/shoot.mjs` walks the whole mock loop and writes them).

## Contract with other parts

- Every request carries a fresh `Idempotency-Key` (the shared client does this).
- Errors show friendly text from `ERROR_TEXT` in `src/ui/game-meta.ts`, keyed by `ErrorCode`.
- The state is polled every 3 s (SWR in `components/GameProvider.tsx`) and refetched after each action. After a reload the state comes from the server.
- "Verified" is shown only when `attested` is true (`evidenceBadge()` in `components/Mind.tsx`).
- localStorage is wrapped in try/catch (`src/ui/storage.ts`) and every screen renders without it.

## Mock-only conveniences

- Fake login: a flag in localStorage (`caravan.mock.session`). No providers, no secrets.
- `/play/cash?live=1` previews the LIVE deposit and withdraw screens against canned data (`src/ui/cash-canned.ts`).
- The mock world lives in memory, so a page reload resets it (a journey in progress is lost in mock mode only).
