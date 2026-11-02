//! Golden vectors (spec/ECONOMY.md 2.7; spec-v1.2 PROPOSAL values, MULT_K_BP = 3000) and price math parity with
//! packages/shared/src/quote.ts.

use crate::math::*;

/// good, side, qty, merchant stock, spread, bias, unit, total, fee
type TradeVector = (GoodId, Side, u32, u32, u32, i32, u128, u128, u128);
use crate::types::*;

#[test]
fn golden_vectors_section_2_7() {
    // good, stock, spread_bp, bias_bp, bid, mid, ask  (spec/ECONOMY.md 2.7, verbatim, spec-v1.2 / K = 3000).
    // spec-v1.1 (K = 4000) had grain 0: 1296/1350/1404, iron 37: 4807/5008/5208, spice 55: 9827/10455/11082,
    // silk 12: 21873/22320/22766; the other three rows are unchanged (grain 200 at target, grain 400 and silk 60 on the low clamp).
    let rows: [(GoodId, i128, u32, i32, u128, u128, u128); 7] = [
        (GoodId::Grain, 0, 800, 0, 1248, 1300, 1352),
        (GoodId::Grain, 200, 800, 0, 960, 1000, 1040),
        (GoodId::Grain, 400, 800, 0, 720, 750, 780),
        (GoodId::Iron, 37, 800, 0, 4565, 4756, 4946),
        (GoodId::Spice, 55, 1200, 250, 10261, 10916, 11570),
        (GoodId::Silk, 12, 400, -1000, 20815, 21240, 21664),
        (GoodId::Silk, 60, 2000, 1500, 15525, 17250, 18975),
    ];
    for (g, stock, spread, bias, bid, mid, ask) in rows {
        let q = quote(g, stock, spread, bias).unwrap();
        assert_eq!((q.bid, q.mid, q.ask), (bid, mid, ask), "{} stock {stock}", g.as_str());
    }
}

#[test]
fn mult_bp_truncates_toward_zero() {
    // With K = 3000 every real target (30, 40, 100, 120, 200) divides 3000 x d exactly, so the truncation is
    // exercised with synthetic targets: 3000 * (7 - 8) / 7 = -428.57: truncation gives -428 (9572); floor would give 9571.
    assert_eq!(mult_bp(8, 7).unwrap(), 10000 - 428);
    assert_eq!(mult_bp(6, 7).unwrap(), 10000 + 428);
    // real targets: exact steps of 100 bp per unit for silk (target 30)
    assert_eq!(mult_bp(31, 30).unwrap(), 10000 - 100);
    assert_eq!(mult_bp(29, 30).unwrap(), 10000 + 100);
    // upper clamp is unreachable for stock >= 0 (max 13000) but still applies to out-of-range inputs
    assert_eq!(mult_bp(0, 30).unwrap(), 13000);
    assert_eq!(mult_bp(-1000, 30).unwrap(), 13500);
    // lower clamp binds from 183.3% of target: target 200, stock 366 -> 7510, stock 367 -> 7495 -> 7500
    assert_eq!(mult_bp(366, 200).unwrap(), 7510);
    assert_eq!(mult_bp(367, 200).unwrap(), 7500);
    assert_eq!(mult_bp(1000, 30).unwrap(), 7500);
}

