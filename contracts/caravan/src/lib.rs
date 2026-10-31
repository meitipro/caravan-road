//! Caravan Road game contract (spec/CONTRACT.md, master plan section 5).
//!
//! One contract holds dinars (fils), goods, merchants, journeys, stalls and withdrawals, so every
//! trade is a single atomic transaction. near-sdk 5.30.0:
//! https://docs.rs/near-sdk/5.30.0/near_sdk/ (store collections: `near_sdk::store`,
//! https://docs.near.org/smart-contracts/anatomy/collections).
//!
//! Every public write method delegates to a `try_*` function that validates everything first and
//! mutates state only after all checks passed; errors panic with `"<ERROR_CODE>: <message>"`.

#![cfg_attr(not(test), deny(clippy::arithmetic_side_effects, clippy::as_conversions))]

pub mod errors;
pub mod events;
pub mod math;
pub mod types;

mod admin;
mod game;
mod views;

#[cfg(test)]
mod tests;

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near};

use crate::errors::{CResult, ErrorCode, OrPanic, fail, ovf};
use crate::math::*;
use crate::types::*;

pub const CONTRACT_VERSION: &str = "1.0.0";

#[derive(BorshStorageKey)]
#[near]
enum Prefix {
    Players,
    Stalls,
    Withdrawals,
    CreditedRefs,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) owner: AccountId,
    pub(crate) operator: AccountId,
    pub(crate) mode: Mode,
    pub(crate) paused: bool,
    pub(crate) max_players: u32,
    pub(crate) player_suffix: Option<String>,
    pub(crate) operator_daily_cap: u128,
    pub(crate) operator_day: u64,
    pub(crate) operator_credited_today: u128,
    pub(crate) auto_ship: bool,
    pub(crate) merchants: [Merchant; 4],
    pub(crate) players: IterableMap<AccountId, Player>,
    pub(crate) stalls: IterableMap<u64, Stall>,
    pub(crate) next_stall_id: u64,
    pub(crate) withdrawals: LookupMap<u64, Withdrawal>,
    pub(crate) next_withdraw_id: u64,
    pub(crate) credited_refs: LookupSet<String>,
    pub(crate) next_journey_id: u64,
    pub(crate) house: u128,
    pub(crate) last_tick_ns: u64,
    pub(crate) tick_count: u64,
    // solvency bookkeeping (plan 5.3 "Solvency invariant")
    pub(crate) seed_total: u128,
    pub(crate) total_deposited: u128,
    pub(crate) total_withdrawn: u128,
    pub(crate) total_faucet: u128,
    pub(crate) pending_withdrawals: u128,
    /// Units of each good held outside merchants (player inventories, stalls, caravans).
    pub(crate) player_goods: [u64; 5],
}

#[near]
impl Contract {
    /// `init(owner, operator, mode, merchant_accounts, max_players)` (plan 5.3) plus optional
    /// `player_suffix` (register only `*.suffix` accounts), `operator_daily_cap` (fils) and
    /// `auto_ship` (run house caravans inside `world_tick`). `#[private]`: only the contract
    /// account itself can initialize (deploy + init in one batch transaction).
    #[init]
    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn init(
        owner: AccountId,
        operator: AccountId,
        mode: Mode,
        merchant_accounts: MerchantAccounts,
        max_players: u32,
        player_suffix: Option<String>,
        operator_daily_cap: Option<U128>,
        auto_ship: Option<bool>,
    ) -> Self {
        Self::try_new(owner, operator, mode, merchant_accounts, max_players, player_suffix, operator_daily_cap, auto_ship)
            .or_panic()
    }
}

