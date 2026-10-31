//! Deposits, withdrawals, pause, access control, mt_* views, init validation.

use near_sdk::json_types::U128;

use super::helpers::*;
use crate::errors::ErrorCode;
use crate::math::*;
use crate::types::*;

fn code<T: std::fmt::Debug>(r: crate::errors::CResult<T>) -> ErrorCode {
    r.unwrap_err().code
}

fn live_with_player() -> (crate::Contract, near_sdk::AccountId) {
    let mut c = new_contract(Mode::Live);
    let a = player(1);
    ctx(&a, T0);
    c.try_register(a.clone()).unwrap();
    (c, a)
}

#[test]
fn credit_deposit_is_idempotent_and_capped() {
    let (mut c, a) = live_with_player();
    let op = operator();
    ctx(&op, T0);
    assert!(c.try_credit_deposit(op.clone(), a.clone(), 120_000, "ref-1".into()).unwrap());
    assert_eq!(fils_of(&c, &a), 120_000);
    // duplicate reference: ignored, no credit
    assert!(!c.try_credit_deposit(op.clone(), a.clone(), 120_000, "ref-1".into()).unwrap());
    assert_eq!(fils_of(&c, &a), 120_000);
    // per-player total cap 200,000
    assert_eq!(code(c.try_credit_deposit(op.clone(), a.clone(), 80_001, "ref-2".into())), ErrorCode::RateLimit);
    assert!(c.try_credit_deposit(op.clone(), a.clone(), 80_000, "ref-2".into()).unwrap());
    assert_eq!(c.total_deposited, 200_000);
    // bad inputs
    assert_eq!(code(c.try_credit_deposit(op.clone(), a.clone(), 1, "".into())), ErrorCode::BadRequest);
    assert_eq!(code(c.try_credit_deposit(op.clone(), a.clone(), 0, "ref-3".into())), ErrorCode::BadRequest);
    assert_eq!(code(c.try_credit_deposit(op.clone(), player(7), 1, "ref-4".into())), ErrorCode::Unauthenticated);
    assert_money_conserved(&c);
}

#[test]
fn credit_deposit_operator_daily_cap() {
    ctx(&contract_id(), T0);
    let mut c = crate::Contract::init(owner(), operator(), Mode::Live, merchant_accounts(), 100, None, Some(U128(150_000)), None);
    let op = operator();
    for i in 1..=2 {
        ctx(&player(i), T0);
        c.try_register(player(i)).unwrap();
    }
    ctx(&op, T0);
    c.try_credit_deposit(op.clone(), player(1), 100_000, "a".into()).unwrap();
    assert_eq!(code(c.try_credit_deposit(op.clone(), player(2), 50_001, "b".into())), ErrorCode::RateLimit);
    c.try_credit_deposit(op.clone(), player(2), 50_000, "b".into()).unwrap();
    // next day the operator cap resets
    ctx(&op, T0 + secs(SECONDS_PER_DAY));
    c.try_credit_deposit(op.clone(), player(2), 100_000, "c".into()).unwrap();
    assert_money_conserved(&c);
}

#[test]
fn play_mode_closes_money_routes() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&operator(), T0);
    assert_eq!(code(c.try_credit_deposit(operator(), a.clone(), 1, "r".into())), ErrorCode::ModeNotAllowed);
    assert_eq!(code(c.try_request_withdraw(a.clone(), 1, "nep141:usdc".into(), "x.near".into())), ErrorCode::ModeNotAllowed);
}

#[test]
fn withdraw_daily_cap_rollover_and_debit_first() {
    let (mut c, a) = live_with_player();
    ctx(&operator(), T0);
    c.try_credit_deposit(operator(), a.clone(), 200_000, "d".into()).unwrap();
    ctx(&a, T0);
    let w = |c: &mut crate::Contract, f| c.try_request_withdraw(a.clone(), f, "nep141:usdc".into(), "dest.near".into());
    assert_eq!(code(w(&mut c, 0)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_request_withdraw(a.clone(), 1, "".into(), "d".into())), ErrorCode::BadRequest);
    assert_eq!(code(c.try_request_withdraw(a.clone(), 1, "x".into(), "d".repeat(257))), ErrorCode::BadRequest);
    let id = w(&mut c, 60_000).unwrap();
    assert_eq!(fils_of(&c, &a), 140_000); // debited immediately
    assert_eq!(c.pending_withdrawals, 60_000);
    assert_eq!(c.get_withdraw(id).unwrap().status, WithdrawStatus::Pending);
    assert_eq!(code(w(&mut c, 40_001)), ErrorCode::RateLimit);
    w(&mut c, 40_000).unwrap();
    assert_eq!(code(w(&mut c, 1)), ErrorCode::RateLimit);
    // next UTC day
    ctx(&a, T0 + secs(SECONDS_PER_DAY));
    w(&mut c, 100_000).unwrap();
    assert_eq!(fils_of(&c, &a), 0);
    ctx(&a, T0 + secs(2 * SECONDS_PER_DAY));
    assert_eq!(code(w(&mut c, 1)), ErrorCode::InsufficientFunds);
    assert_money_conserved(&c);
}

