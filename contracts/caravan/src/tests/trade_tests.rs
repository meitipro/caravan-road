//! register, faucet and trade rules.

use near_sdk::NearToken;

use super::helpers::*;
use crate::errors::ErrorCode;
use crate::math::*;
use crate::types::*;

fn code<T: std::fmt::Debug>(r: crate::errors::CResult<T>) -> ErrorCode {
    r.unwrap_err().code
}

#[test]
fn register_is_idempotent_and_starts_in_bandar() {
    let mut c = new_contract(Mode::Play);
    ctx(&player(1), T0);
    let v = c.register();
    assert_eq!(v.location, CityId::Bandar);
    assert_eq!(v.fils.0, 0);
    let v2 = c.register();
    assert_eq!(v, v2);
    assert_eq!(c.players.len(), 1);
}

#[test]
fn register_rejects_reserved_accounts() {
    let mut c = new_contract(Mode::Play);
    for a in [owner(), operator(), merchant(CityId::Dasht), contract_id()] {
        assert_eq!(code(c.try_register(a)), ErrorCode::Unauthenticated);
    }
}

#[test]
fn register_enforces_suffix_and_player_cap() {
    ctx(&contract_id(), T0);
    let mut c = crate::Contract::init(
        owner(),
        operator(),
        Mode::Play,
        merchant_accounts(),
        2,
        SUFFIX.into(),
        near_sdk::json_types::U128(OP_CAP),
        None,
    );
    assert_eq!(code(c.try_register(acc("evil.test"))), ErrorCode::Unauthenticated);
    assert_eq!(code(c.try_register(acc("players.test"))), ErrorCode::Unauthenticated);
    assert_eq!(code(c.try_register(acc("xplayers.test"))), ErrorCode::Unauthenticated);
    c.try_register(player(1)).unwrap();
    c.try_register(player(2)).unwrap();
    assert_eq!(code(c.try_register(player(3))), ErrorCode::BadRequest); // player limit
    c.try_register(player(1)).unwrap(); // existing player still idempotent
    // audit finding 2: the owner (only) can raise the cap; never below the current count
    for s in [operator(), player(1), merchant(CityId::Dasht)] {
        assert_eq!(code(c.try_set_max_players(s, 10)), ErrorCode::Unauthenticated);
    }
    assert_eq!(code(c.try_set_max_players(owner(), 1)), ErrorCode::BadRequest);
    c.try_set_max_players(owner(), 3).unwrap();
    c.try_register(player(3)).unwrap();
    assert_eq!(c.get_config().max_players, 3);
}

