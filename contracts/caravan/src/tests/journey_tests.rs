//! Journeys (guards, ambush, guards on claim) and player stalls.

use std::collections::BTreeMap;

use super::helpers::*;
use crate::errors::ErrorCode;
use crate::math::*;
use crate::types::*;

fn code<T: std::fmt::Debug>(r: crate::errors::CResult<T>) -> ErrorCode {
    r.unwrap_err().code
}

fn cargo(items: &[(GoodId, u32)]) -> BTreeMap<GoodId, u32> {
    items.iter().copied().collect()
}

/// Player `i` in bandar holding `qty` of `g` (bought from the merchant).
fn trader(c: &mut crate::Contract, i: u32, g: GoodId, qty: u32) -> near_sdk::AccountId {
    let a = with_player(c, i, 1_000_000);
    c.try_trade(a.clone(), CityId::Bandar, g, Side::Buy, qty, u128::MAX).unwrap();
    a
}

/// Finds a seed whose roll for (id, account) is below / not below `risk`.
fn seed_for(id: u64, account: &str, risk: u32, ambush: bool) -> [u8; 32] {
    for i in 0u8..=255 {
        for j in 0u8..=255 {
            let mut s = [0u8; 32];
            s[0] = i;
            s[1] = j;
            if (ambush_roll(&s, id, account) < risk) == ambush {
                return s;
            }
        }
    }
    panic!("no seed found");
}

#[test]
fn start_journey_charges_guards_and_moves_cargo() {
    let mut c = new_contract(Mode::Play);
    let a = trader(&mut c, 1, GoodId::Iron, 10);
    let fils = fils_of(&c, &a);
    let house = c.house;
    ctx(&a, T0);
    let j = c.try_start_journey(a.clone(), CityId::Shahr, cargo(&[(GoodId::Iron, 10)]), 2).unwrap();
    // base value 40,000; 2 guards x 2% = 1,600
    assert_eq!(fils_of(&c, &a), fils - 1600);
    assert_eq!(c.house, house + 1600);
    assert_eq!(goods_of(&c, &a, GoodId::Iron), 0);
    assert_eq!(j.risk_bp, 800 * 6500 / 10000 * 6500 / 10000);
    assert_eq!(j.status, "IN_TRANSIT");
    assert_eq!(j.arrives_at_ns.0, T0 + secs(180));
    assert_money_conserved(&c);
    assert_goods_consistent(&c);
}

#[test]
fn journey_guards() {
    let mut c = new_contract(Mode::Play);
    let a = trader(&mut c, 1, GoodId::Grain, 40);
    ctx(&a, T0);
    let s = |c: &mut crate::Contract, to, cg: &[(GoodId, u32)], g| code(c.try_start_journey(a.clone(), to, cargo(cg), g));
    assert_eq!(s(&mut c, CityId::Bandar, &[(GoodId::Grain, 1)], 0), ErrorCode::BadRequest); // same city
    assert_eq!(s(&mut c, CityId::Shahr, &[(GoodId::Grain, 1)], 4), ErrorCode::BadRequest); // > 3 guards
    assert_eq!(s(&mut c, CityId::Shahr, &[], 0), ErrorCode::BadRequest); // empty
    assert_eq!(s(&mut c, CityId::Shahr, &[(GoodId::Grain, 0)], 0), ErrorCode::BadRequest);
    assert_eq!(s(&mut c, CityId::Shahr, &[(GoodId::Grain, 41)], 0), ErrorCode::InsufficientStock);
    assert_eq!(s(&mut c, CityId::Shahr, &[(GoodId::Salt, 1)], 0), ErrorCode::InsufficientStock);
    // cargo over 40 (inventory can exceed 40 after a stall cancel)
    let mut p = c.players.get(&a).unwrap().clone();
    p.goods[GoodId::Salt.idx()] = 5;
    c.players.insert(a.clone(), p);
    c.player_goods[GoodId::Salt.idx()] += 5;
    assert_eq!(s(&mut c, CityId::Shahr, &[(GoodId::Grain, 40), (GoodId::Salt, 1)], 0), ErrorCode::CargoLimit);
    // guards too expensive
    let mut p = c.players.get(&a).unwrap().clone();
    let saved = p.fils;
    p.fils = 10;
    c.players.insert(a.clone(), p.clone());
    assert_eq!(s(&mut c, CityId::Shahr, &[(GoodId::Grain, 40)], 1), ErrorCode::InsufficientFunds);
    p.fils = saved;
    c.players.insert(a.clone(), p);
    // ok, then a second journey is rejected while in transit
    c.try_start_journey(a.clone(), CityId::Shahr, cargo(&[(GoodId::Grain, 40)]), 0).unwrap();
    assert_eq!(s(&mut c, CityId::Dasht, &[(GoodId::Salt, 1)], 0), ErrorCode::InTransit);
    assert_goods_consistent(&c);
}

