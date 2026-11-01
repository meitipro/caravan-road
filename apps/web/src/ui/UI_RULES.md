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

## Dev server notes

- **Never run `next build` (or a second `next dev`) while `next dev` is running in the same app folder.** Both write
  to `apps/web/.next`. The build deletes chunks the running dev server still points at, and the next uncached page
  fails with `Cannot find module './vendor-chunks/zod@3.25.76.js'` (or `./223.js`), a 404/500, or an endless
  "Loading the caravan". Reproduced on 2026-11-01: dev running, `next build`, then `/play/city/madan` returned 500.
  A `.next` left over from an earlier build is fine for `dev` on its own; the problem is the overlap.
- Fix: stop the dev server, delete the folder, start again:
  `Remove-Item -Recurse -Force apps\web\.next` (PowerShell) or `rm -rf apps/web/.next` (Git Bash), then
  `NEXT_PUBLIC_MOCK=1 pnpm --filter @caravan/web dev`. Run build and dev one after the other, never together.
- The first visit to each page in `next dev` compiles it (several seconds). `src/app/play/loading.tsx` shows a skeleton
  for client-side navigations; the very first document request still waits for the compile, which a production build
  does not.
- Mock mode: the world is rebuilt by every page load, so `caravan.claimed` and the cost basis are dropped with it
  (`resetWorldBoundFlags()` in `src/ui/api.ts`). Login and onboarding flags are kept.