#[test]
fn withdraw_status_machine_and_refunds() {
    let (mut c, a) = live_with_player();
    let op = operator();
    ctx(&op, T0);
    c.try_credit_deposit(op.clone(), a.clone(), 100_000, "d".into()).unwrap();
    ctx(&a, T0);
    let w0 = c.try_request_withdraw(a.clone(), 30_000, "usdc".into(), "x".into()).unwrap();
    let w1 = c.try_request_withdraw(a.clone(), 20_000, "usdc".into(), "x".into()).unwrap();
    let w2 = c.try_request_withdraw(a.clone(), 10_000, "usdc".into(), "x".into()).unwrap();
    ctx(&op, T0);
    // invalid transitions
    assert_eq!(code(c.try_mark_withdraw(op.clone(), w0, WithdrawStatus::Done, None)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_mark_withdraw(op.clone(), w0, WithdrawStatus::Pending, None)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_mark_withdraw(op.clone(), w0, WithdrawStatus::Refunded, None)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_mark_withdraw(op.clone(), 99, WithdrawStatus::Sent, None)), ErrorCode::BadRequest);
    // w0: PENDING -> SENT -> DONE
    c.try_mark_withdraw(op.clone(), w0, WithdrawStatus::Sent, Some("tx1".into())).unwrap();
    c.try_mark_withdraw(op.clone(), w0, WithdrawStatus::Done, None).unwrap();
    assert_eq!(c.get_withdraw(w0).unwrap().status, WithdrawStatus::Done);
    assert_eq!(c.get_withdraw(w0).unwrap().reference.as_deref(), Some("tx1"));
    assert_eq!(c.total_withdrawn, 30_000);
    assert_eq!(code(c.try_refund_withdraw(op.clone(), w0)), ErrorCode::BadRequest); // DONE: no refund
    // w1: SENT -> REFUNDED restores the balance exactly; never twice
    c.try_mark_withdraw(op.clone(), w1, WithdrawStatus::Sent, None).unwrap();
    let before = fils_of(&c, &a);
    c.try_refund_withdraw(op.clone(), w1).unwrap();
    assert_eq!(fils_of(&c, &a), before + 20_000);
    assert_eq!(code(c.try_refund_withdraw(op.clone(), w1)), ErrorCode::BadRequest);
    assert_eq!(code(c.try_mark_withdraw(op.clone(), w1, WithdrawStatus::Done, None)), ErrorCode::BadRequest);
    // w2: PENDING -> REFUNDED
    c.try_refund_withdraw(op.clone(), w2).unwrap();
    assert_eq!(fils_of(&c, &a), 100_000 - 30_000);
    assert_eq!(c.pending_withdrawals, 0);
    assert_money_conserved(&c);
}

#[test]
fn pause_blocks_every_write_except_refund() {
    let (mut c, a) = live_with_player();
    ctx(&operator(), T0);
    c.try_credit_deposit(operator(), a.clone(), 100_000, "d".into()).unwrap();
    ctx(&a, T0);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 10, u128::MAX).unwrap();
    c.try_stall_create(a.clone(), GoodId::Grain, 2, 100).unwrap();
    let wid = c.try_request_withdraw(a.clone(), 1000, "usdc".into(), "x".into()).unwrap();
    // pause by owner
    ctx(&owner(), T0);
    c.set_paused(true);
    let p = ErrorCode::Paused;
    let m = merchant(CityId::Dasht);
    let b = player(2);
    assert_eq!(code(c.try_register(b.clone())), p);
    assert_eq!(code(c.try_faucet(a.clone())), p);
    assert_eq!(code(c.try_trade(a.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 1, u128::MAX)), p);
    assert_eq!(code(c.try_start_journey(a.clone(), CityId::Shahr, [(GoodId::Grain, 1)].into_iter().collect(), 0)), p);
    assert_eq!(code(c.try_claim_journey(a.clone(), &[0; 32])), p);
    assert_eq!(code(c.try_stall_create(a.clone(), GoodId::Grain, 1, 100)), p);
    assert_eq!(code(c.try_stall_buy(b.clone(), 0, 1, u128::MAX)), p);
    assert_eq!(code(c.try_stall_cancel(a.clone(), 0)), p);
    assert_eq!(code(c.try_request_withdraw(a.clone(), 1, "usdc".into(), "x".into())), p);
    assert_eq!(code(c.try_set_policy(m.clone(), 800, 0)), p);
    assert_eq!(code(c.try_ship(m.clone(), CityId::Madan, GoodId::Grain, 1)), p);
    ctx(&player(9), T0 + secs(120));
    assert_eq!(code(c.try_world_tick()), p);
    assert_eq!(code(c.try_credit_deposit(operator(), a.clone(), 1, "e".into())), p);
    assert_eq!(code(c.try_mark_withdraw(operator(), wid, WithdrawStatus::Sent, None)), p);
    // refund still works while paused
    let before = fils_of(&c, &a);
    c.try_refund_withdraw(operator(), wid).unwrap();
    assert_eq!(fils_of(&c, &a), before + 1000);
    // operator can unpause
    ctx(&operator(), T0);
    c.set_paused(false);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 1, u128::MAX).unwrap();
    assert_money_conserved(&c);
}