#[test]
fn trade_cost_matches_reference_vectors() {
    // Generated from a LOCAL copy of scripts/ref/world.py quote() with MULT_K_BP = 3000 (spec-v1.2 PROPOSAL; scripts/ref itself
    // still says 4000) and cross-checked with tradeCost() in packages/shared: same inputs as spec-v1.1, new prices.
    // good, side, qty, merchant stock, spread, bias, unit, total, fee
    let rows: [TradeVector; 24] = [
        (GoodId::Grain, Side::Buy, 18, 89, 901, -586, 1159, 20862, 208),
        (GoodId::Grain, Side::Buy, 38, 53, 1264, -1370, 1145, 43510, 435),
        (GoodId::Grain, Side::Buy, 15, 28, 1434, 965, 1489, 22335, 223),
        (GoodId::Silk, Side::Buy, 35, 49, 1259, -598, 19586, 685510, 6855),
        (GoodId::Silk, Side::Sell, 1, 44, 1954, -847, 14204, 14204, 142),
        (GoodId::Spice, Side::Sell, 18, 61, 718, -619, 8410, 151380, 1513),
        (GoodId::Iron, Side::Buy, 6, 97, 1178, -1104, 3835, 23010, 230),
        (GoodId::Iron, Side::Sell, 3, 137, 1894, 381, 3330, 9990, 99),
        (GoodId::Grain, Side::Sell, 6, 321, 1530, -300, 728, 4368, 43),
        (GoodId::Silk, Side::Sell, 37, 2, 793, 1385, 24055, 890035, 8900),
        (GoodId::Grain, Side::Buy, 19, 70, 563, -547, 1173, 22287, 222),
        (GoodId::Spice, Side::Sell, 30, 10, 1701, -6, 12207, 366210, 3662),
        (GoodId::Iron, Side::Sell, 14, 179, 1772, -407, 2622, 36708, 367),
        (GoodId::Grain, Side::Buy, 35, 118, 1893, -498, 1193, 41755, 417),
        (GoodId::Spice, Side::Sell, 18, 35, 1710, 1318, 12047, 216846, 2168),
        (GoodId::Salt, Side::Sell, 4, 206, 869, -1369, 965, 3860, 38),
        (GoodId::Iron, Side::Sell, 18, 145, 535, -636, 3054, 54972, 549),
        (GoodId::Iron, Side::Buy, 32, 149, 1210, 1133, 4254, 136128, 1361),
        (GoodId::Salt, Side::Sell, 9, 137, 905, 799, 1464, 13176, 131),
        (GoodId::Iron, Side::Sell, 38, 56, 1217, -18, 4031, 153178, 1531),
        (GoodId::Salt, Side::Sell, 6, 220, 1947, -1308, 881, 5286, 52),
        (GoodId::Grain, Side::Buy, 11, 316, 1793, 229, 928, 10208, 102),
        (GoodId::Grain, Side::Sell, 25, 270, 1620, 417, 839, 20975, 209),
        (GoodId::Iron, Side::Buy, 8, 200, 1796, 699, 3497, 27976, 279),
    ];
    for (g, side, qty, stock, spread, bias, unit, total, fee) in rows {
        let c = trade_cost(g, side, qty, stock, spread, bias).unwrap();
        assert_eq!((c.unit, c.total, c.fee), (unit, total, fee), "{} {:?} {qty}@{stock}", g.as_str(), side);
    }
}

#[test]
fn quote_never_fails_in_policy_and_stock_range() {
    for g in GoodId::ALL {
        for stock in -40..=i128::from(cap(g)) + 40 {
            for (spread, bias) in [(400, -1500), (2000, 1500), (800, 0), (2000, -1500)] {
                let q = quote(g, stock, spread, bias).unwrap();
                assert!(q.bid <= q.mid && q.mid <= q.ask);
            }
        }
    }
}

#[test]
fn guards_multiply_risk_by_6500_bp() {
    for (a, b) in [
        (CityId::Bandar, CityId::Shahr),
        (CityId::Shahr, CityId::Dasht),
        (CityId::Dasht, CityId::Madan),
        (CityId::Madan, CityId::Bandar),
        (CityId::Bandar, CityId::Dasht),
        (CityId::Shahr, CityId::Madan),
    ] {
        let (_, base) = route(a, b).unwrap();
        assert_eq!(route(b, a).unwrap(), route(a, b).unwrap());
        assert_eq!(journey_risk_bp(base, 0).unwrap(), base);
        // single division of the spec formula equals the step-by-step version of the mock
        let mut step = base;
        for g in 1..=3u8 {
            step = step * 6500 / 10000;
            let r = journey_risk_bp(base, g).unwrap();
            assert_eq!(r, step, "route {}-{} guards {g}", a.as_str(), b.as_str());
            assert!(r < journey_risk_bp(base, g - 1).unwrap());
        }
    }
    assert_eq!(journey_risk_bp(800, 1).unwrap(), 520);
    assert_eq!(journey_risk_bp(2000, 3).unwrap(), 549);
    assert!(route(CityId::Dasht, CityId::Dasht).is_none());
}

