//! Merchant methods (set_policy, ship), world_tick, operator/owner methods
//! (credit_deposit, mark_withdraw, refund_withdraw, set_paused, set_operator).

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{AccountId, env, near};

use crate::errors::{CResult, ErrorCode, OrPanic, fail, ovf};
use crate::events::emit;
use crate::math::*;
use crate::types::*;
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Merchant only: `400 <= spread_bp <= 2000`, `-1500 <= bias_bp <= 1500`; each may move at
    /// most 300 bp per call; at most once per 60 s and once per world tick.
    pub fn set_policy(&mut self, spread_bp: u32, bias_bp: i32) {
        self.try_set_policy(env::predecessor_account_id(), spread_bp, bias_bp).or_panic()
    }

    /// Merchant only: house caravan of `qty <= 4` units from the caller's city to `to`, paid by
    /// `to` at the midpoint of the two cities' mids; needs a stock/target gap of at least 50%,
    /// `to` below its target stock, and `to` pays at most 25% of its treasury per tick for
    /// incoming merchant shipments.
    pub fn ship(&mut self, to: CityId, good: GoodId, qty: u32) -> U128 {
        U128(self.try_ship(env::predecessor_account_id(), to, good, qty).or_panic())
    }

    /// Anyone: applies the ticks due since the last call (section 2.8). A call less than 55 s
    /// after the previous tick is a no-op (`ticks: 0`). At most 10 ticks per call.
    pub fn world_tick(&mut self) -> TickResult {
        self.try_world_tick().or_panic()
    }

    /// Operator only, LIVE only: credits a deposit once per `reference`. Returns
    /// `{credited: false}` (and changes nothing) for a reference that was already credited.
    pub fn credit_deposit(&mut self, account_id: AccountId, fils: U128, reference: String) -> CreditResult {
        let credited = self.try_credit_deposit(env::predecessor_account_id(), account_id, fils.0, reference).or_panic();
        CreditResult { credited }
    }

    /// Operator only: PENDING -> SENT, PENDING -> DONE or SENT -> DONE. `status` defaults to DONE.
    pub fn mark_withdraw(&mut self, id: u64, status: Option<WithdrawStatus>, reference: Option<String>) {
        let status = status.unwrap_or(WithdrawStatus::Done);
        self.try_mark_withdraw(env::predecessor_account_id(), id, status, reference).or_panic()
    }

    /// Operator only: PENDING/SENT -> REFUNDED, money back to the player. Works while paused.
    pub fn refund_withdraw(&mut self, id: u64) {
        self.try_refund_withdraw(env::predecessor_account_id(), id).or_panic()
    }

    /// Pause: owner or operator. Unpause: owner only.
    pub fn set_paused(&mut self, paused: bool) {
        self.try_set_paused(env::predecessor_account_id(), paused).or_panic()
    }

    /// Owner only: change the player cap (not below the current number of players).
    pub fn set_max_players(&mut self, max_players: u32) {
        self.try_set_max_players(env::predecessor_account_id(), max_players).or_panic()
    }

    /// Owner only: rotate the operator account (e.g. after a key leak).
    pub fn set_operator(&mut self, operator: AccountId) {
        self.try_set_operator(env::predecessor_account_id(), operator).or_panic()
    }
}

