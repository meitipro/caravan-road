//! Player methods: register, faucet, trade, journeys, stalls, request_withdraw.
//! The caller is always `env::predecessor_account_id()` (the player, via meta-transaction).

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{AccountId, env, near};

use crate::errors::{CResult, ErrorCode, OrPanic, fail, ovf};
use crate::events::emit;
use crate::math::*;
use crate::types::*;
use crate::{Contract, ContractExt, units};

#[near]
impl Contract {
    /// Creates the caller's profile in `bandar` with 0 fils. Idempotent.
    pub fn register(&mut self) -> PlayerView {
        self.try_register(env::predecessor_account_id()).or_panic()
    }

    /// PLAY only: +500 dinars when the player's net worth (fils + base value of inventory, stall
    /// escrow and cargo in transit) is under 50 dinars, once per hour.
    pub fn faucet(&mut self) -> PlayerView {
        self.try_faucet(env::predecessor_account_id()).or_panic()
    }

    /// Buy from / sell to the merchant of the player's city. `limit_total`: buy pays at most
    /// `total + fee`; sell receives at least `total - fee` (OPEN_QUESTIONS #7).
    pub fn trade(&mut self, merchant: CityId, good: GoodId, side: Side, qty: u32, limit_total: U128) -> TradeResult {
        self.try_trade(env::predecessor_account_id(), merchant, good, side, qty, limit_total.0).or_panic()
    }

    pub fn start_journey(
        &mut self,
        to: CityId,
        cargo: std::collections::BTreeMap<GoodId, u32>,
        guards: u8,
    ) -> JourneyView {
        self.try_start_journey(env::predecessor_account_id(), to, cargo, guards).or_panic()
    }

    /// Returns the claimed journey (`status` CLAIMED, `ambushed`, `lost`); read the player with
    /// `get_player`.
    pub fn claim_journey(&mut self) -> JourneyView {
        let seed = env::random_seed();
        self.try_claim_journey(env::predecessor_account_id(), &seed).or_panic()
    }

    pub fn stall_create(&mut self, good: GoodId, qty: u32, unit_price: U128) -> StallView {
        self.try_stall_create(env::predecessor_account_id(), good, qty, unit_price.0).or_panic()
    }

    pub fn stall_buy(&mut self, stall_id: u64, qty: u32, limit_total: U128) -> PlayerView {
        self.try_stall_buy(env::predecessor_account_id(), stall_id, qty, limit_total.0).or_panic()
    }

    pub fn stall_cancel(&mut self, stall_id: u64) -> PlayerView {
        self.try_stall_cancel(env::predecessor_account_id(), stall_id).or_panic()
    }

    /// LIVE only: debits first, then records a PENDING withdrawal. Returns its id.
    pub fn request_withdraw(&mut self, fils: U128, dest_asset: String, dest_address: String) -> u64 {
        self.try_request_withdraw(env::predecessor_account_id(), fils.0, dest_asset, dest_address).or_panic()
    }
}

impl Contract {
    /// Net worth for the faucet rule: fils + base value of inventory, stall escrow and cargo in
    /// transit (audit finding 5).
    pub(crate) fn faucet_worth(p: &Player) -> CResult<u128> {
        let mut w = ovf(p.fils.checked_add(base_value(&p.goods)?))?;
        w = ovf(w.checked_add(base_value(&p.escrow)?))?;
        if let Some(j) = p.journey.as_ref().filter(|j| j.status == JourneyStatus::InTransit) {
            w = ovf(w.checked_add(base_value(&j.cargo)?))?;
        }
        Ok(w)
    }

    pub(crate) fn try_register(&mut self, who: AccountId) -> CResult<PlayerView> {
        self.require_not_paused()?;
        if let Some(p) = self.players.get(&who) {
            return Self::player_view(&who, p);
        }
        if self.is_reserved(&who) {
            return fail(ErrorCode::Unauthenticated, "this account cannot play");
        }
        let ok = who
            .as_str()
            .strip_suffix(self.player_suffix.as_str())
            .is_some_and(|head| head.len() > 1 && head.ends_with('.'));
        if !ok {
            return fail(ErrorCode::Unauthenticated, "account was not created by the game server");
        }
        if self.players.len() >= self.max_players {
            return fail(ErrorCode::BadRequest, "player limit reached");
        }
        let p = Player::new();
        self.players.insert(who.clone(), p.clone());
        if let Err(e) = self.check_storage() {
            self.players.remove(&who);
            return Err(e);
        }
        Self::player_view(&who, &p)
    }

