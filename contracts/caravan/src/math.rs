//! World constants (spec/GAME.md 2.2-2.4, spec/ECONOMY.md 2.5) and integer price math (2.6).
//!
//! Every division truncates toward zero (Rust `checked_div` on i128/u128), exactly like
//! `packages/shared/src/quote.ts` (BigInt). Every operation is checked; overflow is `INTERNAL`.

use crate::errors::{CResult, ErrorCode, fail, ovf};
use crate::types::{CityId, GoodId, Side};

// ---------- parameters (spec/ECONOMY.md 2.5, packages/shared/src/world.ts PARAMS) ----------

pub const BP: i128 = 10_000;
pub const BP_U: u128 = 10_000;
pub const TICK_SECONDS: u64 = 60;
pub const TICK_MIN_INTERVAL_SECONDS: u64 = 55;
pub const MAX_MISSED_TICKS: u64 = 10;
pub const MULT_K_BP: i128 = 4000;
pub const MULT_MIN_BP: i128 = 7500;
pub const MULT_MAX_BP: i128 = 13_500;
pub const STOCK_CAP_FACTOR: u32 = 2;
pub const SPREAD_DEFAULT_BP: u32 = 800;
pub const SPREAD_MIN_BP: u32 = 400;
pub const SPREAD_MAX_BP: u32 = 2000;
pub const BIAS_MIN_BP: i32 = -1500;
pub const BIAS_MAX_BP: i32 = 1500;
pub const TRADE_FEE_BP: u128 = 100;
pub const MAX_QTY_PER_TRADE: u32 = 40;
pub const CARGO_CAP: u32 = 40;
pub const GUARD_COST_BP: u128 = 200;
pub const GUARD_RISK_FACTOR_BP: u128 = 6500;
pub const MAX_GUARDS: u8 = 3;
pub const AMBUSH_LOSS_BP: u32 = 3000;
pub const MERCHANT_TREASURY_FILS: u128 = 50_000;
pub const FAUCET_FILS: u128 = 50_000;
pub const MAX_DEPOSIT_FILS: u128 = 200_000;
pub const DAILY_WITHDRAW_CAP_FILS: u128 = 100_000;
pub const STALL_FEE_BP: u128 = 200;
pub const NPC_SHIP_UNITS_PER_TICK: u32 = 4;
pub const NPC_MIN_RATIO_GAP_BP: u128 = 5000;
pub const REBALANCE_EXCESS_FROM_BP: u128 = 15_000;
pub const REBALANCE_PCT: u128 = 30;
pub const HOUSE_RECYCLE_PCT: u128 = 10;

// Contract-only parameters (master plan 5.3; see DECISIONS.md).
/// Faucet: only when the player holds less than 50 dinars (plan 5.3 "only if fils < 5000").
pub const FAUCET_MAX_BALANCE_FILS: u128 = 5000;
/// Faucet cooldown (plan 5.3 "1 hour cooldown").
pub const FAUCET_COOLDOWN_SECONDS: u64 = 3600;
/// `set_policy` at most once per 60 s (plan 5.3).
pub const POLICY_MIN_INTERVAL_SECONDS: u64 = 60;
/// Storage guard: open stalls per player.
pub const MAX_STALLS_PER_PLAYER: u32 = 5;
/// Sanity bound for stall prices (10,000,000 dinars).
pub const MAX_STALL_UNIT_PRICE: u128 = 1_000_000_000;
/// `set_policy`: largest change of spread_bp and of bias_bp per call (audit finding 4).
pub const POLICY_MAX_STEP_BP: u32 = 300;
/// `ship` by a merchant: the destination pays at most this % of its treasury per tick (finding 6).
pub const SHIP_MAX_PAY_PCT: u128 = 25;
/// Smallest withdrawal (finding 1): 10 dinars.
pub const MIN_WITHDRAW_FILS: u128 = 1000;
/// `get_withdrawals` page size cap (the server reconciles a window of 200 ids).
pub const MAX_WITHDRAW_PAGE: u64 = 200;
pub const MAX_REFERENCE_LEN: usize = 128;
pub const MAX_ASSET_LEN: usize = 128;
pub const MAX_ADDRESS_LEN: usize = 256;
pub const MAX_PAGE: u32 = 100;
pub const NS_PER_SEC: u64 = 1_000_000_000;
pub const SECONDS_PER_DAY: u64 = 86_400;

// ---------- world tables ----------

pub struct GoodSpec {
    pub base: u128,
    pub target: u32,
}

/// spec/GAME.md 2.2, indexed by `GoodId::idx()`.
pub const GOODS: [GoodSpec; 5] = [
    GoodSpec { base: 1000, target: 200 },
    GoodSpec { base: 1500, target: 120 },
    GoodSpec { base: 4000, target: 100 },
    GoodSpec { base: 12_000, target: 40 },
    GoodSpec { base: 20_000, target: 30 },
];

pub const fn good(g: GoodId) -> &'static GoodSpec {
    &GOODS[g.idx()]
}