#[test]
fn player_suffix_accepts_a_leading_dot() {
    // audit finding 3: the server documents the suffix as `.<RELAYER_ACCOUNT_ID>`
    ctx(&contract_id(), T0);
    let mut c = crate::Contract::init(
        owner(),
        operator(),
        Mode::Play,
        merchant_accounts(),
        10,
        ".players.test".into(),
        near_sdk::json_types::U128(OP_CAP),
        None,
    );
    assert_eq!(c.get_config().player_suffix, "players.test");
    c.try_register(player(1)).unwrap();
    assert_eq!(code(c.try_register(acc("p1.other.test"))), ErrorCode::Unauthenticated);
    for bad in ["", ".", "..x", "a", "Players.test", "x.", &"a".repeat(65)] {
        assert!(crate::Contract::normalize_suffix(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn faucet_uses_net_worth_including_escrow_and_cargo() {
    // audit finding 5: goods (inventory, stall escrow, caravan) count toward the 50-dinar limit
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 6_000);
    ctx(&a, T0);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Iron, Side::Buy, 1, u128::MAX).unwrap(); // ~4,200
    assert!(fils_of(&c, &a) < FAUCET_MAX_BALANCE_FILS);
    assert_eq!(code(c.try_faucet(a.clone())), ErrorCode::BadRequest); // fils + 4,000 base value
    // the iron in a stall (escrow) still counts
    c.try_stall_create(a.clone(), GoodId::Iron, 1, 9_999).unwrap();
    assert_eq!(code(c.try_faucet(a.clone())), ErrorCode::BadRequest);
    c.try_stall_cancel(a.clone(), 0).unwrap();
    // the iron on a caravan still counts
    c.try_start_journey(a.clone(), CityId::Shahr, [(GoodId::Iron, 1)].into_iter().collect(), 0).unwrap();
    assert_eq!(code(c.try_faucet(a.clone())), ErrorCode::BadRequest);
    // a player with only a little salt gets the faucet
    let b = with_player(&mut c, 2, 2_000);
    c.try_trade(b.clone(), CityId::Bandar, GoodId::Salt, Side::Buy, 1, u128::MAX).unwrap();
    c.try_faucet(b.clone()).unwrap();
    assert_money_conserved(&c);
}

#[test]
fn register_storage_full() {
    let mut c = new_contract(Mode::Play);
    ctx_full(&player(1), T0, NearToken::from_yoctonear(1), [0; 32]);
    let e = c.try_register(player(1)).unwrap_err();
    assert_eq!(e.code, ErrorCode::Internal);
    assert!(e.msg.contains("storage full"));
    assert!(c.players.get(&player(1)).is_none());
}

#[test]
#[should_panic(expected = "INTERNAL: storage full")]
fn register_storage_full_panics_with_code() {
    let mut c = new_contract(Mode::Play);
    ctx_full(&player(1), T0, NearToken::from_yoctonear(1), [0; 32]);
    c.register();
}

#[test]
fn faucet_rules() {
    let mut c = new_contract(Mode::Play);
    ctx(&player(1), T0);
    assert_eq!(code(c.try_faucet(player(1))), ErrorCode::Unauthenticated); // not registered
    c.register();
    let v = c.faucet();
    assert_eq!(v.fils.0, FAUCET_FILS);
    assert_eq!(c.total_faucet, FAUCET_FILS);
    // balance >= 50 dinars
    assert_eq!(code(c.try_faucet(player(1))), ErrorCode::BadRequest);
    // spend down below 5000 fils, still cooling down
    let mut p = c.players.get(&player(1)).unwrap().clone();
    p.fils = 4999;
    c.players.insert(player(1), p);
    c.total_faucet -= FAUCET_FILS - 4999; // keep test bookkeeping exact
    ctx(&player(1), T0 + secs(3599));
    assert_eq!(code(c.try_faucet(player(1))), ErrorCode::RateLimit);
    ctx(&player(1), T0 + secs(3600));
    assert_eq!(c.faucet().fils.0, 4999 + FAUCET_FILS);
    assert_money_conserved(&c);
}

#[test]
fn faucet_disabled_in_live() {
    let mut c = new_contract(Mode::Live);
    ctx(&player(1), T0);
    c.register();
    assert_eq!(code(c.try_faucet(player(1))), ErrorCode::ModeNotAllowed);
}

#[test]
fn buy_moves_money_and_goods_exactly() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&a, T0);
    // bandar grain stock 200, default policy: buy 10 at ask(195)
    let expect = trade_cost(GoodId::Grain, Side::Buy, 10, 200, 800, 0).unwrap();
    let r = c.trade(CityId::Bandar, GoodId::Grain, Side::Buy, 10, near_sdk::json_types::U128(1_000_000));
    assert_eq!((r.unit.0, r.total.0, r.fee.0), (expect.unit, expect.total, expect.fee));
    assert_eq!(r.unit.0, 1047); // midpoint stock 195: mult 10075 -> mid 1007 (1007.5) -> ask 1047.28 -> 1047 (spec-v1.1: 1050)
    assert_eq!(fils_of(&c, &a), 50_000 - expect.total - expect.fee);
    assert_eq!(goods_of(&c, &a, GoodId::Grain), 10);
    let m = &c.merchants[CityId::Bandar.idx()];
    assert_eq!(m.stock[GoodId::Grain.idx()], 190);
    assert_eq!(m.treasury, MERCHANT_TREASURY_FILS + expect.total);
    assert_eq!(c.house, expect.fee);
    assert_money_conserved(&c);
    assert_goods_consistent(&c);
}

#[test]
fn sell_moves_money_and_goods_exactly() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 200_000);
    ctx(&a, T0);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Iron, Side::Buy, 20, u128::MAX).unwrap();
    let before = fils_of(&c, &a);
    let house = c.house;
    let stock = c.merchants[2].stock[GoodId::Iron.idx()];
    let expect = trade_cost(GoodId::Iron, Side::Sell, 20, stock, 800, 0).unwrap();
    let r = c.try_trade(a.clone(), CityId::Bandar, GoodId::Iron, Side::Sell, 20, 0);
    let r = r.unwrap_or_else(|e| panic!("{}", e.message()));
    assert_eq!(r.total.0, expect.total);
    assert_eq!(fils_of(&c, &a), before + expect.total - expect.fee);
    assert_eq!(c.house, house + expect.fee);
    assert_eq!(goods_of(&c, &a, GoodId::Iron), 0);
    assert_money_conserved(&c);
    assert_goods_consistent(&c);
}