    pub(crate) fn try_faucet(&mut self, who: AccountId) -> CResult<PlayerView> {
        self.require_not_paused()?;
        if self.mode != Mode::Play {
            return fail(ErrorCode::ModeNotAllowed, "the faucet only works in PLAY mode");
        }
        let mut p = self.load_player(&who)?;
        if Self::faucet_worth(&p)? >= FAUCET_MAX_BALANCE_FILS {
            return fail(ErrorCode::BadRequest, "the faucet is for players with less than 50 dinars");
        }
        let now = Self::now_ns();
        if let Some(last) = p.last_faucet_ns {
            let next = ovf(last.checked_add(ovf(FAUCET_COOLDOWN_SECONDS.checked_mul(NS_PER_SEC))?))?;
            if now < next {
                return fail(ErrorCode::RateLimit, "the faucet is cooling down");
            }
        }
        p.fils = ovf(p.fils.checked_add(FAUCET_FILS))?;
        p.last_faucet_ns = Some(now);
        let total_faucet = ovf(self.total_faucet.checked_add(FAUCET_FILS))?;
        self.total_faucet = total_faucet;
        self.players.insert(who.clone(), p.clone());
        emit("faucet", json!({ "account": who, "fils": FAUCET_FILS.to_string() }));
        Self::player_view(&who, &p)
    }

    pub(crate) fn try_trade(
        &mut self,
        who: AccountId,
        merchant: CityId,
        g: GoodId,
        side: Side,
        qty: u32,
        limit_total: u128,
    ) -> CResult<TradeResult> {
        self.require_not_paused()?;
        let mut p = self.load_player(&who)?;
        if p.in_transit() {
            return fail(ErrorCode::InTransit, "claim or finish your journey first");
        }
        if qty == 0 || qty > MAX_QTY_PER_TRADE {
            return fail(ErrorCode::BadRequest, "qty must be 1..40");
        }
        if merchant != p.location {
            return fail(ErrorCode::NotInCity, "you are not in that city");
        }
        let gi = g.idx();
        let mi = merchant.idx();
        let m = &self.merchants[mi];
        let stock = m.stock[gi];
        let cost = trade_cost(g, side, qty, stock, m.spread_bp, m.bias_bp)?;
        let mut treasury = m.treasury;
        let new_stock;
        match side {
            Side::Buy => {
                if stock < qty {
                    return fail(ErrorCode::InsufficientStock, "the merchant does not have that much");
                }
                if ovf(units(&p.goods)?.checked_add(qty))? > CARGO_CAP {
                    return fail(ErrorCode::CargoLimit, "caravan is full");
                }
                let pay = ovf(cost.total.checked_add(cost.fee))?;
                if pay > limit_total {
                    return fail(ErrorCode::Slippage, "the price moved");
                }
                if pay > p.fils {
                    return fail(ErrorCode::InsufficientFunds, "not enough dinar");
                }
                p.fils = ovf(p.fils.checked_sub(pay))?;
                p.goods[gi] = ovf(p.goods[gi].checked_add(qty))?;
                new_stock = ovf(stock.checked_sub(qty))?;
                treasury = ovf(treasury.checked_add(cost.total))?;
                self.add_player_goods(g, qty)?;
            }
            Side::Sell => {
                if p.goods[gi] < qty {
                    return fail(ErrorCode::InsufficientStock, "you do not have that much");
                }
                if ovf(stock.checked_add(qty))? > cap(g) {
                    return fail(ErrorCode::BadRequest, "warehouse full");
                }
                if treasury < cost.total {
                    return fail(ErrorCode::MerchantBroke, "the merchant cannot afford it");
                }
                let gain = ovf(cost.total.checked_sub(cost.fee))?;
                if gain < limit_total {
                    return fail(ErrorCode::Slippage, "the price moved");
                }
                p.fils = ovf(p.fils.checked_add(gain))?;
                p.goods[gi] = ovf(p.goods[gi].checked_sub(qty))?;
                new_stock = ovf(stock.checked_add(qty))?;
                treasury = ovf(treasury.checked_sub(cost.total))?;
                self.sub_player_goods(g, qty)?;
            }
        }
        self.add_house(cost.fee)?;
        let m = &mut self.merchants[mi];
        m.stock[gi] = new_stock;
        m.treasury = treasury;
        self.players.insert(who.clone(), p.clone());
        emit(
            "trade",
            json!({
                "account": who, "merchant": merchant, "good": g,
                "side": if side == Side::Buy { "buy" } else { "sell" },
                "qty": qty, "unit": cost.unit.to_string(), "total": cost.total.to_string(), "fee": cost.fee.to_string(),
            }),
        );
        Ok(TradeResult {
            unit: U128(cost.unit),
            total: U128(cost.total),
            fee: U128(cost.fee),
            player: Self::player_view(&who, &p)?,
        })
    }

