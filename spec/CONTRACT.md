# CONTRACT — رابط قرارداد هوشمند

> منبع: PDF پارت ۱، بخش ۱۱ (جزئیات در پارت ۲).

| متد | چه کسی صدا می‌زند | کار |
|---|---|---|
| `register()` | بازیکن (از طریق meta-tx) | ساخت پرونده در شهر `bandar` |
| `faucet()` | بازیکن، فقط PLAY | ۵۰۰ دینار، با فاصلهٔ زمانی |
| `trade(...)` | بازیکن | خرید و فروش با بازرگان |
| `claim_journey()` / `start_journey(...)` | بازیکن | سفر و دریافت محموله |
| `stall_create` / `stall_buy` / `stall_cancel` | بازیکن | غرفهٔ بازیکن |
| `request_withdraw(...)` | بازیکن | کم کردن موجودی و ثبت درخواست برداشت |
| `set_policy(spread_bp, bias_bp)` | حساب خود بازرگان (کلید function-call) | قیمت‌گذاری در محدودهٔ مجاز |
| `ship(to, good, qty)` | حساب خود بازرگان | جابه‌جایی کالا بین بازرگان‌ها |
| `grant_discount(...)` | حساب بازرگان (اختیاری) | تخفیف موقت بعد از چانه‌زنی |
| `world_tick()` | هر کسی | تیک جهان |
| `credit_deposit` / `mark_withdraw` / `refund_withdraw` / `set_paused` | operator (سرور) | واریز و برداشت و توقف |
| متدهای view | هر کسی | `get_world`، `get_player`، `get_merchant`، `get_stalls` و زیرمجموعهٔ `mt_*` برای NEP-245 |

رویدادها با قالب NEP-297: `trade`, `policy`, `journey_started`, `journey_claimed`, `stall_*`, `tick`, `ship`, `deposit`, `withdraw_requested`, `withdraw_marked`, `faucet`.