impl Contract {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn try_new(
        owner: AccountId,
        operator: AccountId,
        mode: Mode,
        merchant_accounts: MerchantAccounts,
        max_players: u32,
        player_suffix: Option<String>,
        operator_daily_cap: Option<U128>,
        auto_ship: Option<bool>,
    ) -> CResult<Self> {
        let accounts = [merchant_accounts.dasht, merchant_accounts.madan, merchant_accounts.bandar, merchant_accounts.shahr];
        for (i, a) in accounts.iter().enumerate() {
            if *a == owner || *a == operator {
                return fail(ErrorCode::BadRequest, "merchant account must differ from owner and operator");
            }
            if accounts.iter().skip(i.saturating_add(1)).any(|b| b == a) {
                return fail(ErrorCode::BadRequest, "merchant accounts must be distinct");
            }
        }
        if max_players == 0 {
            return fail(ErrorCode::BadRequest, "max_players must be positive");
        }
        if player_suffix.as_ref().is_some_and(|s| s.is_empty() || s.len() > 64) {
            return fail(ErrorCode::BadRequest, "bad player_suffix");
        }
        let merchants = accounts.map(|account| Merchant {
            account,
            treasury: MERCHANT_TREASURY_FILS,
            stock: GoodId::ALL.map(|g| good(g).target),
            spread_bp: SPREAD_DEFAULT_BP,
            bias_bp: 0,
            last_policy_ns: None,
            last_ship_tick: [None; 5],
        });
        let seed_total = ovf(MERCHANT_TREASURY_FILS.checked_mul(4))?;
        Ok(Self {
            owner,
            operator,
            mode,
            paused: false,
            max_players,
            player_suffix,
            operator_daily_cap: operator_daily_cap.map(|c| c.0).unwrap_or(DEFAULT_OPERATOR_DAILY_CAP_FILS),
            operator_day: 0,
            operator_credited_today: 0,
            auto_ship: auto_ship.unwrap_or(false),
            merchants,
            players: IterableMap::new(Prefix::Players),
            stalls: IterableMap::new(Prefix::Stalls),
            next_stall_id: 0,
            withdrawals: LookupMap::new(Prefix::Withdrawals),
            next_withdraw_id: 0,
            credited_refs: LookupSet::new(Prefix::CreditedRefs),
            next_journey_id: 0,
            house: 0,
            last_tick_ns: env::block_timestamp(),
            tick_count: 0,
            seed_total,
            total_deposited: 0,
            total_withdrawn: 0,
            total_faucet: 0,
            pending_withdrawals: 0,
            player_goods: [0; 5],
        })
    }

    // ---------- shared guards and helpers ----------

    pub(crate) fn now_ns() -> u64 {
        env::block_timestamp()
    }

    pub(crate) fn require_not_paused(&self) -> CResult<()> {
        if self.paused {
            return fail(ErrorCode::Paused, "the game is paused");
        }
        Ok(())
    }

    pub(crate) fn require_owner(&self, who: &AccountId) -> CResult<()> {
        if *who != self.owner {
            return fail(ErrorCode::Unauthenticated, "owner only");
        }
        Ok(())
    }

    pub(crate) fn require_operator(&self, who: &AccountId) -> CResult<()> {
        if *who != self.operator {
            return fail(ErrorCode::Unauthenticated, "operator only");
        }
        Ok(())
    }

    pub(crate) fn merchant_index(&self, who: &AccountId) -> CResult<usize> {
        match self.merchants.iter().position(|m| m.account == *who) {
            Some(i) => Ok(i),
            None => fail(ErrorCode::Unauthenticated, "merchant only"),
        }
    }

    pub(crate) fn is_reserved(&self, who: &AccountId) -> bool {
        *who == self.owner
            || *who == self.operator
            || *who == env::current_account_id()
            || self.merchants.iter().any(|m| m.account == *who)
    }

    pub(crate) fn load_player(&self, who: &AccountId) -> CResult<Player> {
        match self.players.get(who) {
            Some(p) => Ok(p.clone()),
            None => fail(ErrorCode::Unauthenticated, "player not registered"),
        }
    }

    /// Persists collections and checks the contract balance still covers its storage
    /// (security checklist: "contract balance covers storage").
    pub(crate) fn check_storage(&mut self) -> CResult<()> {
        self.players.flush();
        self.stalls.flush();
        self.withdrawals.flush();
        let used = u128::from(env::storage_usage());
        let needed = ovf(used.checked_mul(env::storage_byte_cost().as_yoctonear()))?;
        if env::account_balance().as_yoctonear() < needed {
            return fail(ErrorCode::Internal, "storage full");
        }
        Ok(())
    }

    pub(crate) fn add_player_goods(&mut self, g: GoodId, qty: u32) -> CResult<()> {
        let i = g.idx();
        self.player_goods[i] = ovf(self.player_goods[i].checked_add(u64::from(qty)))?;
        Ok(())
    }

    pub(crate) fn sub_player_goods(&mut self, g: GoodId, qty: u32) -> CResult<()> {
        let i = g.idx();
        self.player_goods[i] = ovf(self.player_goods[i].checked_sub(u64::from(qty)))?;
        Ok(())
    }

    pub(crate) fn add_house(&mut self, amount: u128) -> CResult<()> {
        self.house = ovf(self.house.checked_add(amount))?;
        Ok(())
    }
}

/// Sum of a goods array (bounded: 5 entries).
pub(crate) fn units(goods: &[u32; 5]) -> CResult<u32> {
    let mut n: u32 = 0;
    for q in goods {
        n = ovf(n.checked_add(*q))?;
    }
    Ok(n)
}