impl Contract {
    pub(crate) fn try_set_policy(&mut self, who: AccountId, spread_bp: u32, bias_bp: i32) -> CResult<()> {
        self.require_not_paused()?;
        let i = self.merchant_index(&who)?;
        if !(SPREAD_MIN_BP..=SPREAD_MAX_BP).contains(&spread_bp) {
            return fail(ErrorCode::BadRequest, "spread_bp out of range");
        }
        if !(BIAS_MIN_BP..=BIAS_MAX_BP).contains(&bias_bp) {
            return fail(ErrorCode::BadRequest, "bias_bp out of range");
        }
        let m = &self.merchants[i];
        if spread_bp.abs_diff(m.spread_bp) > POLICY_MAX_STEP_BP || bias_bp.abs_diff(m.bias_bp) > POLICY_MAX_STEP_BP {
            return fail(ErrorCode::BadRequest, "policy can move at most 300 bp per change");
        }
        let now = Self::now_ns();
        if let Some(last) = m.last_policy_ns {
            let next = ovf(last.checked_add(ovf(POLICY_MIN_INTERVAL_SECONDS.checked_mul(NS_PER_SEC))?))?;
            if now < next {
                return fail(ErrorCode::RateLimit, "policy can change once per minute");
            }
        }
        if m.last_policy_tick == Some(self.tick_count) {
            return fail(ErrorCode::RateLimit, "policy can change once per tick");
        }
        let tick = self.tick_count;
        let m = &mut self.merchants[i];
        m.spread_bp = spread_bp;
        m.bias_bp = bias_bp;
        m.last_policy_ns = Some(now);
        m.last_policy_tick = Some(tick);
        emit(
            "policy",
            json!({ "merchant": CityId::ALL[i], "account": who, "spread_bp": spread_bp, "bias_bp": bias_bp }),
        );
        Ok(())
    }

    pub(crate) fn try_ship(&mut self, who: AccountId, to: CityId, g: GoodId, qty: u32) -> CResult<u128> {
        self.require_not_paused()?;
        let from_i = self.merchant_index(&who)?;
        let from = CityId::ALL[from_i];
        if from == to {
            return fail(ErrorCode::BadRequest, "cannot ship to yourself");
        }
        if qty == 0 || qty > NPC_SHIP_UNITS_PER_TICK {
            return fail(ErrorCode::BadRequest, "qty must be 1..4");
        }
        if self.merchants[from_i].last_ship_tick[g.idx()] == Some(self.tick_count) {
            return fail(ErrorCode::RateLimit, "one shipment per good per tick");
        }
        let dest = &self.merchants[to.idx()];
        if dest.stock[g.idx()] >= good(g).target {
            return fail(ErrorCode::BadRequest, "destination is not short of this good");
        }
        // Per-tick payment cap for the destination: 25% of its treasury at the start of the tick.
        let paid = if dest.ship_in_tick == Some(self.tick_count) { dest.ship_in_paid } else { 0 };
        let pay_preview = ship_payment(g, self.merchants[from_i].stock[g.idx()], dest.stock[g.idx()], qty)?;
        let budget = pct(ovf(dest.treasury.checked_add(paid))?, SHIP_MAX_PAY_PCT)?;
        if ovf(paid.checked_add(pay_preview))? > budget {
            return fail(ErrorCode::RateLimit, "destination reached its shipment budget for this tick");
        }
        let pay = self.apply_shipment(from, to, g, qty)?;
        let tick = self.tick_count;
        self.merchants[from_i].last_ship_tick[g.idx()] = Some(tick);
        let d = &mut self.merchants[to.idx()];
        d.ship_in_tick = Some(tick);
        d.ship_in_paid = ovf(paid.checked_add(pay))?;
        emit(
            "ship",
            json!({ "merchant": from, "to": to, "good": g, "qty": qty, "total": pay.to_string(), "auto": false }),
        );
        Ok(pay)
    }

    /// Validates and moves `qty` units of `g` from `from` to `to`, paid by `to`.
    /// Mutates nothing unless every check passes.
    pub(crate) fn apply_shipment(&mut self, from: CityId, to: CityId, g: GoodId, qty: u32) -> CResult<u128> {
        let gi = g.idx();
        let s_from = self.merchants[from.idx()].stock[gi];
        let s_to = self.merchants[to.idx()].stock[gi];
        if !ship_gap_ok(g, s_from, s_to) {
            return fail(ErrorCode::BadRequest, "stock gap below 50%");
        }
        if s_from < qty {
            return fail(ErrorCode::InsufficientStock, "not enough stock to ship");
        }
        let new_to = ovf(s_to.checked_add(qty))?;
        if new_to > cap(g) {
            return fail(ErrorCode::BadRequest, "warehouse full");
        }
        let pay = ship_payment(g, s_from, s_to, qty)?;
        let t_to = self.merchants[to.idx()].treasury;
        if t_to < pay {
            return fail(ErrorCode::MerchantBroke, "destination treasury cannot pay");
        }
        let new_from = ovf(s_from.checked_sub(qty))?;
        let t_from = ovf(self.merchants[from.idx()].treasury.checked_add(pay))?;
        let t_to = ovf(t_to.checked_sub(pay))?;
        self.merchants[from.idx()].stock[gi] = new_from;
        self.merchants[from.idx()].treasury = t_from;
        self.merchants[to.idx()].stock[gi] = new_to;
        self.merchants[to.idx()].treasury = t_to;
        Ok(pay)
    }