#[test]
fn trade_rejections() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&a, T0);
    let t = |c: &mut crate::Contract, m, g, s, q, l| code(c.try_trade(a.clone(), m, g, s, q, l));
    // qty limits
    assert_eq!(t(&mut c, CityId::Bandar, GoodId::Grain, Side::Buy, 0, u128::MAX), ErrorCode::BadRequest);
    assert_eq!(t(&mut c, CityId::Bandar, GoodId::Grain, Side::Buy, 41, u128::MAX), ErrorCode::BadRequest);
    // wrong city
    assert_eq!(t(&mut c, CityId::Dasht, GoodId::Grain, Side::Buy, 1, u128::MAX), ErrorCode::NotInCity);
    // slippage: limit one fils below the cost
    let cost = trade_cost(GoodId::Grain, Side::Buy, 5, 200, 800, 0).unwrap();
    assert_eq!(t(&mut c, CityId::Bandar, GoodId::Grain, Side::Buy, 5, cost.total + cost.fee - 1), ErrorCode::Slippage);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 5, cost.total + cost.fee).unwrap();
    // insufficient funds: silk x 3 costs > remaining
    assert_eq!(t(&mut c, CityId::Bandar, GoodId::Silk, Side::Buy, 3, u128::MAX), ErrorCode::InsufficientFunds);
    // sell more than held
    assert_eq!(t(&mut c, CityId::Bandar, GoodId::Grain, Side::Sell, 6, 0), ErrorCode::InsufficientStock);
    // sell slippage: ask for more than the proceeds
    assert_eq!(t(&mut c, CityId::Bandar, GoodId::Grain, Side::Sell, 5, u128::MAX), ErrorCode::Slippage);
    // cargo cap 40 units total
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 35, u128::MAX).unwrap();
    assert_eq!(t(&mut c, CityId::Bandar, GoodId::Salt, Side::Buy, 1, u128::MAX), ErrorCode::CargoLimit);
    assert_money_conserved(&c);
}

#[test]
fn merchant_stock_and_broke_and_warehouse() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 10_000_000);
    ctx(&a, T0);
    // insufficient merchant stock
    c.merchants[2].stock[GoodId::Silk.idx()] = 3;
    assert_eq!(
        code(c.try_trade(a.clone(), CityId::Bandar, GoodId::Silk, Side::Buy, 4, u128::MAX)),
        ErrorCode::InsufficientStock
    );
    // warehouse full: merchant at cap - 2, player sells 3
    let mut p = c.players.get(&a).unwrap().clone();
    p.goods[GoodId::Spice.idx()] = 30;
    c.players.insert(a.clone(), p);
    c.player_goods[GoodId::Spice.idx()] += 30;
    c.merchants[2].stock[GoodId::Spice.idx()] = 78;
    assert_eq!(code(c.try_trade(a.clone(), CityId::Bandar, GoodId::Spice, Side::Sell, 3, 0)), ErrorCode::BadRequest);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Spice, Side::Sell, 2, 0).unwrap();
    // merchant broke
    c.merchants[2].stock[GoodId::Spice.idx()] = 10;
    c.merchants[2].treasury = 1000;
    assert_eq!(code(c.try_trade(a.clone(), CityId::Bandar, GoodId::Spice, Side::Sell, 1, 0)), ErrorCode::MerchantBroke);
}

#[test]
fn trade_blocked_in_transit() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&a, T0);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Spice, Side::Buy, 2, u128::MAX).unwrap();
    let cargo = [(GoodId::Spice, 2)].into_iter().collect();
    c.try_start_journey(a.clone(), CityId::Shahr, cargo, 0).unwrap();
    assert_eq!(
        code(c.try_trade(a.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 1, u128::MAX)),
        ErrorCode::InTransit
    );
}

#[test]
#[should_panic(expected = "NOT_IN_CITY")]
fn trade_panics_with_error_code() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&a, T0);
    c.trade(CityId::Madan, GoodId::Grain, Side::Buy, 1, near_sdk::json_types::U128(u128::MAX));
}
