# GAME

> Source: CARAVAN_ROAD_MASTER_PLAN.md, spec-v1, sections 1, 2.2-2.4 (verbatim) and 2.11.

## 1. GAME DESIGN

Game loop (what judges must understand in 30 seconds):

1. Sign in with Google or Discord; no wallet, no gas.
2. PLAY: claim 500 free dinars. LIVE: deposit any supported asset from any chain.
3. Buy a cheap good in a producing city.
4. Pick a route and 0–3 guards; travel 3–6 minutes.
5. Ambush chance; sell in a city where the good is scarce.
6. Prices move after every trade; merchants react (AI).
7. Leaderboard by net worth; LIVE withdrawals to any asset.

World: 4 cities (`dasht`, `madan`, `bandar`, `shahr`), 5 goods (`grain`, `salt`, `iron`, `spice`, `silk`), 4 merchants (one per city). Player stalls (optional) let players sell to each other in the same city for a 2% fee.

Design principles: the chain is invisible (words like wallet, gas, sign, hash only in an "Advanced" drawer and the AI-proof page); the first profitable trade takes under a minute; every screen has loading, empty and error states.

### 2.2 Goods

| id | base (fils) | base (dinar) | target stock | stock cap | mid-price range (fils) |
|---|---|---|---|---|---|
| `grain` | 1,000 | 10 | 200 | 400 | 750 – 1,300 |
| `salt` | 1,500 | 15 | 120 | 240 | 1,125 – 1,950 |
| `iron` | 4,000 | 40 | 100 | 200 | 3,000 – 5,200 |
| `spice` | 12,000 | 120 | 40 | 80 | 9,000 – 15,600 |
| `silk` | 20,000 | 200 | 30 | 60 | 15,000 – 26,000 |

Mid-price range at `MULT_K_BP = 3000` (spec-v1.2 PROPOSAL): base x 7,500 / 10,000 (stock at the cap) to base x 13,000 / 10,000 (stock 0). The lower bounds are unchanged from spec-v1.1; the upper bounds were base x 13,500 / 10,000 (grain 1,350, salt 2,025, iron 5,400, spice 16,200, silk 27,000) at K = 4000. The clamps (7,500 and 13,500) are unchanged, but at K = 3000 only the lower one can bind.

### 2.3 Cities (net production/consumption per tick; one tick = 60 s)

| id | role | production / tick | consumption / tick |
|---|---|---|---|
| `dasht` | farmland | grain 8, salt 3 | iron 2, spice 1, silk 1 |
| `madan` | mountain mine | iron 4, salt 2 | grain 4, spice 1, silk 1 |
| `bandar` | harbour | spice 4, silk 3 | grain 3, iron 3, salt 2 |
| `shahr` | capital | iron 1 | grain 1, salt 3, spice 2, silk 1 |

Each city produces two goods and consumes two or three so every route is profitable in both directions. Total production equals total consumption per good in the world. Stock is clamped to `[0, 2 × target]`.

### 2.4 Routes

| route | travel time | ambush risk (no guards) |
|---|---|---|
| `bandar` ↔ `shahr` | 180 s (3:00) | 8% (800 bp) |
| `shahr` ↔ `dasht` | 240 s (4:00) | 12% (1200 bp) |
| `dasht` ↔ `madan` | 300 s (5:00) | 15% (1500 bp) |
| `madan` ↔ `bandar` | 360 s (6:00) | 20% (2000 bp) |
| `bandar` ↔ `dasht` | 270 s (4:30) | 10% (1000 bp) |
| `shahr` ↔ `madan` | 330 s (5:30) | 18% (1800 bp) |

Guards: each costs 2% of the cargo's base value (paid to `house`) and multiplies ambush risk by 0.65 (`risk = base_risk_bp × 6500^g / 10000^g`, at most 3 guards). In an ambush, 30% of each cargo good is destroyed (floor).

### 2.11 Repository layout

```
caravan-road/
  package.json  pnpm-workspace.yaml  .gitignore  .env.example  PROGRESS.md  README.md
  spec/            GAME.md ECONOMY.md API.md CONTRACT.md NPC.md UI.md OPEN_QUESTIONS.md
  packages/shared/ types, zod schemas, world constants, quote(), tradeCost(), fixtures, api-client (with MOCK), sim.ts
  contracts/caravan/   Rust near-sdk contract
  apps/web/        Next.js (UI under src/app/play, src/components, src/ui; API under src/app/api, src/server)
  apps/worker/     NPC loop
  assets/ tools/art/   art pipeline sources
  docs/  scripts/
```
