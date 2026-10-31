//! world_tick (section 2.8), set_policy, ship.

use super::helpers::*;
use crate::errors::ErrorCode;
use crate::math::*;
use crate::types::*;

fn code<T: std::fmt::Debug>(r: crate::errors::CResult<T>) -> ErrorCode {
    r.unwrap_err().code
}

#[test]
fn tick_is_a_noop_within_55_seconds() {
    let mut c = new_contract(Mode::Play);
    ctx(&player(9), T0 + secs(54));
    assert_eq!(c.world_tick().ticks, 0);
    assert_eq!(c.tick_count, 0);
    ctx(&player(9), T0 + secs(55));
    assert_eq!(c.world_tick().ticks, 1);
    ctx(&player(9), T0 + secs(100));
    assert_eq!(c.world_tick().ticks, 0); // 45 s after the last tick
    assert_eq!(c.tick_count, 1);
}

#[test]
fn tick_applies_at_most_10_missed_ticks() {
    let mut c = new_contract(Mode::Play);
    ctx(&player(9), T0 + secs(60 * 3));
    assert_eq!(c.world_tick().ticks, 3);
    ctx(&player(9), T0 + secs(60 * 3 + 3600));
    assert_eq!(c.world_tick().ticks, 10);
    assert_eq!(c.tick_count, 13);
    // more than 10 ticks were due: the excess is dropped, the 60 s phase is kept
    assert_eq!(c.last_tick_ns, T0 + secs(60 * 3 + 3600));
}

#[test]
fn tick_schedule_advances_by_whole_ticks() {
    // audit finding 10: last_tick_ns advances by n x 60 s, not to `now`
    let mut c = new_contract(Mode::Play);
    ctx(&player(9), T0 + secs(150));
    assert_eq!(c.world_tick().ticks, 2);
    assert_eq!(c.last_tick_ns, T0 + secs(120));
    ctx(&player(9), T0 + secs(175)); // 55 s after the schedule point
    assert_eq!(c.world_tick().ticks, 1);
    assert_eq!(c.last_tick_ns, T0 + secs(180));
    ctx(&player(9), T0 + secs(234)); // 54 s: too early
    assert_eq!(c.world_tick().ticks, 0);
    ctx(&player(9), T0 + secs(240));
    let r = c.world_tick();
    assert_eq!((r.ticks, r.tick), (1, 4));
    assert_eq!(c.last_tick_ns, T0 + secs(240));
    // 25 ticks late: 10 run, the schedule keeps its phase
    ctx(&player(9), T0 + secs(240 + 25 * 60 + 7));
    assert_eq!(c.world_tick().ticks, 10);
    assert_eq!(c.last_tick_ns, T0 + secs(240 + 25 * 60));
}

#[test]
fn production_and_consumption_with_clamp() {
    let mut c = new_contract(Mode::Play);
    c.merchants[CityId::Dasht.idx()].stock[GoodId::Grain.idx()] = 398;
    c.merchants[CityId::Madan.idx()].stock[GoodId::Grain.idx()] = 2;
    ctx(&player(9), T0 + secs(60));
    c.world_tick();
    let s = |c: &crate::Contract, city: CityId, g: GoodId| c.merchants[city.idx()].stock[g.idx()];
    assert_eq!(s(&c, CityId::Dasht, GoodId::Grain), 400); // clamped at cap
    assert_eq!(s(&c, CityId::Madan, GoodId::Grain), 0); // clamped at 0
    assert_eq!(s(&c, CityId::Dasht, GoodId::Salt), 123);
    assert_eq!(s(&c, CityId::Dasht, GoodId::Iron), 98);
    assert_eq!(s(&c, CityId::Shahr, GoodId::Salt), 117);
    assert_eq!(s(&c, CityId::Bandar, GoodId::Silk), 33);
}

#[test]
fn rebalancing_and_house_recycling() {
    let mut c = new_contract(Mode::Play);
    // dasht rich (100,000), shahr poorest (20,000); house 1,000. Total kept equal.
    c.merchants[0].treasury = 100_000;
    c.merchants[3].treasury = 20_000;
    c.seed_total = 100_000 + 50_000 + 50_000 + 20_000;
    c.house = 1000;
    c.total_faucet = 1000;
    ctx(&player(9), T0 + secs(60));
    c.world_tick();
    // dasht: excess over 75,000 is 25,000; 30% = 7,500 to shahr. House pays 10% = 100.
    assert_eq!(c.merchants[0].treasury, 92_500);
    assert_eq!(c.merchants[3].treasury, 20_000 + 7_500 + 100);
    assert_eq!(c.merchants[1].treasury, 50_000);
    assert_eq!(c.house, 900);
    assert_money_conserved(&c);
}

#[test]
fn poorest_tie_break_is_city_order() {
    let c = new_contract(Mode::Play);
    assert_eq!(c.poorest(), 0);
}