#[test]
#[should_panic(expected = "PAUSED")]
fn paused_trade_panics_with_code() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&owner(), T0);
    c.set_paused(true);
    ctx(&a, T0);
    c.trade(CityId::Bandar, GoodId::Grain, Side::Buy, 1, U128(u128::MAX));
}

#[test]
fn access_control_rejects_wrong_accounts() {
    let (mut c, a) = live_with_player();
    let u = ErrorCode::Unauthenticated;
    let m = merchant(CityId::Dasht);
    let strangers = [a.clone(), owner(), m.clone(), acc("random.test")];
    // operator-only
    for s in &strangers {
        ctx(s, T0);
        assert_eq!(code(c.try_credit_deposit(s.clone(), a.clone(), 1, "r".into())), u);
        assert_eq!(code(c.try_mark_withdraw(s.clone(), 0, WithdrawStatus::Sent, None)), u);
        assert_eq!(code(c.try_refund_withdraw(s.clone(), 0)), u);
    }
    // owner or operator
    for s in [a.clone(), m.clone(), acc("random.test")] {
        assert_eq!(code(c.try_set_paused(s, true)), u);
    }
    // owner only
    for s in [a.clone(), m.clone(), operator()] {
        assert_eq!(code(c.try_set_operator(s, acc("new-op.test"))), u);
    }
    // merchant only
    for s in [a.clone(), owner(), operator(), acc("random.test")] {
        assert_eq!(code(c.try_set_policy(s.clone(), 800, 0)), u);
        assert_eq!(code(c.try_ship(s.clone(), CityId::Madan, GoodId::Grain, 1)), u);
    }
    // player methods need a registered player (merchants/operator cannot play)
    for s in [m.clone(), operator(), owner()] {
        assert_eq!(code(c.try_trade(s.clone(), CityId::Bandar, GoodId::Grain, Side::Buy, 1, u128::MAX)), u);
        assert_eq!(code(c.try_request_withdraw(s.clone(), 1, "x".into(), "y".into())), u);
        assert_eq!(code(c.try_claim_journey(s.clone(), &[0; 32])), u);
    }
    // the right accounts succeed
    ctx(&owner(), T0);
    c.try_set_operator(owner(), acc("new-op.test")).unwrap();
    assert_eq!(code(c.try_credit_deposit(operator(), a.clone(), 1, "r".into())), u); // old operator revoked
    c.try_credit_deposit(acc("new-op.test"), a.clone(), 1, "r".into()).unwrap();
    assert_eq!(code(c.try_set_operator(owner(), m.clone())), ErrorCode::BadRequest);
}

#[test]
#[should_panic(expected = "UNAUTHENTICATED")]
fn credit_deposit_by_player_panics() {
    let (mut c, a) = live_with_player();
    ctx(&a, T0);
    c.credit_deposit(a.clone(), U128(1), "r".into());
}

#[test]
#[should_panic(expected = "UNAUTHENTICATED")]
fn set_policy_by_player_panics() {
    let mut c = new_contract(Mode::Play);
    ctx(&player(1), T0);
    c.set_policy(800, 0);
}

// `init` is `#[init] #[private]`: near-sdk enforces both in the generated wasm entry point
// (state must not exist; predecessor == current account), which unit tests do not execute.
// A sandbox (near-workspaces) test must cover it (plan 5.5 task 6, not done yet).