    pub(crate) fn try_start_journey(
        &mut self,
        who: AccountId,
        to: CityId,
        cargo_in: std::collections::BTreeMap<GoodId, u32>,
        guards: u8,
    ) -> CResult<JourneyView> {
        self.require_not_paused()?;
        let mut p = self.load_player(&who)?;
        if p.in_transit() {
            return fail(ErrorCode::InTransit, "claim or finish your journey first");
        }
        if to == p.location {
            return fail(ErrorCode::BadRequest, "you are already there");
        }
        if guards > MAX_GUARDS {
            return fail(ErrorCode::BadRequest, "at most 3 guards");
        }
        let Some((seconds, base_risk)) = route(p.location, to) else {
            return fail(ErrorCode::BadRequest, "no such route");
        };
        let mut cargo = [0u32; 5];
        for (g, n) in &cargo_in {
            if *n == 0 {
                continue;
            }
            if p.goods[g.idx()] < *n {
                return fail(ErrorCode::InsufficientStock, format!("you do not have {} {}", n, g.as_str()));
            }
            cargo[g.idx()] = *n;
        }
        let n_units = units(&cargo)?;
        if n_units == 0 {
            return fail(ErrorCode::BadRequest, "cargo is empty");
        }
        if n_units > CARGO_CAP {
            return fail(ErrorCode::CargoLimit, "caravan is full");
        }
        let risk_bp = journey_risk_bp(base_risk, guards)?;
        let cost = guard_cost(base_value(&cargo)?, guards)?;
        if cost > p.fils {
            return fail(ErrorCode::InsufficientFunds, "not enough dinar for guards");
        }
        let now = Self::now_ns();
        let arrives = ovf(now.checked_add(ovf(seconds.checked_mul(NS_PER_SEC))?))?;
        let id = self.next_journey_id;
        let next_id = ovf(id.checked_add(1))?;
        p.fils = ovf(p.fils.checked_sub(cost))?;
        for g in GoodId::ALL {
            p.goods[g.idx()] = ovf(p.goods[g.idx()].checked_sub(cargo[g.idx()]))?;
        }
        let j = Journey {
            id,
            from: p.location,
            to,
            cargo,
            guards,
            started_at_ns: now,
            arrives_at_ns: arrives,
            risk_bp,
            status: JourneyStatus::InTransit,
            ambushed: false,
            lost: [0; 5],
        };
        p.journey = Some(j.clone());
        self.add_house(cost)?;
        self.next_journey_id = next_id;
        self.players.insert(who.clone(), p);
        self.check_storage()?;
        emit(
            "journey_started",
            json!({
                "account": who, "id": id, "from": j.from, "to": to, "guards": guards, "risk_bp": risk_bp,
                "guard_cost": cost.to_string(), "arrives_at_ns": arrives.to_string(),
                "cargo": GoodsView::from_array(&cargo),
            }),
        );
        Ok(Self::journey_view(&j))
    }

    pub(crate) fn try_claim_journey(&mut self, who: AccountId, seed: &[u8]) -> CResult<JourneyView> {
        self.require_not_paused()?;
        let mut p = self.load_player(&who)?;
        let Some(mut j) = p.journey.clone().filter(|j| j.status == JourneyStatus::InTransit) else {
            return fail(ErrorCode::BadRequest, "you have no journey");
        };
        if Self::now_ns() < j.arrives_at_ns {
            return fail(ErrorCode::NotArrived, "the caravan has not arrived yet");
        }
        let roll = ambush_roll(seed, j.id, who.as_str());
        let ambushed = roll < j.risk_bp;
        let mut lost = [0u32; 5];
        for g in GoodId::ALL {
            let i = g.idx();
            let l = if ambushed { ambush_loss(j.cargo[i])? } else { 0 };
            lost[i] = l;
            let keep = ovf(j.cargo[i].checked_sub(l))?;
            p.goods[i] = ovf(p.goods[i].checked_add(keep))?;
        }
        for g in GoodId::ALL {
            self.sub_player_goods(g, lost[g.idx()])?;
        }
        j.status = JourneyStatus::Claimed;
        j.ambushed = ambushed;
        j.lost = lost;
        p.location = j.to;
        p.journey = Some(j.clone());
        self.players.insert(who.clone(), p.clone());
        emit(
            "journey_claimed",
            json!({
                "account": who, "id": j.id, "to": j.to, "ambushed": ambushed, "roll": roll,
                "risk_bp": j.risk_bp, "lost": GoodsView::from_array(&lost),
            }),
        );
        Ok(Self::journey_view(&j))
    }