    /// Runs `n = clamp(elapsed / 60 s, 1, 10)` ticks when at least 55 s passed. The schedule
    /// advances by exactly `n x 60 s` (no time lost or added, audit finding 10); if more than 10
    /// ticks were due, the excess is dropped and the schedule keeps its phase.
    pub(crate) fn try_world_tick(&mut self) -> CResult<TickResult> {
        self.require_not_paused()?;
        let now = Self::now_ns();
        let elapsed = now.saturating_sub(self.last_tick_ns);
        if elapsed < ovf(TICK_MIN_INTERVAL_SECONDS.checked_mul(NS_PER_SEC))? {
            return Ok(TickResult { ticks: 0, tick: self.tick_count });
        }
        let tick_ns = ovf(TICK_SECONDS.checked_mul(NS_PER_SEC))?;
        let due = ovf(elapsed.checked_div(tick_ns))?;
        let n = due.clamp(1, MAX_MISSED_TICKS);
        let next_last = if due > MAX_MISSED_TICKS {
            ovf(now.checked_sub(ovf(elapsed.checked_rem(tick_ns))?))?
        } else {
            ovf(self.last_tick_ns.checked_add(ovf(n.checked_mul(tick_ns))?))?
        };
        for _ in 0..n {
            self.tick_once()?;
        }
        self.last_tick_ns = next_last;
        emit("tick", json!({ "tick": self.tick_count, "ticks": n, "house": self.house.to_string() }));
        Ok(TickResult { ticks: n, tick: self.tick_count })
    }

    /// Index of the merchant with the smallest treasury (first in city order on ties).
    pub(crate) fn poorest(&self) -> usize {
        let mut p = 0usize;
        for (i, m) in self.merchants.iter().enumerate() {
            if m.treasury < self.merchants[p].treasury {
                p = i;
            }
        }
        p
    }