#[test]
fn auto_ship_moves_goods_at_exact_50_percent_gap() {
    let mut c = new_contract_auto_ship(Mode::Play);
    // Grain after step 1 (production/consumption) of the tick: dasht 292+8 = 300,
    // madan 204-4 = 200, bandar 203-3 = 200, shahr 201-1 = 200. Gap (300-200) x 10000 equals
    // 5000 x 200 exactly: the integer test ships (the float reference may not, OQ #12).
    // lo = madan (first of the tied minimums in city order).
    let g = GoodId::Grain.idx();
    c.merchants[CityId::Dasht.idx()].stock[g] = 292;
    c.merchants[CityId::Madan.idx()].stock[g] = 204;
    c.merchants[CityId::Bandar.idx()].stock[g] = 203;
    c.merchants[CityId::Shahr.idx()].stock[g] = 201;
    let pay = ship_payment(GoodId::Grain, 300, 200, 4).unwrap();
    assert_eq!(pay, 3600); // (800 + 1000) / 2 x 4
    ctx(&player(9), T0 + secs(60));
    c.world_tick();
    assert_eq!(c.merchants[CityId::Dasht.idx()].stock[g], 296);
    assert_eq!(c.merchants[CityId::Madan.idx()].stock[g], 204);
    // no other good has a 50% gap after one tick from target
    assert_eq!(c.merchants[0].treasury, MERCHANT_TREASURY_FILS + pay);
    assert_eq!(c.merchants[1].treasury, MERCHANT_TREASURY_FILS - pay);
    assert_money_conserved(&c);
}

#[test]
fn auto_ship_skips_when_destination_cannot_pay() {
    let mut c = new_contract_auto_ship(Mode::Play);
    // silk 21 vs 6 after step 1: gap is exactly 50% but 4 silk cost dasht 97,600 > 50,000.
    let s = GoodId::Silk.idx();
    c.merchants[CityId::Bandar.idx()].stock[s] = 18;
    c.merchants[CityId::Dasht.idx()].stock[s] = 7;
    assert!(ship_payment(GoodId::Silk, 21, 6, 4).unwrap() > MERCHANT_TREASURY_FILS);
    ctx(&player(9), T0 + secs(60));
    assert_eq!(c.world_tick().ticks, 1);
    assert_eq!(c.merchants[CityId::Bandar.idx()].stock[s], 21);
    assert_eq!(c.merchants[CityId::Dasht.idx()].stock[s], 6);
    assert_money_conserved(&c);
}

#[test]
fn simulation_240_ticks_conserves_money_every_tick() {
    let mut c = new_contract_auto_ship(Mode::Play);
    let mut players = Vec::new();
    for i in 0..5 {
        players.push(with_player(&mut c, i, 50_000));
    }
    let mut rng = 7u64;
    let mut next = || {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        rng
    };
    for t in 1..=240u64 {
        let now = T0 + secs(60 * t);
        ctx(&player(99), now);
        assert_eq!(c.try_world_tick().unwrap().ticks, 1);
        for a in &players {
            let r = next();
            let p = c.players.get(a).unwrap().clone();
            if p.in_transit() {
                let _ = c.try_claim_journey(a.clone(), &r.to_le_bytes());
                continue;
            }
            let g = GoodId::ALL[(r % 5) as usize];
            let qty = ((r >> 8) % 20 + 1) as u32;
            if p.goods.iter().sum::<u32>() > 0 && (r >> 16) % 2 == 0 {
                let to = CityId::ALL[((r >> 20) % 4) as usize];
                let cargo =
                    GoodId::ALL.iter().filter(|g| p.goods[g.idx()] > 0).map(|g| (*g, p.goods[g.idx()])).collect();
                let _ = c.try_start_journey(a.clone(), to, cargo, ((r >> 24) % 4) as u8);
            } else {
                let side = if (r >> 30) % 2 == 0 { Side::Buy } else { Side::Sell };
                let _ = c.try_trade(a.clone(), p.location, g, side, qty, if side == Side::Buy { u128::MAX } else { 0 });
            }
        }
        assert_money_conserved(&c);
        assert_goods_consistent(&c);
    }
    assert_eq!(c.tick_count, 240);
}

// ---------- set_policy ----------

