//! Read-only views and the read-only NEP-245 subset (`mt_*`).
//! NEP-245 signatures: https://github.com/near/NEPs/blob/master/neps/nep-0245.md and
//! https://github.com/near/NEPs/blob/master/neps/nep-0245/Enumeration.md

use std::collections::BTreeMap;

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, env, near};

use crate::errors::{CResult, ErrorCode, OrPanic, fail, ovf};
use crate::math::*;
use crate::types::*;
use crate::{CONTRACT_VERSION, Contract, ContractExt};

impl Contract {
    pub(crate) fn quote_view(m: &Merchant, g: GoodId) -> CResult<QuoteView> {
        let q = quote(g, i128::from(m.stock[g.idx()]), m.spread_bp, m.bias_bp)?;
        Ok(QuoteView { bid: U128(q.bid), mid: U128(q.mid), ask: U128(q.ask) })
    }

    pub(crate) fn quotes_view(m: &Merchant) -> CResult<QuotesView> {
        Ok(QuotesView {
            grain: Self::quote_view(m, GoodId::Grain)?,
            salt: Self::quote_view(m, GoodId::Salt)?,
            iron: Self::quote_view(m, GoodId::Iron)?,
            spice: Self::quote_view(m, GoodId::Spice)?,
            silk: Self::quote_view(m, GoodId::Silk)?,
        })
    }

    pub(crate) fn merchant_view(&self, city: CityId) -> CResult<MerchantView> {
        let m = &self.merchants[city.idx()];
        Ok(MerchantView {
            id: city,
            account_id: m.account.clone(),
            treasury: U128(m.treasury),
            stock: GoodsView::from_array(&m.stock),
            policy: PolicyView { spread_bp: m.spread_bp, bias_bp: m.bias_bp },
            quotes: Self::quotes_view(m)?,
            last_policy_ns: m.last_policy_ns.map(U64),
        })
    }

    fn goods_map(a: &[u32; 5]) -> BTreeMap<GoodId, u32> {
        GoodId::ALL.into_iter().filter(|g| a[g.idx()] > 0).map(|g| (g, a[g.idx()])).collect()
    }

    pub(crate) fn journey_view(j: &Journey) -> JourneyView {
        let status = match j.status {
            JourneyStatus::Claimed => "CLAIMED",
            JourneyStatus::InTransit if env::block_timestamp() >= j.arrives_at_ns => "ARRIVED",
            JourneyStatus::InTransit => "IN_TRANSIT",
        };
        let claimed = j.status == JourneyStatus::Claimed;
        JourneyView {
            id: j.id,
            from: j.from,
            to: j.to,
            cargo: Self::goods_map(&j.cargo),
            guards: j.guards,
            started_at_ns: U64(j.started_at_ns),
            arrives_at_ns: U64(j.arrives_at_ns),
            risk_bp: j.risk_bp,
            status: status.to_string(),
            ambushed: if claimed { Some(j.ambushed) } else { None },
            lost: if claimed && j.ambushed { Some(Self::goods_map(&j.lost)) } else { None },
        }
    }

    /// OPEN_QUESTIONS #2: net worth = fils + sum(qty x base price) of the inventory.
    pub(crate) fn net_worth(p: &Player) -> CResult<u128> {
        ovf(p.fils.checked_add(base_value(&p.goods)?))
    }

    pub(crate) fn player_view(account_id: &AccountId, p: &Player) -> CResult<PlayerView> {
        Ok(PlayerView {
            account_id: account_id.clone(),
            fils: U128(p.fils),
            location: p.location,
            inventory: GoodsView::from_array(&p.goods),
            journey: p.journey.as_ref().map(Self::journey_view),
            net_worth: U128(Self::net_worth(p)?),
            last_faucet_ns: p.last_faucet_ns.map(U64),
            stall_count: p.stall_count,
            total_deposited: U128(p.total_deposited),
            withdrawn_today: U128(p.withdrawn_today),
            withdraw_day: p.withdraw_day,
        })
    }

    pub(crate) fn stall_view(s: &Stall) -> StallView {
        StallView {
            id: s.id,
            seller: s.seller.clone(),
            city: s.city,
            good: s.good,
            qty: s.qty,
            unit_price: U128(s.unit_price),
        }
    }

