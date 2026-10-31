#![allow(dead_code)]

use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

use crate::Contract;
use crate::math::NS_PER_SEC;
use crate::types::*;

pub const T0: u64 = 1_800_000_000 * NS_PER_SEC;

pub fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

pub fn contract_id() -> AccountId {
    acc("caravan.test")
}
pub fn owner() -> AccountId {
    acc("owner.test")
}
pub fn operator() -> AccountId {
    acc("operator.test")
}
pub fn merchant(c: CityId) -> AccountId {
    acc(&format!("{}.caravan.test", c.as_str()))
}
pub fn player(i: u32) -> AccountId {
    acc(&format!("p{i}.players.test"))
}

/// Sets the VM context: caller, time (ns) and contract balance (yoctoNEAR).
pub fn ctx_full(predecessor: &AccountId, now_ns: u64, balance: NearToken, seed: [u8; 32]) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor.clone())
        .block_timestamp(now_ns)
        .account_balance(balance)
        .random_seed(seed);
    testing_env!(b.build());
}

pub fn ctx(predecessor: &AccountId, now_ns: u64) {
    ctx_full(predecessor, now_ns, NearToken::from_near(1000), [7u8; 32]);
}

pub fn secs(s: u64) -> u64 {
    s * NS_PER_SEC
}

pub fn merchant_accounts() -> MerchantAccounts {
    MerchantAccounts {
        dasht: merchant(CityId::Dasht),
        madan: merchant(CityId::Madan),
        bandar: merchant(CityId::Bandar),
        shahr: merchant(CityId::Shahr),
    }
}

pub fn new_contract(mode: Mode) -> Contract {
    ctx(&contract_id(), T0);
    Contract::init(owner(), operator(), mode, merchant_accounts(), 1000, None, None, None)
}

pub fn new_contract_auto_ship(mode: Mode) -> Contract {
    ctx(&contract_id(), T0);
    Contract::init(owner(), operator(), mode, merchant_accounts(), 1000, None, None, Some(true))
}

/// Registers player `i` and gives it `fils` directly (test setup only).
pub fn with_player(c: &mut Contract, i: u32, fils: u128) -> AccountId {
    let a = player(i);
    c.try_register(a.clone()).unwrap();
    let mut p = c.players.get(&a).unwrap().clone();
    p.fils = fils;
    c.players.insert(a.clone(), p);
    // Count the injected money as faucet money so the solvency invariant stays exact.
    c.total_faucet += fils;
    a
}

pub fn set_location(c: &mut Contract, a: &AccountId, city: CityId) {
    let mut p = c.players.get(a).unwrap().clone();
    p.location = city;
    c.players.insert(a.clone(), p);
}

pub fn fils_of(c: &Contract, a: &AccountId) -> u128 {
    c.players.get(a).unwrap().fils
}

pub fn goods_of(c: &Contract, a: &AccountId, g: GoodId) -> u32 {
    c.players.get(a).unwrap().goods[g.idx()]
}

/// Money invariant (plan 5.3): players + treasuries + house + pending withdrawals
/// = seed + deposits + faucet - withdrawn (DONE).
pub fn assert_money_conserved(c: &Contract) {
    let players: u128 = c.players.iter().map(|(_, p)| p.fils).sum();
    let treasuries: u128 = c.merchants.iter().map(|m| m.treasury).sum();
    let lhs = players + treasuries + c.house + c.pending_withdrawals;
    let rhs = c.seed_total + c.total_deposited + c.total_faucet - c.total_withdrawn;
    assert_eq!(lhs, rhs, "money not conserved");
}

/// Goods invariant: the `player_goods` counter equals inventories + stalls + caravans,
/// and merchant stock stays within [0, cap].
pub fn assert_goods_consistent(c: &Contract) {
    for g in GoodId::ALL {
        let i = g.idx();
        let mut held: u64 = 0;
        for (_, p) in c.players.iter() {
            held += u64::from(p.goods[i]);
            if let Some(j) = p.journey.as_ref().filter(|j| j.status == JourneyStatus::InTransit) {
                held += u64::from(j.cargo[i]);
            }
        }
        for (_, s) in c.stalls.iter() {
            if s.good == g {
                held += u64::from(s.qty);
            }
        }
        assert_eq!(held, c.player_goods[i], "player goods counter for {}", g.as_str());
        for m in &c.merchants {
            assert!(m.stock[i] <= crate::math::cap(g));
        }
    }
}