#[test]
fn claim_before_arrival_fails_and_after_moves_player() {
    let mut c = new_contract(Mode::Play);
    let a = trader(&mut c, 1, GoodId::Grain, 20);
    ctx(&a, T0);
    assert_eq!(code(c.try_claim_journey(a.clone(), &[0; 32])), ErrorCode::BadRequest); // no journey
    let j = c.try_start_journey(a.clone(), CityId::Dasht, cargo(&[(GoodId::Grain, 20)]), 0).unwrap();
    ctx(&a, T0 + secs(269));
    assert_eq!(code(c.try_claim_journey(a.clone(), &[0; 32])), ErrorCode::NotArrived);
    assert_eq!(c.get_journey(a.clone()).unwrap().status, "IN_TRANSIT");
    ctx(&a, T0 + secs(270));
    assert_eq!(c.get_journey(a.clone()).unwrap().status, "ARRIVED");
    let seed = seed_for(j.id, a.as_str(), j.risk_bp, false);
    let r = c.try_claim_journey(a.clone(), &seed).unwrap();
    assert_eq!(r.journey.status, "CLAIMED");
    assert_eq!(r.journey.ambushed, Some(false));
    assert_eq!(r.player.location, CityId::Dasht);
    assert_eq!(goods_of(&c, &a, GoodId::Grain), 20);
    // second claim fails
    assert_eq!(code(c.try_claim_journey(a.clone(), &seed)), ErrorCode::BadRequest);
    // can trade in the new city
    c.try_trade(a.clone(), CityId::Dasht, GoodId::Grain, Side::Sell, 20, 0).unwrap();
    assert_money_conserved(&c);
    assert_goods_consistent(&c);
}

#[test]
fn ambush_destroys_floor_30_percent_of_each_good() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 1_000_000);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 11, u128::MAX).unwrap();
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Spice, Side::Buy, 3, u128::MAX).unwrap();
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Iron, Side::Buy, 20, u128::MAX).unwrap();
    ctx(&a, T0);
    let j = c
        .try_start_journey(a.clone(), CityId::Madan, cargo(&[(GoodId::Grain, 11), (GoodId::Spice, 3), (GoodId::Iron, 20)]), 0)
        .unwrap();
    let supply_before = c.supply(GoodId::Grain).unwrap();
    ctx(&a, T0 + secs(360));
    let seed = seed_for(j.id, a.as_str(), j.risk_bp, true);
    let r = c.try_claim_journey(a.clone(), &seed).unwrap();
    assert_eq!(r.journey.ambushed, Some(true));
    let lost = r.journey.lost.unwrap();
    assert_eq!(lost.get(&GoodId::Grain), Some(&3)); // floor(3.3)
    assert_eq!(lost.get(&GoodId::Spice), None); // floor(0.9) = 0
    assert_eq!(lost.get(&GoodId::Iron), Some(&6));
    assert_eq!(goods_of(&c, &a, GoodId::Grain), 8);
    assert_eq!(goods_of(&c, &a, GoodId::Spice), 3);
    assert_eq!(goods_of(&c, &a, GoodId::Iron), 14);
    assert_eq!(c.supply(GoodId::Grain).unwrap(), supply_before - 3);
    assert_money_conserved(&c);
    assert_goods_consistent(&c);
}

#[test]
fn claim_uses_env_random_seed() {
    let mut c = new_contract(Mode::Play);
    let a = trader(&mut c, 1, GoodId::Grain, 10);
    ctx(&a, T0);
    let j = c.try_start_journey(a.clone(), CityId::Madan, cargo(&[(GoodId::Grain, 10)]), 0).unwrap();
    let seed = seed_for(j.id, a.as_str(), j.risk_bp, true);
    ctx_full(&a, T0 + secs(400), near_sdk::NearToken::from_near(1000), seed);
    let r = c.claim_journey();
    assert_eq!(r.journey.ambushed, Some(true));
    assert_eq!(goods_of(&c, &a, GoodId::Grain), 7);
}

// ---------- stalls ----------