    fn page(from_index: Option<u32>, limit: Option<u32>) -> (usize, usize) {
        let from = usize::try_from(from_index.unwrap_or(0)).unwrap_or(usize::MAX);
        let lim = usize::try_from(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)).unwrap_or(0);
        (from, lim)
    }

    fn token(token_id: &str) -> CResult<GoodId> {
        match GoodId::parse(token_id) {
            Some(g) => Ok(g),
            None => fail(ErrorCode::BadRequest, "unknown token_id"),
        }
    }

    /// Balance of a good: a player's inventory, or a merchant's stock for a merchant account.
    pub(crate) fn balance_of(&self, account_id: &AccountId, g: GoodId) -> u32 {
        if let Some(m) = self.merchants.iter().find(|m| m.account == *account_id) {
            return m.stock[g.idx()];
        }
        self.players.get(account_id).map(|p| p.goods[g.idx()]).unwrap_or(0)
    }

    /// Total units in existence: merchants' stock + everything held by players
    /// (inventories, stall escrow, caravans in transit).
    pub(crate) fn supply(&self, g: GoodId) -> CResult<u128> {
        let mut s = u128::from(self.player_goods[g.idx()]);
        for m in &self.merchants {
            s = ovf(s.checked_add(u128::from(m.stock[g.idx()])))?;
        }
        Ok(s)
    }
}

#[near]
impl Contract {
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            version: CONTRACT_VERSION.to_string(),
            owner: self.owner.clone(),
            operator: self.operator.clone(),
            mode: self.mode,
            paused: self.paused,
            max_players: self.max_players,
            player_suffix: self.player_suffix.clone(),
            operator_daily_cap: U128(self.operator_daily_cap),
            auto_ship: self.auto_ship,
            merchant_accounts: self.merchants.iter().map(|m| m.account.clone()).collect(),
            tick_seconds: TICK_SECONDS,
            tick_min_interval_seconds: TICK_MIN_INTERVAL_SECONDS,
            max_missed_ticks: MAX_MISSED_TICKS,
            spread_default_bp: SPREAD_DEFAULT_BP,
            spread_min_bp: SPREAD_MIN_BP,
            spread_max_bp: SPREAD_MAX_BP,
            bias_min_bp: BIAS_MIN_BP,
            bias_max_bp: BIAS_MAX_BP,
            trade_fee_bp: 100,
            max_qty_per_trade: MAX_QTY_PER_TRADE,
            cargo_cap: CARGO_CAP,
            guard_cost_bp: 200,
            guard_risk_factor_bp: 6500,
            max_guards: MAX_GUARDS,
            ambush_loss_bp: AMBUSH_LOSS_BP,
            merchant_treasury_fils: U128(MERCHANT_TREASURY_FILS),
            faucet_fils: U128(FAUCET_FILS),
            faucet_cooldown_seconds: FAUCET_COOLDOWN_SECONDS,
            faucet_max_balance_fils: U128(FAUCET_MAX_BALANCE_FILS),
            max_deposit_fils: U128(MAX_DEPOSIT_FILS),
            daily_withdraw_cap_fils: U128(DAILY_WITHDRAW_CAP_FILS),
            stall_fee_bp: 200,
            max_stalls_per_player: MAX_STALLS_PER_PLAYER,
            npc_ship_units_per_tick: NPC_SHIP_UNITS_PER_TICK,
            npc_min_ratio_gap_bp: 5000,
            policy_min_interval_seconds: POLICY_MIN_INTERVAL_SECONDS,
            policy_max_step_bp: POLICY_MAX_STEP_BP,
            ship_max_pay_pct: 25,
            min_withdraw_fils: U128(MIN_WITHDRAW_FILS),
        }
    }

    pub fn get_world(&self) -> WorldView {
        let merchants = CityId::ALL.iter().map(|c| self.merchant_view(*c).or_panic()).collect();
        WorldView {
            tick: self.tick_count,
            now_ns: U64(env::block_timestamp()),
            last_tick_ns: U64(self.last_tick_ns),
            mode: self.mode,
            paused: self.paused,
            house: U128(self.house),
            merchants,
            player_count: self.players.len(),
            stall_count: self.stalls.len(),
        }
    }

    pub fn get_merchant(&self, city: CityId) -> MerchantView {
        self.merchant_view(city).or_panic()
    }

    pub fn get_quotes(&self, city: CityId) -> QuotesView {
        Self::quotes_view(&self.merchants[city.idx()]).or_panic()
    }

    pub fn get_player(&self, account_id: AccountId) -> Option<PlayerView> {
        self.players.get(&account_id).map(|p| Self::player_view(&account_id, p).or_panic())
    }

    /// Leaderboard input, paginated (at most 100 per call).
    pub fn get_players(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<PlayerView> {
        let (from, lim) = Self::page(from_index, limit);
        self.players.iter().skip(from).take(lim).map(|(a, p)| Self::player_view(a, p).or_panic()).collect()
    }

    pub fn get_journey(&self, account_id: AccountId) -> Option<JourneyView> {
        self.players.get(&account_id).and_then(|p| p.journey.as_ref().map(Self::journey_view))
    }

    /// Stalls, paginated over all stalls (at most 100 scanned per call), optionally filtered
    /// by city within the page.
    pub fn get_stalls(&self, city: Option<CityId>, from_index: Option<u32>, limit: Option<u32>) -> Vec<StallView> {
        let (from, lim) = Self::page(from_index, limit);
        self.stalls
            .iter()
            .skip(from)
            .take(lim)
            .filter(|(_, s)| city.is_none_or(|c| s.city == c))
            .map(|(_, s)| Self::stall_view(s))
            .collect()
    }

    pub fn get_withdraw(&self, id: u64) -> Option<WithdrawalView> {
        self.withdrawals.get(&id).map(Self::withdrawal_view)
    }

    /// Withdrawals with `id >= from_id` in ascending id order; at most `limit` (<= 200) ids scanned.
    pub fn get_withdrawals(&self, from_id: Option<u64>, limit: Option<u64>) -> Vec<WithdrawalView> {
        let from = from_id.unwrap_or(0);
        let lim = limit.unwrap_or(MAX_WITHDRAW_PAGE).min(MAX_WITHDRAW_PAGE);
        let end = from.saturating_add(lim).min(self.next_withdraw_id);
        (from..end).filter_map(|id| self.withdrawals.get(&id).map(Self::withdrawal_view)).collect()
    }
}