#[test]
fn set_policy_bounds_and_rate_limit() {
    let mut c = new_contract(Mode::Play);
    let m = merchant(CityId::Madan);
    ctx(&m, T0);
    assert_eq!(code(c.try_set_policy(m.clone(), 399, 0)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_set_policy(m.clone(), 2001, 0)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_set_policy(m.clone(), 800, -1501)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_set_policy(m.clone(), 800, 1501)), ErrorCode::BadRequest);
    // audit finding 4: at most 300 bp per change for spread and for bias
    assert_eq!(code(c.try_set_policy(m.clone(), 1101, 0)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_set_policy(m.clone(), 800, -301)), ErrorCode::BadRequest);
    c.try_set_policy(m.clone(), 1100, -300).unwrap();
    assert_eq!(c.merchants[1].spread_bp, 1100);
    assert_eq!(c.merchants[1].bias_bp, -300);
    // once per 60 s ...
    ctx(&m, T0 + secs(59));
    assert_eq!(code(c.try_set_policy(m.clone(), 1000, -200)), ErrorCode::RateLimit);
    // ... and once per tick (no tick happened yet)
    ctx(&m, T0 + secs(61));
    assert_eq!(code(c.try_set_policy(m.clone(), 1000, -200)), ErrorCode::RateLimit);
    c.try_world_tick().unwrap();
    c.try_set_policy(m.clone(), 1000, 0).unwrap();
    // quotes follow the policy
    let q = c.get_quotes(CityId::Madan);
    let expect = quote(GoodId::Iron, i128::from(c.merchants[1].stock[GoodId::Iron.idx()]), 1000, 0).unwrap();
    assert_eq!(q.iron.ask.0, expect.ask);
    // bias can climb only 300 bp per tick: 0 -> 1500 takes 5 ticks
    let mut bias = 0;
    let mut t = 61;
    while bias < 1500 {
        t += 60;
        ctx(&m, T0 + secs(t));
        c.try_world_tick().unwrap();
        bias += 300;
        c.try_set_policy(m.clone(), 1000, bias).unwrap();
    }
    assert_eq!(c.merchants[1].bias_bp, 1500);
}

// ---------- ship ----------

#[test]
fn ship_rules() {
    let mut c = new_contract(Mode::Play);
    let dasht = merchant(CityId::Dasht);
    ctx(&dasht, T0);
    // no gap at start (all at target)
    assert_eq!(code(c.try_ship(dasht.clone(), CityId::Madan, GoodId::Grain, 4)), ErrorCode::BadRequest);
    c.merchants[0].stock[GoodId::Grain.idx()] = 300;
    c.merchants[1].stock[GoodId::Grain.idx()] = 100;
    assert_eq!(code(c.try_ship(dasht.clone(), CityId::Dasht, GoodId::Grain, 4)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_ship(dasht.clone(), CityId::Madan, GoodId::Grain, 5)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_ship(dasht.clone(), CityId::Madan, GoodId::Grain, 0)), ErrorCode::BadRequest);
    let pay = c.try_ship(dasht.clone(), CityId::Madan, GoodId::Grain, 4).unwrap();
    assert_eq!(pay, 4000);
    assert_eq!(c.merchants[0].stock[0], 296);
    assert_eq!(c.merchants[1].stock[0], 104);
    assert_eq!(c.merchants[0].treasury, 54_000);
    assert_eq!(c.merchants[1].treasury, 46_000);
    // once per good per tick
    assert_eq!(code(c.try_ship(dasht.clone(), CityId::Madan, GoodId::Grain, 4)), ErrorCode::RateLimit);
    ctx(&dasht, T0 + secs(60));
    c.try_world_tick().unwrap();
    c.merchants[1].treasury = 100;
    c.seed_total -= 45_900;
    // 4,000 > 25% of 100: blocked by the per-tick budget before the treasury check
    assert_eq!(code(c.try_ship(dasht.clone(), CityId::Madan, GoodId::Grain, 4)), ErrorCode::RateLimit);
    assert_money_conserved(&c);
}

#[test]
fn ship_needs_destination_deficit_and_respects_budget() {
    // audit finding 6
    let mut c = new_contract(Mode::Play);
    let g = GoodId::Grain.idx();
    // gap >= 50% but the destination is at target: not short, rejected
    c.merchants[0].stock[g] = 320;
    c.merchants[1].stock[g] = 200;
    ctx(&merchant(CityId::Dasht), T0);
    assert_eq!(code(c.try_ship(merchant(CityId::Dasht), CityId::Madan, GoodId::Grain, 4)), ErrorCode::BadRequest);
    // madan short of grain; three merchants ship to it in one tick: budget 25% of 12,000 = 3,000
    c.merchants[1].stock[g] = 20;
    c.merchants[2].stock[g] = 300;
    c.merchants[3].stock[g] = 300;
    c.merchants[1].treasury = 12_000;
    c.seed_total -= 38_000;
    let p1 = c.try_ship(merchant(CityId::Dasht), CityId::Madan, GoodId::Grain, 2).unwrap();
    assert!(p1 <= 3_000);
    let r = c.try_ship(merchant(CityId::Bandar), CityId::Madan, GoodId::Grain, 2);
    assert!(p1 + ship_payment(GoodId::Grain, 300, 22, 2).unwrap() > 3_000);
    assert_eq!(code(r), ErrorCode::RateLimit);
    // next tick the budget resets
    ctx(&merchant(CityId::Bandar), T0 + secs(60));
    c.try_world_tick().unwrap();
    c.try_ship(merchant(CityId::Bandar), CityId::Madan, GoodId::Grain, 1).unwrap();
    assert_money_conserved(&c);
}
