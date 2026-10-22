# API — قراردادهای داده و API سرور

> منبع: PDF پارت ۱، بخش‌های ۹ و ۱۰.

## ۹. قراردادهای داده (در `packages/shared/src/types.ts`)

همهٔ زمان‌های API به **ثانیهٔ یونیکس** هستند (قرارداد نانوثانیه دارد؛ سرور تبدیل می‌کند). مبلغ‌ها همیشه `string` هستند، نه `number` (جلوگیری از خطای دقت).

```ts
export type CityId = "dasht" | "madan" | "bandar" | "shahr";
export type GoodId = "grain" | "salt" | "iron" | "spice" | "silk";
export type Fils = string;                       // u128 as decimal string
export type Mode = "PLAY" | "LIVE";

export interface Quote { bid: Fils; mid: Fils; ask: Fils }
export interface Merchant {
  id: CityId; account_id: string; treasury: Fils;
  stock: Record<GoodId, number>;
  policy: { spread_bp: number; bias_bp: number };
  quotes: Record<GoodId, Quote>;
  mood: "calm" | "greedy" | "worried" | "generous";
  last_line: { en: string; fa: string } | null;
  verified: { model: string; request_id: string; attested: boolean; at: number } | null;
}
export interface Journey {
  id: number; from: CityId; to: CityId; cargo: Partial<Record<GoodId, number>>;
  guards: number; started_at: number; arrives_at: number; risk_bp: number;
  status: "IN_TRANSIT" | "ARRIVED" | "CLAIMED"; ambushed?: boolean;
  lost?: Partial<Record<GoodId, number>>;
}
export interface Player {
  account_id: string; display_name: string; fils: Fils; location: CityId;
  inventory: Record<GoodId, number>; journey: Journey | null; net_worth: Fils;
}
export interface Stall { id: number; seller: string; city: CityId; good: GoodId; qty: number; unit_price: Fils }
export interface WorldState { tick: number; now: number; mode: Mode; merchants: Merchant[]; stalls: Stall[] }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };
```

کدهای خطا (`ErrorCode`): `UNAUTHENTICATED`، `BAD_REQUEST`، `RATE_LIMIT`، `MODE_NOT_ALLOWED`، `NOT_IN_CITY`، `IN_TRANSIT`، `NOT_ARRIVED`، `INSUFFICIENT_FUNDS`، `INSUFFICIENT_STOCK`، `MERCHANT_BROKE`، `SLIPPAGE`، `CARGO_LIMIT`، `PAUSED`، `INTERNAL`. هر `panic` قرارداد باید به یکی از این‌ها نگاشت شود.

## ۱۰. API سرور (پارت ۳ می‌سازد، پارت ۵ استفاده می‌کند)

همهٔ پاسخ‌ها `ApiResult<T>` هستند. همهٔ POSTها هدر `Idempotency-Key` می‌پذیرند. UI هر ۲ ثانیه `/api/state` را می‌خواند (به‌جای SSE؛ ساده و سازگار با Vercel).

| متد | مسیر | بدنه | پاسخ |
|---|---|---|---|
| GET | `/api/state` | — | `{ world: WorldState, me: Player or null, events: Event[] }` |
| POST | `/api/trade` | `{ merchant: CityId, good, side: "buy" or "sell", qty, limit_total: Fils }` | `{ player, total, fee }` |
| POST | `/api/journey/start` | `{ to: CityId, cargo, guards }` | `{ journey }` |
| POST | `/api/journey/claim` | — | `{ journey, player }` |
| POST | `/api/stall/create` | `{ good, qty, unit_price }` | `{ stall }` |
| POST | `/api/stall/buy` | `{ stall_id, qty, limit_total }` | `{ player }` |
| POST | `/api/stall/cancel` | `{ stall_id }` | `{ player }` |
| POST | `/api/faucet` | — (فقط PLAY) | `{ player }` |
| POST | `/api/deposit/quote` | `{ origin_asset, amount_in, refund_address }` | `{ quote_id, deposit_address, amount_in, expected_fils, deadline }` |
| GET | `/api/deposit/status` | `?quote_id=` | `{ status, fils_credited? }` |
| POST | `/api/withdraw` | `{ fils, dest_asset, dest_address }` | `{ request_id, status }` |
| GET | `/api/leaderboard` | — | `{ rows: {name, net_worth}[] }` |
| GET | `/api/npc/decisions` | `?merchant=` | `{ rows: Decision[] }` |
| GET | `/api/proof/{merchant}` | — | آخرین شواهد تأیید استنتاج |

> `Event` و `Decision` در PDF تعریف نشده‌اند؛ `OPEN_QUESTIONS.md` شمارهٔ ۱.