    pub(crate) fn try_stall_create(
        &mut self,
        who: AccountId,
        g: GoodId,
        qty: u32,
        unit_price: u128,
    ) -> CResult<StallView> {
        self.require_not_paused()?;
        let mut p = self.load_player(&who)?;
        if p.in_transit() {
            return fail(ErrorCode::InTransit, "you are travelling");
        }
        if qty == 0 {
            return fail(ErrorCode::BadRequest, "qty must be positive");
        }
        if unit_price == 0 || unit_price > MAX_STALL_UNIT_PRICE {
            return fail(ErrorCode::BadRequest, "bad unit_price");
        }
        if p.stall_count >= MAX_STALLS_PER_PLAYER {
            return fail(ErrorCode::RateLimit, "too many open stalls");
        }
        let gi = g.idx();
        if p.goods[gi] < qty {
            return fail(ErrorCode::InsufficientStock, "you do not have that much");
        }
        let id = self.next_stall_id;
        let next = ovf(id.checked_add(1))?;
        p.goods[gi] = ovf(p.goods[gi].checked_sub(qty))?;
        p.stall_count = ovf(p.stall_count.checked_add(1))?;
        p.escrow[gi] = ovf(p.escrow[gi].checked_add(qty))?;
        let s = Stall { id, seller: who.clone(), city: p.location, good: g, qty, unit_price };
        self.next_stall_id = next;
        self.players.insert(who.clone(), p);
        self.stalls.insert(id, s.clone());
        self.check_storage()?;
        emit(
            "stall_create",
            json!({ "account": who, "id": id, "city": s.city, "good": g, "qty": qty, "unit_price": unit_price.to_string() }),
        );
        Ok(Self::stall_view(&s))
    }

    /// Buyer pays `price = qty x unit_price` (`limit_total` bounds it). The 2% stall fee is taken
    /// from the seller's proceeds (plan 5.3 "fee on the seller side"), rounded up so every sale
    /// pays at least 1 fils: seller gets `price - ceil(price x 2%)`, house gets the fee.
    /// Buyer and seller must both be in the stall's city and not travelling.
    pub(crate) fn try_stall_buy(
        &mut self,
        who: AccountId,
        stall_id: u64,
        qty: u32,
        limit_total: u128,
    ) -> CResult<PlayerView> {
        self.require_not_paused()?;
        let mut buyer = self.load_player(&who)?;
        if buyer.in_transit() {
            return fail(ErrorCode::InTransit, "you are travelling");
        }
        let Some(mut s) = self.stalls.get(&stall_id).cloned() else {
            return fail(ErrorCode::BadRequest, "no such stall");
        };
        if s.seller == who {
            return fail(ErrorCode::BadRequest, "that is your own stall");
        }
        if s.city != buyer.location {
            return fail(ErrorCode::NotInCity, "you are not in that city");
        }
        let mut seller = self.load_player(&s.seller)?;
        if seller.location != s.city || seller.in_transit() {
            return fail(ErrorCode::NotInCity, "the seller is not in the city");
        }
        if qty == 0 {
            return fail(ErrorCode::BadRequest, "qty must be positive");
        }
        if qty > s.qty {
            return fail(ErrorCode::InsufficientStock, "the stall does not have that much");
        }
        if ovf(units(&buyer.goods)?.checked_add(qty))? > CARGO_CAP {
            return fail(ErrorCode::CargoLimit, "caravan is full");
        }
        let price = ovf(s.unit_price.checked_mul(u128::from(qty)))?;
        let fee = bp_of_ceil(price, STALL_FEE_BP)?;
        let proceeds = ovf(price.checked_sub(fee))?;
        if price > limit_total {
            return fail(ErrorCode::Slippage, "the price moved");
        }
        if price > buyer.fils {
            return fail(ErrorCode::InsufficientFunds, "not enough dinar");
        }
        let gi = s.good.idx();
        buyer.fils = ovf(buyer.fils.checked_sub(price))?;
        buyer.goods[gi] = ovf(buyer.goods[gi].checked_add(qty))?;
        seller.fils = ovf(seller.fils.checked_add(proceeds))?;
        seller.escrow[gi] = ovf(seller.escrow[gi].checked_sub(qty))?;
        s.qty = ovf(s.qty.checked_sub(qty))?;
        if s.qty == 0 {
            seller.stall_count = ovf(seller.stall_count.checked_sub(1))?;
        }
        self.add_house(fee)?;
        if s.qty == 0 {
            self.stalls.remove(&stall_id);
        } else {
            self.stalls.insert(stall_id, s.clone());
        }
        self.players.insert(s.seller.clone(), seller);
        self.players.insert(who.clone(), buyer.clone());
        emit(
            "stall_buy",
            json!({
                "account": who, "seller": s.seller, "id": stall_id, "city": s.city, "good": s.good, "qty": qty,
                "total": price.to_string(), "fee": fee.to_string(),
            }),
        );
        Self::player_view(&who, &buyer)
    }