    /// One tick in the order of section 2.8 (DECISIONS.md D2): production/consumption,
    /// treasury rebalancing, house recycling, then (only with `auto_ship`) house caravans.
    pub(crate) fn tick_once(&mut self) -> CResult<()> {
        // 1. production, then consumption, clamped to [0, 2 x target]
        for c in CityId::ALL {
            for g in GoodId::ALL {
                let s = self.merchants[c.idx()].stock[g.idx()];
                let s = s.saturating_add(PRODUCTION[c.idx()][g.idx()]).min(cap(g));
                let s = s.saturating_sub(CONSUMPTION[c.idx()][g.idx()]);
                self.merchants[c.idx()].stock[g.idx()] = s;
            }
        }
        // 2. rebalancing: merchants above 150% of the initial treasury give 30% of the excess
        let poorest = self.poorest();
        let threshold = bp_of(MERCHANT_TREASURY_FILS, REBALANCE_EXCESS_FROM_BP)?;
        for i in 0..self.merchants.len() {
            if i == poorest || self.merchants[i].treasury <= threshold {
                continue;
            }
            let excess = ovf(self.merchants[i].treasury.checked_sub(threshold))?;
            let x = pct(excess, REBALANCE_PCT)?;
            let t_poor = ovf(self.merchants[poorest].treasury.checked_add(x))?;
            self.merchants[i].treasury = ovf(self.merchants[i].treasury.checked_sub(x))?;
            self.merchants[poorest].treasury = t_poor;
        }
        // 3. house recycling: 10% of the house balance to the poorest merchant
        let pay = pct(self.house, HOUSE_RECYCLE_PCT)?;
        let t_poor = ovf(self.merchants[poorest].treasury.checked_add(pay))?;
        self.house = ovf(self.house.checked_sub(pay))?;
        self.merchants[poorest].treasury = t_poor;
        // 4. house caravans (merchant-driven via `ship`; automatic only when enabled)
        if self.auto_ship {
            for g in GoodId::ALL {
                let gi = g.idx();
                let mut hi = 0usize;
                let mut lo = 0usize;
                for (i, m) in self.merchants.iter().enumerate() {
                    if m.stock[gi] > self.merchants[hi].stock[gi] {
                        hi = i;
                    }
                    if m.stock[gi] < self.merchants[lo].stock[gi] {
                        lo = i;
                    }
                }
                let n = NPC_SHIP_UNITS_PER_TICK.min(self.merchants[hi].stock[gi]);
                if n == 0 || hi == lo {
                    continue;
                }
                // Skipped (not an error) when the gap is too small or the destination cannot pay.
                if let Ok(pay) = self.apply_shipment(CityId::ALL[hi], CityId::ALL[lo], g, n) {
                    emit(
                        "ship",
                        json!({ "merchant": CityId::ALL[hi], "to": CityId::ALL[lo], "good": g, "qty": n, "total": pay.to_string(), "auto": true }),
                    );
                }
            }
        }
        self.tick_count = ovf(self.tick_count.checked_add(1))?;
        Ok(())
    }

    pub(crate) fn try_credit_deposit(
        &mut self,
        who: AccountId,
        account_id: AccountId,
        fils: u128,
        reference: String,
    ) -> CResult<bool> {
        let player = account_id;
        self.require_not_paused()?;
        self.require_operator(&who)?;
        if self.mode != Mode::Live {
            return fail(ErrorCode::ModeNotAllowed, "deposits are only available in LIVE mode");
        }
        if reference.is_empty() || reference.len() > MAX_REFERENCE_LEN {
            return fail(ErrorCode::BadRequest, "bad reference");
        }
        if self.credited_refs.contains(&reference) {
            return Ok(false);
        }
        if fils == 0 {
            return fail(ErrorCode::BadRequest, "fils must be positive");
        }
        let mut p = self.load_player(&player)?;
        let new_total = ovf(p.total_deposited.checked_add(fils))?;
        if new_total > MAX_DEPOSIT_FILS {
            return fail(ErrorCode::RateLimit, "player deposit cap reached");
        }
        let day = ovf(ovf(Self::now_ns().checked_div(NS_PER_SEC))?.checked_div(SECONDS_PER_DAY))?;
        let today = if self.operator_day == day { self.operator_credited_today } else { 0 };
        let op_after = ovf(today.checked_add(fils))?;
        if op_after > self.operator_daily_cap {
            return fail(ErrorCode::RateLimit, "operator daily cap reached");
        }
        let total_dep = ovf(self.total_deposited.checked_add(fils))?;
        p.fils = ovf(p.fils.checked_add(fils))?;
        p.total_deposited = new_total;
        self.players.insert(player.clone(), p);
        self.total_deposited = total_dep;
        self.operator_day = day;
        self.operator_credited_today = op_after;
        self.credited_refs.insert(reference.clone());
        emit("deposit", json!({ "account": player, "fils": fils.to_string(), "reference": reference }));
        Ok(true)
    }