#[test]
fn guard_cost_is_2_percent_of_base_value_per_guard() {
    let cargo = [10, 0, 5, 0, 1]; // 10 grain + 5 iron + 1 silk = 10000 + 20000 + 20000
    assert_eq!(base_value(&cargo).unwrap(), 50_000);
    assert_eq!(guard_cost(50_000, 0).unwrap(), 0);
    assert_eq!(guard_cost(50_000, 1).unwrap(), 1000);
    assert_eq!(guard_cost(50_000, 3).unwrap(), 3000);
}

#[test]
fn ambush_loss_is_floor_30_percent() {
    assert_eq!(ambush_loss(0).unwrap(), 0);
    assert_eq!(ambush_loss(1).unwrap(), 0);
    assert_eq!(ambush_loss(3).unwrap(), 0);
    assert_eq!(ambush_loss(4).unwrap(), 1);
    assert_eq!(ambush_loss(10).unwrap(), 3);
    assert_eq!(ambush_loss(11).unwrap(), 3); // reference sim would lose 4 (OPEN_QUESTIONS #6)
    assert_eq!(ambush_loss(40).unwrap(), 12);
}

#[test]
fn ambush_roll_is_pure_and_in_range() {
    let a = ambush_roll(&[1u8; 32], 5, "p1.players.test");
    assert_eq!(a, ambush_roll(&[1u8; 32], 5, "p1.players.test"));
    assert!(a < 10_000);
    // different inputs give (almost surely) different rolls
    let others = [
        ambush_roll(&[2u8; 32], 5, "p1.players.test"),
        ambush_roll(&[1u8; 32], 6, "p1.players.test"),
        ambush_roll(&[1u8; 32], 5, "p2.players.test"),
    ];
    assert!(others.iter().any(|r| *r != a));
    // roughly uniform: about 10% of 2000 rolls fall under 1000
    let under = (0..2000u64).filter(|i| ambush_roll(&[9u8; 32], *i, "x.test") < 1000).count();
    assert!((120..=280).contains(&under), "under = {under}");
}

#[test]
fn ship_gap_integer_test_ships_at_exactly_50_percent() {
    // OPEN_QUESTIONS #12: silk 21 vs 6 (target 30) is exactly a 50% gap; the integer test ships.
    assert!(ship_gap_ok(GoodId::Silk, 21, 6));
    assert!(!ship_gap_ok(GoodId::Silk, 20, 6));
    assert!(ship_gap_ok(GoodId::Grain, 300, 200));
    assert!(!ship_gap_ok(GoodId::Grain, 299, 200));
    assert!(!ship_gap_ok(GoodId::Grain, 100, 300));
}

#[test]
fn ship_payment_is_average_of_mids() {
    // grain mids (K = 3000): stock 300 -> 850, stock 100 -> 1150; average 1000 x 4
    assert_eq!(ship_payment(GoodId::Grain, 300, 100, 4).unwrap(), 4000);
}

#[test]
fn world_is_balanced() {
    // spec 2.3: total production equals total consumption per good
    for g in GoodId::ALL {
        let p: u32 = PRODUCTION.iter().map(|c| c[g.idx()]).sum();
        let c: u32 = CONSUMPTION.iter().map(|c| c[g.idx()]).sum();
        assert_eq!(p, c, "{}", g.as_str());
    }
}
