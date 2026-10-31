//! Property tests: random action sequences (many seeds) never break money conservation,
//! the goods counters, the stock bounds, and never panic (every failure is a mapped error).

use super::helpers::*;
use crate::errors::ErrorCode;
use crate::types::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn run(seed: u64, mode: Mode, steps: u32) -> [u32; 14] {
    let mut ok = [0u32; 14];
    let mut c = if seed % 2 == 0 { new_contract(mode) } else { new_contract_auto_ship(mode) };
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let n_players = 4u32;
    let mut now = T0;
    for i in 0..n_players {
        ctx(&player(i), now);
        c.try_register(player(i)).unwrap();
    }
    let mut ref_n = 0u64;
    let mut wids: Vec<u64> = Vec::new();
    for step in 0..steps {
        // try_* functions take the caller explicitly and only read the block time from the VM
        // context; building a context is slow, so time advances every 8 steps.
        if step % 8 == 0 {
            now += rng.below(300) * 1_000_000_000;
            ctx(&contract_id(), now);
        }
        let a = player(rng.below(u64::from(n_players)) as u32);
        let seed_bytes = rng.next().to_le_bytes();
        let g = GoodId::ALL[rng.below(5) as usize];
        let city = CityId::ALL[rng.below(4) as usize];
        let qty = (rng.below(45)) as u32;
        let kind = rng.below(14);
        let res: Result<(), crate::errors::CaravanError> = match kind {
            0 => c.try_faucet(a.clone()).map(|_| ()),
            1 | 2 => {
                let loc = c.players.get(&a).unwrap().location;
                let m = if rng.below(5) == 0 { city } else { loc };
                c.try_trade(a.clone(), m, g, Side::Buy, qty, if rng.below(4) == 0 { rng.below(100_000).into() } else { u128::MAX })
                    .map(|_| ())
            }
            3 | 4 => {
                let loc = c.players.get(&a).unwrap().location;
                c.try_trade(a.clone(), loc, g, Side::Sell, qty, rng.below(3).into()).map(|_| ())
            }
            5 => {
                let p = c.players.get(&a).unwrap().clone();
                let cargo = GoodId::ALL.iter().filter(|g| p.goods[g.idx()] > 0).map(|g| (*g, p.goods[g.idx()].min(20))).collect();
                c.try_start_journey(a.clone(), city, cargo, rng.below(5) as u8).map(|_| ())
            }
            6 => c.try_claim_journey(a.clone(), &seed_bytes).map(|_| ()),
            7 => c.try_stall_create(a.clone(), g, qty, rng.below(30_000).into()).map(|_| ()),
            8 => {
                let id = rng.below(c.next_stall_id.max(1));
                c.try_stall_buy(a.clone(), id, qty, u128::MAX).map(|_| ())
            }
            9 => {
                let id = rng.below(c.next_stall_id.max(1));
                c.try_stall_cancel(a.clone(), id).map(|_| ())
            }
            10 => {
                ref_n += 1;
                let r = format!("ref-{}", rng.below(ref_n + 1)); // sometimes a duplicate
                c.try_credit_deposit(operator(), a.clone(), rng.below(120_000).into(), r).map(|_| ())
            }
            11 => {
                let r = c.try_request_withdraw(a.clone(), rng.below(60_000).into(), "usdc".into(), "dest".into());
                if let Ok(id) = r {
                    wids.push(id);
                }
                r.map(|_| ())
            }
            12 => {
                if wids.is_empty() {
                    Ok(())
                } else {
                    let id = wids[rng.below(wids.len() as u64) as usize];
                    match rng.below(3) {
                        0 => c.try_refund_withdraw(operator(), id),
                        1 => c.try_mark_withdraw(operator(), id, WithdrawStatus::Sent, None),
                        _ => c.try_mark_withdraw(operator(), id, WithdrawStatus::Done, None),
                    }
                }
            }
            _ => {
                let m = merchant(city);
                if rng.below(2) == 0 {
                    c.try_world_tick().map(|_| ())
                } else if rng.below(2) == 0 {
                    let spread = 300 + rng.below(1800) as u32;
                    let bias = rng.below(3200) as i32 - 1600;
                    c.try_set_policy(m.clone(), spread, bias)
                } else {
                    c.try_ship(m.clone(), CityId::ALL[rng.below(4) as usize], g, 1 + rng.below(5) as u32).map(|_| ())
                }
            }
        };
        match &res {
            Ok(()) => ok[kind as usize] += 1,
            Err(e) => assert_ne!(e.code, ErrorCode::Internal, "seed {seed}: unexpected INTERNAL: {}", e.msg),
        }
        assert_money_conserved(&c);
        assert_goods_consistent(&c);
    }
    ok
}

fn sum(a: &mut [u32; 14], b: [u32; 14]) {
    for (x, y) in a.iter_mut().zip(b) {
        *x += y;
    }
}

#[test]
fn random_sequences_conserve_money_and_goods_play() {
    let mut ok = [0u32; 14];
    for seed in 1..=24 {
        sum(&mut ok, isolated(seed, Mode::Play, 400));
    }
    // the sequences really exercise the game: faucet, buy, sell, journey, claim, stalls, admin
    for k in [0usize, 1, 3, 5, 6, 7, 8, 9, 13] {
        assert!(ok[k] > 0, "action {k} never succeeded: {ok:?}");
    }
}

#[test]
fn random_sequences_conserve_money_and_goods_live() {
    let mut ok = [0u32; 14];
    for seed in 100..=124 {
        sum(&mut ok, isolated(seed, Mode::Live, 400));
    }
    for k in [1usize, 3, 5, 6, 10, 11, 12] {
        assert!(ok[k] > 0, "action {k} never succeeded: {ok:?}");
    }
}

/// The mocked blockchain keeps its storage per thread across `testing_env!` calls, so every
/// seed runs on a fresh thread (fresh storage).
fn isolated(seed: u64, mode: Mode, steps: u32) -> [u32; 14] {
    std::thread::spawn(move || run(seed, mode, steps)).join().expect("run panicked")
}