    pub(crate) fn try_stall_cancel(&mut self, who: AccountId, stall_id: u64) -> CResult<PlayerView> {
        self.require_not_paused()?;
        let mut p = self.load_player(&who)?;
        let Some(s) = self.stalls.get(&stall_id).cloned() else {
            return fail(ErrorCode::BadRequest, "no such stall");
        };
        if s.seller != who {
            return fail(ErrorCode::Unauthenticated, "not your stall");
        }
        if p.in_transit() {
            return fail(ErrorCode::InTransit, "you are travelling");
        }
        if p.location != s.city {
            return fail(ErrorCode::NotInCity, "you are not in that city");
        }
        let gi = s.good.idx();
        p.goods[gi] = ovf(p.goods[gi].checked_add(s.qty))?;
        p.stall_count = ovf(p.stall_count.checked_sub(1))?;
        p.escrow[gi] = ovf(p.escrow[gi].checked_sub(s.qty))?;
        self.stalls.remove(&stall_id);
        self.players.insert(who.clone(), p.clone());
        emit("stall_cancel", json!({ "account": who, "id": stall_id, "city": s.city, "good": s.good, "qty": s.qty }));
        Self::player_view(&who, &p)
    }

    pub(crate) fn try_request_withdraw(
        &mut self,
        who: AccountId,
        fils: u128,
        dest_asset: String,
        dest_address: String,
    ) -> CResult<u64> {
        self.require_not_paused()?;
        if self.mode != Mode::Live {
            return fail(ErrorCode::ModeNotAllowed, "withdrawals are only available in LIVE mode");
        }
        let mut p = self.load_player(&who)?;
        if fils < MIN_WITHDRAW_FILS {
            return fail(ErrorCode::BadRequest, "minimum withdrawal is 10 dinars");
        }
        if p.open_withdraw.is_some() {
            return fail(ErrorCode::RateLimit, "a withdrawal is already in progress");
        }
        if dest_asset.is_empty()
            || dest_asset.len() > MAX_ASSET_LEN
            || dest_address.is_empty()
            || dest_address.len() > MAX_ADDRESS_LEN
        {
            return fail(ErrorCode::BadRequest, "bad destination");
        }
        let now = Self::now_ns();
        let day = ovf(ovf(now.checked_div(NS_PER_SEC))?.checked_div(SECONDS_PER_DAY))?;
        let today = if p.withdraw_day == day { p.withdrawn_today } else { 0 };
        let after = ovf(today.checked_add(fils))?;
        if after > DAILY_WITHDRAW_CAP_FILS {
            return fail(ErrorCode::RateLimit, "daily withdraw cap reached");
        }
        if fils > p.fils {
            return fail(ErrorCode::InsufficientFunds, "not enough dinar");
        }
        let id = self.next_withdraw_id;
        let next = ovf(id.checked_add(1))?;
        let pending = ovf(self.pending_withdrawals.checked_add(fils))?;
        // debit first, then record
        p.fils = ovf(p.fils.checked_sub(fils))?;
        p.withdraw_day = day;
        p.withdrawn_today = after;
        p.open_withdraw = Some(id);
        self.players.insert(who.clone(), p);
        self.pending_withdrawals = pending;
        self.next_withdraw_id = next;
        let w = Withdrawal {
            id,
            account: who.clone(),
            fils,
            dest_asset,
            dest_address,
            status: WithdrawStatus::Pending,
            created_ns: now,
            updated_ns: now,
            reference: None,
        };
        self.withdrawals.insert(id, w.clone());
        self.check_storage()?;
        emit(
            "withdraw_requested",
            json!({ "account": who, "id": id, "fils": fils.to_string(), "dest_asset": w.dest_asset, "dest_address": w.dest_address }),
        );
        Ok(id)
    }
}