#[test]
fn init_validation() {
    ctx(&contract_id(), T0);
    let mut ma = merchant_accounts();
    ma.madan = ma.dasht.clone();
    assert!(crate::Contract::try_new(owner(), operator(), Mode::Play, ma, 10, None, None, None).is_err());
    let mut ma = merchant_accounts();
    ma.shahr = operator();
    assert!(crate::Contract::try_new(owner(), operator(), Mode::Play, ma, 10, None, None, None).is_err());
    assert!(crate::Contract::try_new(owner(), operator(), Mode::Play, merchant_accounts(), 0, None, None, None).is_err());
    let c = crate::Contract::try_new(owner(), operator(), Mode::Play, merchant_accounts(), 10, None, None, None).unwrap();
    for m in &c.merchants {
        assert_eq!(m.treasury, MERCHANT_TREASURY_FILS);
        for g in GoodId::ALL {
            assert_eq!(m.stock[g.idx()], good(g).target);
        }
    }
}

#[test]
fn views_and_mt() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&a, T0);
    c.try_trade(a.clone(), CityId::Bandar, GoodId::Salt, Side::Buy, 7, u128::MAX).unwrap();
    assert_eq!(c.mt_balance_of(a.clone(), "salt".into()).0, 7);
    assert_eq!(c.mt_balance_of(acc("nobody.test"), "salt".into()).0, 0);
    assert_eq!(c.mt_balance_of(merchant(CityId::Bandar), "salt".into()).0, 113);
    let b = c.mt_batch_balance_of(a.clone(), vec!["salt".into(), "silk".into()]);
    assert_eq!((b[0].0, b[1].0), (7, 0));
    assert_eq!(c.mt_supply("salt".into()).unwrap().0, 4 * 120);
    assert_eq!(c.mt_supply("gold".into()), None);
    let toks = c.mt_tokens_for_owner(a.clone(), None, None);
    assert_eq!(toks.len(), 1);
    assert_eq!(toks[0].token_id, "salt");
    let w = c.get_world();
    assert_eq!(w.merchants.len(), 4);
    assert_eq!(w.player_count, 1);
    assert_eq!(w.merchants[0].quotes.grain.mid.0, 1000);
    let p = c.get_player(a.clone()).unwrap();
    assert_eq!(p.net_worth.0, p.fils.0 + 7 * 1500);
    assert_eq!(c.get_players(None, None).len(), 1);
    assert_eq!(c.get_players(Some(1), None).len(), 0);
    assert_eq!(c.get_config().max_players, 1000);
    let s = c.get_solvency();
    assert_eq!(s.seed_total.0, 200_000);
    // JSON shapes used by the server
    let j = near_sdk::serde_json::to_value(&p).unwrap();
    assert_eq!(j["location"], "bandar");
    assert_eq!(j["inventory"]["salt"], 7);
    assert!(j["fils"].is_string());
    let cfg = near_sdk::serde_json::to_value(c.get_config()).unwrap();
    assert_eq!(cfg["mode"], "PLAY");
}

#[test]
#[should_panic(expected = "BAD_REQUEST: unknown token_id")]
fn mt_unknown_token_panics() {
    let c = new_contract(Mode::Play);
    c.mt_balance_of(player(1), "gold".into());
}

#[test]
fn events_are_nep297() {
    let mut c = new_contract(Mode::Play);
    let a = with_player(&mut c, 1, 50_000);
    ctx(&a, T0);
    c.trade(CityId::Bandar, GoodId::Grain, Side::Buy, 2, U128(u128::MAX));
    let logs = near_sdk::test_utils::get_logs();
    let line = logs.iter().find(|l| l.contains("\"trade\"")).expect("trade event");
    let body = line.strip_prefix("EVENT_JSON:").expect("prefix");
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(body).unwrap();
    assert_eq!(v["standard"], "caravan");
    assert_eq!(v["version"], "1.0.0");
    assert_eq!(v["event"], "trade");
    let d = &v["data"][0];
    for k in ["account", "merchant", "good", "qty", "total", "fee", "ts"] {
        assert!(!d[k].is_null(), "missing {k}");
    }
    assert_eq!(d["ts"], T0 / NS_PER_SEC);
}

#[test]
fn every_error_code_string_matches_spec() {
    let names: Vec<&str> = ErrorCode::ALL.iter().map(|c| c.as_str()).collect();
    assert_eq!(
        names,
        [
            "UNAUTHENTICATED", "BAD_REQUEST", "RATE_LIMIT", "MODE_NOT_ALLOWED", "NOT_IN_CITY", "IN_TRANSIT",
            "NOT_ARRIVED", "INSUFFICIENT_FUNDS", "INSUFFICIENT_STOCK", "MERCHANT_BROKE", "SLIPPAGE",
            "CARGO_LIMIT", "PAUSED", "INTERNAL"
        ]
    );
}