    pub(crate) fn try_mark_withdraw(
        &mut self,
        who: AccountId,
        id: u64,
        status: WithdrawStatus,
        reference: Option<String>,
    ) -> CResult<()> {
        self.require_not_paused()?;
        self.require_operator(&who)?;
        if reference.as_ref().is_some_and(|r| r.len() > MAX_REFERENCE_LEN) {
            return fail(ErrorCode::BadRequest, "bad reference");
        }
        let Some(mut w) = self.withdrawals.get(&id).cloned() else {
            return fail(ErrorCode::BadRequest, "no such withdrawal");
        };
        match (w.status, status) {
            (WithdrawStatus::Pending, WithdrawStatus::Sent) => {}
            (WithdrawStatus::Pending | WithdrawStatus::Sent, WithdrawStatus::Done) => {
                let pending = ovf(self.pending_withdrawals.checked_sub(w.fils))?;
                let done = ovf(self.total_withdrawn.checked_add(w.fils))?;
                let mut p = self.load_player(&w.account)?;
                if p.open_withdraw == Some(id) {
                    p.open_withdraw = None;
                }
                self.players.insert(w.account.clone(), p);
                self.pending_withdrawals = pending;
                self.total_withdrawn = done;
                Self::compact(&mut w);
            }
            _ => return fail(ErrorCode::BadRequest, "invalid status transition"),
        }
        w.status = status;
        w.updated_ns = Self::now_ns();
        if reference.is_some() {
            w.reference = reference;
        }
        self.withdrawals.insert(id, w.clone());
        emit(
            "withdraw_marked",
            json!({ "account": w.account, "id": id, "status": status, "fils": w.fils.to_string(), "reference": w.reference }),
        );
        Ok(())
    }

    /// Not blocked by `paused` (spec: refunds must always be possible).
    pub(crate) fn try_refund_withdraw(&mut self, who: AccountId, id: u64) -> CResult<()> {
        self.require_operator(&who)?;
        let Some(mut w) = self.withdrawals.get(&id).cloned() else {
            return fail(ErrorCode::BadRequest, "no such withdrawal");
        };
        if !matches!(w.status, WithdrawStatus::Pending | WithdrawStatus::Sent) {
            return fail(ErrorCode::BadRequest, "withdrawal cannot be refunded");
        }
        let mut p = self.load_player(&w.account)?;
        let pending = ovf(self.pending_withdrawals.checked_sub(w.fils))?;
        p.fils = ovf(p.fils.checked_add(w.fils))?;
        if p.open_withdraw == Some(id) {
            p.open_withdraw = None;
        }
        self.players.insert(w.account.clone(), p);
        self.pending_withdrawals = pending;
        Self::compact(&mut w);
        w.status = WithdrawStatus::Refunded;
        w.updated_ns = Self::now_ns();
        self.withdrawals.insert(id, w.clone());
        emit(
            "withdraw_marked",
            json!({ "account": w.account, "id": id, "status": w.status, "fils": w.fils.to_string() }),
        );
        Ok(())
    }

    /// A finished (DONE or REFUNDED) withdrawal keeps id, account, fils, status, times and the
    /// reference; the destination strings are cleared to free storage (audit finding 1).
    fn compact(w: &mut Withdrawal) {
        w.dest_asset = String::new();
        w.dest_address = String::new();
    }

    pub(crate) fn try_set_paused(&mut self, who: AccountId, paused: bool) -> CResult<()> {
        if paused {
            if who != self.owner && who != self.operator {
                return fail(ErrorCode::Unauthenticated, "owner or operator only");
            }
        } else if who != self.owner {
            return fail(ErrorCode::Unauthenticated, "only the owner can unpause");
        }
        self.paused = paused;
        emit("paused", json!({ "account": who, "paused": paused }));
        Ok(())
    }

    pub(crate) fn try_set_max_players(&mut self, who: AccountId, max_players: u32) -> CResult<()> {
        self.require_owner(&who)?;
        if max_players == 0 || max_players < self.players.len() {
            return fail(ErrorCode::BadRequest, "max_players below the current number of players");
        }
        self.max_players = max_players;
        Ok(())
    }

    pub(crate) fn try_set_operator(&mut self, who: AccountId, operator: AccountId) -> CResult<()> {
        self.require_owner(&who)?;
        if self.merchants.iter().any(|m| m.account == operator) || self.players.contains_key(&operator) {
            return fail(ErrorCode::BadRequest, "operator must not be a merchant or player");
        }
        self.operator = operator.clone();
        emit("operator", json!({ "operator": operator }));
        Ok(())
    }
}