impl Contract {
    fn withdrawal_view(w: &Withdrawal) -> WithdrawalView {
        WithdrawalView {
            id: w.id,
            account_id: w.account.clone(),
            fils: U128(w.fils),
            dest_asset: w.dest_asset.clone(),
            dest_address: w.dest_address.clone(),
            status: w.status,
            created_ns: U64(w.created_ns),
            updated_ns: U64(w.updated_ns),
            reference: w.reference.clone(),
        }
    }
}

#[near]
impl Contract {
    /// Money bookkeeping for the solvency invariant (player balances are summed off-chain
    /// from `get_players`).
    pub fn get_solvency(&self) -> SolvencyView {
        let mut t: u128 = 0;
        for m in &self.merchants {
            t = ovf(t.checked_add(m.treasury)).or_panic();
        }
        SolvencyView {
            seed_total: U128(self.seed_total),
            total_deposited: U128(self.total_deposited),
            total_faucet: U128(self.total_faucet),
            total_withdrawn: U128(self.total_withdrawn),
            pending_withdrawals: U128(self.pending_withdrawals),
            house: U128(self.house),
            merchant_treasuries: U128(t),
        }
    }

    // ---------- NEP-245 read-only subset ("MT-compatible views") ----------

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        let g = Self::token(&token_id).or_panic();
        U128(u128::from(self.balance_of(&account_id, g)))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        if token_ids.len() > GoodId::ALL.len() {
            fail::<()>(ErrorCode::BadRequest, "too many token_ids").or_panic();
        }
        token_ids.iter().map(|t| U128(u128::from(self.balance_of(&account_id, Self::token(t).or_panic())))).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        GoodId::parse(&token_id).map(|g| U128(self.supply(g).or_panic()))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        if token_ids.len() > GoodId::ALL.len() {
            fail::<()>(ErrorCode::BadRequest, "too many token_ids").or_panic();
        }
        token_ids.iter().map(|t| GoodId::parse(t).map(|g| U128(self.supply(g).or_panic()))).collect()
    }

    pub fn mt_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<String>,
        limit: Option<u32>,
    ) -> Vec<MtToken> {
        let from = from_index.and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
        let lim = usize::try_from(limit.unwrap_or(5)).unwrap_or(5);
        GoodId::ALL
            .into_iter()
            .filter(|g| self.balance_of(&account_id, *g) > 0)
            .skip(from)
            .take(lim)
            .map(|g| MtToken { token_id: g.as_str().to_string(), owner_id: None })
            .collect()
    }
}
