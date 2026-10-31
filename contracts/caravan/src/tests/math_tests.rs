//! Golden vectors (spec/ECONOMY.md 2.7) and price math parity with packages/shared/src/quote.ts.

use crate::math::*;
use crate::types::*;

#[test]
fn golden_vectors_section_2_7() {
    // good, stock, spread_bp, bias_bp, bid, mid, ask  (spec/ECONOMY.md 2.7, verbatim)
    let rows: [(GoodId, i128, u32, i32, u128, u128, u128); 7] = [
        (GoodId::Grain, 0, 800, 0, 1296, 1350, 1404),
        (GoodId::Grain, 200, 800, 0, 960, 1000, 1040),
        (GoodId::Grain, 400, 800, 0, 720, 750, 780),
        (GoodId::Iron, 37, 800, 0, 4807, 5008, 5208),
        (GoodId::Spice, 55, 1200, 250, 9827, 10455, 11082),
        (GoodId::Silk, 12, 400, -1000, 21873, 22320, 22766),
        (GoodId::Silk, 60, 2000, 1500, 15525, 17250, 18975),
    ];
    for (g, stock, spread, bias, bid, mid, ask) in rows {
        let q = quote(g, stock, spread, bias).unwrap();
        assert_eq!((q.bid, q.mid, q.ask), (bid, mid, ask), "{} stock {stock}", g.as_str());
    }
}

#[test]
fn mult_bp_truncates_toward_zero() {
    // 4000 * (30 - 31) / 30 = -133.33: truncation gives -133 (9867); floor would give 9866.
    assert_eq!(mult_bp(31, 30).unwrap(), 10000 - 133);
    assert_eq!(mult_bp(29, 30).unwrap(), 10000 + 133);
    assert_eq!(mult_bp(-1000, 30).unwrap(), 13500);
    assert_eq!(mult_bp(1000, 30).unwrap(), 7500);
}

#[test]
fn trade_cost_matches_reference_vectors() {
    // Generated from scripts/ref/world.py quote() (same math as packages/shared tradeCost()):
    // good, side, qty, merchant stock, spread, bias, unit, total, fee
    let rows: [(GoodId, Side, u32, u32, u32, i32, u128, u128, u128); 24] = [
        (GoodId::Grain, Side::Buy, 18, 89, 901, -586, 1219, 21942, 219),
        (GoodId::Grain, Side::Buy, 38, 53, 1264, -1370, 1221, 46398, 463),
        (GoodId::Grain, Side::Buy, 15, 28, 1434, 965, 1586, 23790, 237),
        (GoodId::Silk, Side::Buy, 35, 49, 1259, -598, 19454, 680890, 6808),
        (GoodId::Silk, Side::Sell, 1, 44, 1954, -847, 13435, 13435, 134),
        (GoodId::Spice, Side::Sell, 18, 61, 718, -619, 8138, 146484, 1464),
        (GoodId::Iron, Side::Buy, 6, 97, 1178, -1104, 3857, 23142, 231),
        (GoodId::Iron, Side::Sell, 3, 137, 1894, 381, 3187, 9561, 95),
        (GoodId::Grain, Side::Sell, 6, 321, 1530, -300, 673, 4038, 40),
        (GoodId::Silk, Side::Sell, 37, 2, 793, 1385, 24783, 916971, 9169),
        (GoodId::Grain, Side::Buy, 19, 70, 563, -547, 1241, 23579, 235),
        (GoodId::Spice, Side::Sell, 30, 10, 1701, -6, 12618, 378540, 3785),
        (GoodId::Iron, Side::Sell, 14, 179, 1772, -407, 2622, 36708, 367),
        (GoodId::Grain, Side::Buy, 35, 118, 1893, -498, 1245, 43575, 435),
        (GoodId::Spice, Side::Sell, 18, 35, 1710, 1318, 11923, 214614, 2146),
        (GoodId::Salt, Side::Sell, 4, 206, 869, -1369, 927, 3708, 37),
        (GoodId::Iron, Side::Sell, 18, 145, 535, -636, 2857, 51426, 514),
        (GoodId::Iron, Side::Buy, 32, 149, 1210, 1133, 4098, 131136, 1311),
        (GoodId::Salt, Side::Sell, 9, 137, 905, 799, 1437, 12933, 129),
        (GoodId::Iron, Side::Sell, 38, 56, 1217, -18, 4124, 156712, 1567),
        (GoodId::Salt, Side::Sell, 6, 220, 1947, -1308, 881, 5286, 52),
        (GoodId::Grain, Side::Buy, 11, 316, 1793, 229, 866, 9526, 95),
        (GoodId::Grain, Side::Sell, 25, 270, 1620, 417, 799, 19975, 199),
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
    // grain mids: stock 300 -> 800, stock 100 -> 1200; average 1000 x 4
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
