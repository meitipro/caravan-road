//! Ids, stored records and JSON views.
//! Serialization attributes follow https://docs.rs/near-sdk/5.30.0/near_sdk/attr.near.html
//! (`#[near(serializers = [borsh, json])]`, `#[near(contract_state)]`).

use std::collections::BTreeMap;

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

// ---------- ids ----------

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum CityId {
    Dasht,
    Madan,
    Bandar,
    Shahr,
}

impl CityId {
    /// Order used for every tie-break (spec/OPEN_QUESTIONS.md #9): dasht, madan, bandar, shahr.
    pub const ALL: [CityId; 4] = [CityId::Dasht, CityId::Madan, CityId::Bandar, CityId::Shahr];

    pub const fn idx(self) -> usize {
        match self {
            CityId::Dasht => 0,
            CityId::Madan => 1,
            CityId::Bandar => 2,
            CityId::Shahr => 3,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            CityId::Dasht => "dasht",
            CityId::Madan => "madan",
            CityId::Bandar => "bandar",
            CityId::Shahr => "shahr",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum GoodId {
    Grain,
    Salt,
    Iron,
    Spice,
    Silk,
}

impl GoodId {
    pub const ALL: [GoodId; 5] = [GoodId::Grain, GoodId::Salt, GoodId::Iron, GoodId::Spice, GoodId::Silk];

    pub const fn idx(self) -> usize {
        match self {
            GoodId::Grain => 0,
            GoodId::Salt => 1,
            GoodId::Iron => 2,
            GoodId::Spice => 3,
            GoodId::Silk => 4,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            GoodId::Grain => "grain",
            GoodId::Salt => "salt",
            GoodId::Iron => "iron",
            GoodId::Spice => "spice",
            GoodId::Silk => "silk",
        }
    }

    pub fn parse(s: &str) -> Option<GoodId> {
        GoodId::ALL.into_iter().find(|g| g.as_str() == s)
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Mode {
    Play,
    Live,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Buy,
    Sell,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum WithdrawStatus {
    Pending,
    Sent,
    Done,
    Refunded,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JourneyStatus {
    InTransit,
    Claimed,
}

// ---------- stored records ----------

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Journey {
    pub id: u64,
    pub from: CityId,
    pub to: CityId,
    pub cargo: [u32; 5],
    pub guards: u8,
    pub started_at_ns: u64,
    pub arrives_at_ns: u64,
    pub risk_bp: u32,
    pub status: JourneyStatus,
    pub ambushed: bool,
    pub lost: [u32; 5],
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Player {
    pub fils: u128,
    pub location: CityId,
    pub goods: [u32; 5],
    pub last_faucet_ns: Option<u64>,
    pub withdrawn_today: u128,
    pub withdraw_day: u64,
    pub total_deposited: u128,
    pub stall_count: u32,
    /// Goods in this player's open stalls (escrow), per good.
    pub escrow: [u32; 5],
    /// The player's open (PENDING or SENT) withdrawal, if any. At most one at a time.
    pub open_withdraw: Option<u64>,
    /// Current journey (IN_TRANSIT) or the last claimed one (kept so the UI can show the result).
    pub journey: Option<Journey>,
}

impl Player {
    pub fn new() -> Self {
        Self {
            fils: 0,
            location: CityId::Bandar,
            goods: [0; 5],
            last_faucet_ns: None,
            withdrawn_today: 0,
            withdraw_day: 0,
            total_deposited: 0,
            stall_count: 0,
            escrow: [0; 5],
            open_withdraw: None,
            journey: None,
        }
    }

    pub fn in_transit(&self) -> bool {
        matches!(&self.journey, Some(j) if j.status == JourneyStatus::InTransit)
    }
}

impl Default for Player {
    fn default() -> Self {
        Self::new()
    }
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Merchant {
    pub account: AccountId,
    pub treasury: u128,
    pub stock: [u32; 5],
    pub spread_bp: u32,
    pub bias_bp: i32,
    pub last_policy_ns: Option<u64>,
    /// Tick number of the last `set_policy` (at most one change per tick).
    pub last_policy_tick: Option<u64>,
    /// Tick number of the last `ship` per good (one shipment per good per tick).
    pub last_ship_tick: [Option<u64>; 5],
    /// Tick in which `ship_in_paid` was accumulated (payments this merchant made for incoming
    /// merchant-initiated shipments).
    pub ship_in_tick: Option<u64>,
    pub ship_in_paid: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stall {
    pub id: u64,
    pub seller: AccountId,
    pub city: CityId,
    pub good: GoodId,
    pub qty: u32,
    pub unit_price: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Withdrawal {
    pub id: u64,
    pub account: AccountId,
    pub fils: u128,
    pub dest_asset: String,
    pub dest_address: String,
    pub status: WithdrawStatus,
    pub created_ns: u64,
    pub updated_ns: u64,
    pub reference: Option<String>,
}

// ---------- init args ----------

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MerchantAccounts {
    pub dasht: AccountId,
    pub madan: AccountId,
    pub bandar: AccountId,
    pub shahr: AccountId,
}

// ---------- JSON views ----------

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct GoodsView {
    pub grain: u32,
    pub salt: u32,
    pub iron: u32,
    pub spice: u32,
    pub silk: u32,
}

impl GoodsView {
    pub fn from_array(a: &[u32; 5]) -> Self {
        let [grain, salt, iron, spice, silk] = *a;
        Self { grain, salt, iron, spice, silk }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuoteView {
    pub bid: U128,
    pub mid: U128,
    pub ask: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuotesView {
    pub grain: QuoteView,
    pub salt: QuoteView,
    pub iron: QuoteView,
    pub spice: QuoteView,
    pub silk: QuoteView,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyView {
    pub spread_bp: u32,
    pub bias_bp: i32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerchantView {
    pub id: CityId,
    pub account_id: AccountId,
    pub treasury: U128,
    pub stock: GoodsView,
    pub policy: PolicyView,
    pub quotes: QuotesView,
    pub last_policy_ns: Option<U64>,
}

/// Times are nanoseconds as decimal strings (`_ns`); the server converts to unix seconds (spec 2.12).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JourneyView {
    pub id: u64,
    pub from: CityId,
    pub to: CityId,
    pub cargo: BTreeMap<GoodId, u32>,
    pub guards: u8,
    pub started_at_ns: U64,
    pub arrives_at_ns: U64,
    pub risk_bp: u32,
    /// "IN_TRANSIT" | "ARRIVED" | "CLAIMED"
    pub status: String,
    pub ambushed: Option<bool>,
    pub lost: Option<BTreeMap<GoodId, u32>>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerView {
    pub account_id: AccountId,
    pub fils: U128,
    pub location: CityId,
    pub inventory: GoodsView,
    pub journey: Option<JourneyView>,
    /// OPEN_QUESTIONS #2: fils + sum(qty x base) of the inventory.
    pub net_worth: U128,
    pub last_faucet_ns: Option<U64>,
    pub stall_count: u32,
    pub total_deposited: U128,
    pub withdrawn_today: U128,
    pub withdraw_day: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StallView {
    pub id: u64,
    pub seller: AccountId,
    pub city: CityId,
    pub good: GoodId,
    pub qty: u32,
    pub unit_price: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WithdrawalView {
    pub id: u64,
    pub account_id: AccountId,
    pub fils: U128,
    pub dest_asset: String,
    pub dest_address: String,
    pub status: WithdrawStatus,
    pub created_ns: U64,
    pub updated_ns: U64,
    pub reference: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorldView {
    pub tick: u64,
    pub now_ns: U64,
    pub last_tick_ns: U64,
    pub mode: Mode,
    pub paused: bool,
    pub house: U128,
    pub merchants: Vec<MerchantView>,
    pub player_count: u32,
    pub stall_count: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeResult {
    pub unit: U128,
    pub total: U128,
    pub fee: U128,
    pub player: PlayerView,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TickResult {
    /// Ticks applied by this call (0 = too early, no-op).
    pub ticks: u64,
    /// World tick counter after the call.
    pub tick: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreditResult {
    /// false: this `reference` was already credited, nothing changed.
    pub credited: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SolvencyView {
    pub seed_total: U128,
    pub total_deposited: U128,
    pub total_faucet: U128,
    pub total_withdrawn: U128,
    pub pending_withdrawals: U128,
    pub house: U128,
    pub merchant_treasuries: U128,
}

/// NEP-245 `Token` (https://github.com/near/NEPs/blob/master/neps/nep-0245.md).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MtToken {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub version: String,
    pub owner: AccountId,
    pub operator: AccountId,
    pub mode: Mode,
    pub paused: bool,
    pub max_players: u32,
    pub player_suffix: String,
    pub operator_daily_cap: U128,
    pub auto_ship: bool,
    pub merchant_accounts: Vec<AccountId>,
    pub tick_seconds: u64,
    pub tick_min_interval_seconds: u64,
    pub max_missed_ticks: u64,
    pub spread_default_bp: u32,
    pub spread_min_bp: u32,
    pub spread_max_bp: u32,
    pub bias_min_bp: i32,
    pub bias_max_bp: i32,
    pub trade_fee_bp: u32,
    pub max_qty_per_trade: u32,
    pub cargo_cap: u32,
    pub guard_cost_bp: u32,
    pub guard_risk_factor_bp: u32,
    pub max_guards: u8,
    pub ambush_loss_bp: u32,
    pub merchant_treasury_fils: U128,
    pub faucet_fils: U128,
    pub faucet_cooldown_seconds: u64,
    pub faucet_max_balance_fils: U128,
    pub max_deposit_fils: U128,
    pub daily_withdraw_cap_fils: U128,
    pub stall_fee_bp: u32,
    pub max_stalls_per_player: u32,
    pub npc_ship_units_per_tick: u32,
    pub npc_min_ratio_gap_bp: u32,
    pub policy_min_interval_seconds: u64,
    pub policy_max_step_bp: u32,
    pub ship_max_pay_pct: u32,
    pub min_withdraw_fils: U128,
}