/// Stock cap = 2 x target. Targets are small constants, so this cannot overflow.
pub fn cap(g: GoodId) -> u32 {
    good(g).target.saturating_mul(STOCK_CAP_FACTOR)
}

/// spec/GAME.md 2.3: production per tick, `[city][good]`.
pub const PRODUCTION: [[u32; 5]; 4] = [
    [8, 3, 0, 0, 0], // dasht: grain 8, salt 3
    [0, 2, 4, 0, 0], // madan: iron 4, salt 2
    [0, 0, 0, 4, 3], // bandar: spice 4, silk 3
    [0, 0, 1, 0, 0], // shahr: iron 1
];

/// spec/GAME.md 2.3: consumption per tick, `[city][good]`.
pub const CONSUMPTION: [[u32; 5]; 4] = [
    [0, 0, 2, 1, 1], // dasht: iron 2, spice 1, silk 1
    [4, 0, 0, 1, 1], // madan: grain 4, spice 1, silk 1
    [3, 2, 3, 0, 0], // bandar: grain 3, iron 3, salt 2
    [1, 3, 0, 2, 1], // shahr: grain 1, salt 3, spice 2, silk 1
];

/// spec/GAME.md 2.4: (seconds, base risk bp). Every pair of distinct cities is a route.
pub fn route(a: CityId, b: CityId) -> Option<(u64, u32)> {
    use CityId::*;
    match (a, b) {
        (Bandar, Shahr) | (Shahr, Bandar) => Some((180, 800)),
        (Shahr, Dasht) | (Dasht, Shahr) => Some((240, 1200)),
        (Dasht, Madan) | (Madan, Dasht) => Some((300, 1500)),
        (Madan, Bandar) | (Bandar, Madan) => Some((360, 2000)),
        (Bandar, Dasht) | (Dasht, Bandar) => Some((270, 1000)),
        (Shahr, Madan) | (Madan, Shahr) => Some((330, 1800)),
        _ => None,
    }
}

// ---------- price math (spec/ECONOMY.md 2.6) ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub bid: u128,
    pub mid: u128,
    pub ask: u128,
}

/// mult_bp(stock, target) = clamp(10000 + 4000 * (target - stock) / target, 7500, 13500)
pub fn mult_bp(stock: i128, target: i128) -> CResult<i128> {
    let diff = ovf(target.checked_sub(stock))?;
    let scaled = ovf(MULT_K_BP.checked_mul(diff))?;
    let q = ovf(scaled.checked_div(target))?; // truncates toward zero
    let m = ovf(BP.checked_add(q))?;
    Ok(m.clamp(MULT_MIN_BP, MULT_MAX_BP))
}

fn to_u128(v: i128) -> CResult<u128> {
    u128::try_from(v).or_else(|_| fail(ErrorCode::Internal, "negative price"))
}