#[test]
fn stall_create_buy_fee_and_cancel() {
    let mut c = new_contract(Mode::Play);
    let s = trader(&mut c, 1, GoodId::Spice, 10);
    let b = with_player(&mut c, 2, 500_000);
    ctx(&s, T0);
    let st = c.try_stall_create(s.clone(), GoodId::Spice, 6, 12_000).unwrap();
    assert_eq!(goods_of(&c, &s, GoodId::Spice), 4);
    assert_eq!(c.get_stalls(Some(CityId::Bandar), None, None).len(), 1);
    assert_eq!(c.get_stalls(Some(CityId::Dasht), None, None).len(), 0);
    let seller_fils = fils_of(&c, &s);
    let buyer_fils = fils_of(&c, &b);
    let house = c.house;
    // slippage: limit below price + 2% fee
    assert_eq!(code(c.try_stall_buy(b.clone(), st.id, 2, 24_000 + 479)), ErrorCode::Slippage);
    c.try_stall_buy(b.clone(), st.id, 2, 24_000 + 480).unwrap();
    assert_eq!(fils_of(&c, &b), buyer_fils - 24_480);
    assert_eq!(fils_of(&c, &s), seller_fils + 24_000);
    assert_eq!(c.house, house + 480); // 200 bp of 24,000
    assert_eq!(goods_of(&c, &b, GoodId::Spice), 2);
    assert_eq!(c.stalls.get(&st.id).unwrap().qty, 4);
    // only the seller can cancel
    assert_eq!(code(c.try_stall_cancel(b.clone(), st.id)), ErrorCode::Unauthenticated);
    c.try_stall_cancel(s.clone(), st.id).unwrap();
    assert_eq!(goods_of(&c, &s, GoodId::Spice), 8);
    assert!(c.stalls.get(&st.id).is_none());
    assert_eq!(c.players.get(&s).unwrap().stall_count, 0);
    assert_money_conserved(&c);
    assert_goods_consistent(&c);
}

#[test]
fn stall_needs_both_parties_in_the_same_city() {
    let mut c = new_contract(Mode::Play);
    let s = trader(&mut c, 1, GoodId::Silk, 4);
    let b = with_player(&mut c, 2, 500_000);
    ctx(&s, T0);
    let st = c.try_stall_create(s.clone(), GoodId::Silk, 2, 20_000).unwrap();
    // buyer elsewhere
    set_location(&mut c, &b, CityId::Dasht);
    assert_eq!(code(c.try_stall_buy(b.clone(), st.id, 1, u128::MAX)), ErrorCode::NotInCity);
    set_location(&mut c, &b, CityId::Bandar);
    // seller left the city
    set_location(&mut c, &s, CityId::Shahr);
    assert_eq!(code(c.try_stall_buy(b.clone(), st.id, 1, u128::MAX)), ErrorCode::NotInCity);
    assert_eq!(code(c.try_stall_cancel(s.clone(), st.id)), ErrorCode::NotInCity);
    set_location(&mut c, &s, CityId::Bandar);
    // seller travelling
    c.try_start_journey(s.clone(), CityId::Shahr, cargo(&[(GoodId::Silk, 2)]), 0).unwrap();
    assert_eq!(code(c.try_stall_buy(b.clone(), st.id, 1, u128::MAX)), ErrorCode::NotInCity);
    assert_goods_consistent(&c);
}

#[test]
fn stall_rejections() {
    let mut c = new_contract(Mode::Play);
    let s = trader(&mut c, 1, GoodId::Grain, 20);
    let b = with_player(&mut c, 2, 10);
    ctx(&s, T0);
    assert_eq!(code(c.try_stall_create(s.clone(), GoodId::Grain, 0, 100)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_stall_create(s.clone(), GoodId::Grain, 1, 0)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_stall_create(s.clone(), GoodId::Grain, 1, MAX_STALL_UNIT_PRICE + 1)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_stall_create(s.clone(), GoodId::Grain, 21, 100)), ErrorCode::InsufficientStock);
    for _ in 0..MAX_STALLS_PER_PLAYER {
        c.try_stall_create(s.clone(), GoodId::Grain, 1, 100).unwrap();
    }
    assert_eq!(code(c.try_stall_create(s.clone(), GoodId::Grain, 1, 100)), ErrorCode::RateLimit);
    assert_eq!(code(c.try_stall_buy(s.clone(), 0, 1, u128::MAX)), ErrorCode::BadRequest); // own stall
    assert_eq!(code(c.try_stall_buy(b.clone(), 99, 1, u128::MAX)), ErrorCode::BadRequest); // no stall
    assert_eq!(code(c.try_stall_buy(b.clone(), 0, 2, u128::MAX)), ErrorCode::InsufficientStock);
    assert_eq!(code(c.try_stall_buy(b.clone(), 0, 1, u128::MAX)), ErrorCode::InsufficientFunds);
    // buying the last unit closes the stall and frees the seller's slot
    let mut p = c.players.get(&b).unwrap().clone();
    p.fils = 1000;
    c.players.insert(b.clone(), p);
    c.total_faucet += 990;
    c.try_stall_buy(b.clone(), 0, 1, u128::MAX).unwrap();
    assert!(c.stalls.get(&0).is_none());
    assert_eq!(c.players.get(&s).unwrap().stall_count, MAX_STALLS_PER_PLAYER - 1);
    assert_money_conserved(&c);
    assert_goods_consistent(&c);
}