/// Same steps as `quoteBig()` in packages/shared/src/quote.ts.
pub fn quote(g: GoodId, stock: i128, spread_bp: u32, bias_bp: i32) -> CResult<Quote> {
    let spec = good(g);
    let base = ovf(i128::try_from(spec.base).ok())?;
    let target = i128::from(spec.target);
    let spread = i128::from(spread_bp);
    let bias = i128::from(bias_bp);
    let m = mult_bp(stock, target)?;
    let mid0 = ovf(ovf(base.checked_mul(m))?.checked_div(BP))?;
    let mid = ovf(ovf(mid0.checked_mul(ovf(BP.checked_add(bias))?))?.checked_div(BP))?;
    let half = ovf(spread.checked_div(2))?;
    let ask = ovf(ovf(mid.checked_mul(ovf(BP.checked_add(half))?))?.checked_div(BP))?;
    let bid = ovf(ovf(mid.checked_mul(ovf(BP.checked_sub(half))?))?.checked_div(BP))?;
    Ok(Quote { bid: to_u128(bid)?, mid: to_u128(mid)?, ask: to_u128(ask)? })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TradeCost {
    /// unit price at the trade's midpoint stock
    pub unit: u128,
    /// qty x unit, before the fee
    pub total: u128,
    /// total x 100 / 10000 (truncated)
    pub fee: u128,
}

/// Same as `tradeCost()` in packages/shared/src/quote.ts: buy at `ask(stock - qty/2)`,
/// sell at `bid(stock + qty/2)`, fee 1% of the total.
pub fn trade_cost(
    g: GoodId,
    side: Side,
    qty: u32,
    merchant_stock: u32,
    spread_bp: u32,
    bias_bp: i32,
) -> CResult<TradeCost> {
    if qty == 0 {
        return fail(ErrorCode::BadRequest, "qty must be positive");
    }
    let half = i128::from(ovf(qty.checked_div(2))?);
    let stock = i128::from(merchant_stock);
    let mid_stock = match side {
        Side::Buy => ovf(stock.checked_sub(half))?,
        Side::Sell => ovf(stock.checked_add(half))?,
    };
    let q = quote(g, mid_stock, spread_bp, bias_bp)?;
    let unit = match side {
        Side::Buy => q.ask,
        Side::Sell => q.bid,
    };
    let total = ovf(unit.checked_mul(u128::from(qty)))?;
    let fee = ovf(ovf(total.checked_mul(TRADE_FEE_BP))?.checked_div(BP_U))?;
    Ok(TradeCost { unit, total, fee })
}

/// risk = base_risk_bp x 6500^g / 10000^g (spec/GAME.md 2.4), single truncating division.
pub fn journey_risk_bp(base_risk_bp: u32, guards: u8) -> CResult<u32> {
    let g = u32::from(guards);
    let num = ovf(u128::from(base_risk_bp).checked_mul(ovf(GUARD_RISK_FACTOR_BP.checked_pow(g))?))?;
    let den = ovf(BP_U.checked_pow(g))?;
    let r = ovf(num.checked_div(den))?;
    ovf(u32::try_from(r).ok())
}

/// Guard cost = cargo base value x 200 bp x guards / 10000 (same as the mock api-client).
pub fn guard_cost(cargo_base_value: u128, guards: u8) -> CResult<u128> {
    let per = ovf(cargo_base_value.checked_mul(GUARD_COST_BP))?;
    let all = ovf(per.checked_mul(u128::from(guards)))?;
    ovf(all.checked_div(BP_U))
}

/// Cargo base value: sum(qty x base).
pub fn base_value(goods: &[u32; 5]) -> CResult<u128> {
    let mut v: u128 = 0;
    for g in GoodId::ALL {
        let q = u128::from(goods[g.idx()]);
        v = ovf(v.checked_add(ovf(q.checked_mul(good(g).base))?))?;
    }
    Ok(v)
}

/// Units lost in an ambush: floor(30% x qty) (spec/GAME.md 2.4 text; DECISIONS.md D1).
pub fn ambush_loss(qty: u32) -> CResult<u32> {
    let l = ovf(u64::from(qty).checked_mul(u64::from(AMBUSH_LOSS_BP)))?;
    let l = ovf(l.checked_div(10_000))?;
    ovf(u32::try_from(l).ok())
}

/// Ambush roll in [0, 10000): first 8 bytes (little endian) of
/// sha256(seed || journey_id as u64 LE || account bytes), mod 10000.
/// A pure function of its inputs so it can be unit-tested (plan 5.3 "Randomness").
pub fn ambush_roll(seed: &[u8], journey_id: u64, account: &str) -> u32 {
    let mut buf: Vec<u8> = Vec::with_capacity(seed.len().saturating_add(8).saturating_add(account.len()));
    buf.extend_from_slice(seed);
    buf.extend_from_slice(&journey_id.to_le_bytes());
    buf.extend_from_slice(account.as_bytes());
    let h = near_sdk::env::sha256_array(&buf);
    let mut first = [0u8; 8];
    first.copy_from_slice(&h[..8]);
    let r = u64::from_le_bytes(first).checked_rem(10_000).unwrap_or(0);
    u32::try_from(r).unwrap_or(0)
}

/// House-caravan gap test in integers (DECISIONS.md D3, OPEN_QUESTIONS #12):
/// (stock_hi - stock_lo) x 10000 >= 5000 x target.
pub fn ship_gap_ok(g: GoodId, stock_hi: u32, stock_lo: u32) -> bool {
    if stock_hi <= stock_lo {
        return false;
    }
    let diff = u128::from(stock_hi.saturating_sub(stock_lo));
    let lhs = diff.saturating_mul(BP_U);
    let rhs = NPC_MIN_RATIO_GAP_BP.saturating_mul(u128::from(good(g).target));
    lhs >= rhs
}

/// Payment for a house caravan: (mid(hi) + mid(lo)) / 2 x qty, mids at default policy
/// (bias 0), exactly as the reference simulation.
pub fn ship_payment(g: GoodId, stock_from: u32, stock_to: u32, qty: u32) -> CResult<u128> {
    let a = quote(g, i128::from(stock_from), SPREAD_DEFAULT_BP, 0)?.mid;
    let b = quote(g, i128::from(stock_to), SPREAD_DEFAULT_BP, 0)?.mid;
    let mid = ovf(ovf(a.checked_add(b))?.checked_div(2))?;
    ovf(mid.checked_mul(u128::from(qty)))
}

/// `x * pct / 100`, checked.
pub fn pct(x: u128, pct: u128) -> CResult<u128> {
    ovf(ovf(x.checked_mul(pct))?.checked_div(100))
}

/// `x * bp / 10000`, checked.
pub fn bp_of(x: u128, bp: u128) -> CResult<u128> {
    ovf(ovf(x.checked_mul(bp))?.checked_div(BP_U))
}

/// `ceil(x * bp / 10000)`, checked.
pub fn bp_of_ceil(x: u128, bp: u128) -> CResult<u128> {
    let n = ovf(x.checked_mul(bp))?;
    ovf(ovf(n.checked_add(ovf(BP_U.checked_sub(1))?))?.checked_div(BP_U))
}
