//! Golden JSON fixtures of what the contract really returns, read by the TypeScript parity tests
//! (apps/web/src/server/__tests__/contract-json-parity.test.ts). A scripted game goes through the PUBLIC methods
//! (the same functions the JSON ABI exposes) and records every return value, the views and every NEP-297 log line.
//!
//! The file `contracts/caravan/fixtures/contract-json.json` is committed. This test fails when the contract's JSON
//! changes; regenerate it with `UPDATE_CONTRACT_FIXTURES=1 cargo test fixture` and re-run the TypeScript tests.

use std::collections::BTreeMap;

use near_sdk::json_types::U128;
use near_sdk::serde_json::{Map, Value, json, to_value};
use near_sdk::test_utils::get_logs;

use super::helpers::*;
use crate::Contract;
use crate::types::*;

struct Recorder {
    returns: Map<String, Value>,
    views: Map<String, Value>,
    logs: Vec<Value>,
}

impl Recorder {
    fn new() -> Self {
        Self { returns: Map::new(), views: Map::new(), logs: Vec::new() }
    }
    /// Records the logs emitted since the last `ctx` (each `ctx` starts a fresh mocked blockchain log).
    fn logs_of(&mut self, step: &str) {
        let lines: Vec<Value> = get_logs().into_iter().map(Value::String).collect();
        self.logs.push(json!({ "step": step, "lines": lines }));
    }
    fn ret<T: near_sdk::serde::Serialize>(&mut self, name: &str, v: &T) {
        self.returns.insert(name.into(), to_value(v).unwrap());
        self.logs_of(name);
    }
    fn view<T: near_sdk::serde::Serialize>(&mut self, name: &str, v: &T) {
        self.views.insert(name.into(), to_value(v).unwrap());
    }
}

fn play_script(r: &mut Recorder) {
    let mut c = new_contract(Mode::Play);
    let (p1, p2) = (player(1), player(2));
    let mut t = T0 + secs(1);

    ctx(&p1, t);
    let v = c.register();
    r.ret("register", &v);
    ctx(&p1, t);
    let v = c.faucet();
    r.ret("faucet", &v);
    ctx(&p1, t);
    let v = c.trade(CityId::Bandar, GoodId::Grain, Side::Buy, 10, U128(1_000_000));
    r.ret("trade_buy", &v);
    ctx(&p1, t);
    let v = c.stall_create(GoodId::Grain, 3, U128(1500));
    r.ret("stall_create", &v);

    ctx(&p2, t);
    c.register();
    ctx(&p2, t);
    c.faucet();
    ctx(&p2, t);
    let v = c.stall_buy(0, 1, U128(1500));
    r.ret("stall_buy", &v);
    ctx(&p1, t);
    r.view("get_stalls", &c.get_stalls(None, None, None));
    ctx(&p1, t);
    let v = c.stall_cancel(0);
    r.ret("stall_cancel", &v);

    ctx(&p1, t);
    let mut cargo = BTreeMap::new();
    cargo.insert(GoodId::Grain, 9);
    let v = c.start_journey(CityId::Shahr, cargo, 0);
    r.ret("start_journey", &v);
    ctx(&p1, t);
    r.view("get_player_in_transit", &c.get_player(p1.clone()));
    r.view("get_journey_in_transit", &c.get_journey(p1.clone()));

    t += secs(181);
    ctx(&p1, t);
    let v = c.claim_journey();
    r.ret("claim_journey", &v);
    ctx(&p1, t);
    r.view("get_player_after_claim", &c.get_player(p1.clone()));
    r.view("get_journey_claimed", &c.get_journey(p1.clone()));
    ctx(&p1, t);
    let qty = c.players.get(&p1).unwrap().goods[GoodId::Grain.idx()];
    let v = c.trade(CityId::Shahr, GoodId::Grain, Side::Sell, qty, U128(0));
    r.ret("trade_sell", &v);

    // A merchant policy move and a merchant shipment (stock arranged so the shipment is allowed).
    ctx(&merchant(CityId::Dasht), t);
    c.set_policy(900, 100);
    r.logs_of("set_policy");
    c.merchants[1].stock[GoodId::Iron.idx()] = 200; // madan: full
    c.merchants[2].stock[GoodId::Iron.idx()] = 20; // bandar: short
    ctx(&merchant(CityId::Madan), t);
    let v = c.ship(CityId::Bandar, GoodId::Iron, 2);
    r.ret("ship", &v);

    ctx(&p2, t);
    let v = c.world_tick();
    r.ret("world_tick", &v);
    ctx(&p2, t);
    let v = c.world_tick();
    r.ret("world_tick_early", &v);

    ctx(&operator(), t);
    c.set_paused(true);
    r.logs_of("set_paused");
    ctx(&owner(), t);
    c.set_paused(false);
    r.logs_of("set_unpaused");

    ctx(&p1, t);
    r.view("get_world", &c.get_world());
    r.view("get_merchant_bandar", &c.get_merchant(CityId::Bandar));
    r.view("get_quotes_bandar", &c.get_quotes(CityId::Bandar));
    r.view("get_players", &c.get_players(None, None));
    r.view("get_player_missing", &c.get_player(player(99)));
    r.view("get_config", &c.get_config());
    r.view("get_solvency", &c.get_solvency());
    assert_money_conserved(&c);
}

fn live_script(r: &mut Recorder) {
    let mut c: Contract = new_contract(Mode::Live);
    let p3 = player(3);
    let t = T0 + secs(1);
    ctx(&p3, t);
    c.register();
    ctx(&operator(), t);
    let v = c.credit_deposit(p3.clone(), U128(20_000), "quote-1".into());
    r.ret("credit_deposit", &v);
    ctx(&operator(), t);
    let v = c.credit_deposit(p3.clone(), U128(20_000), "quote-1".into());
    r.ret("credit_deposit_repeat", &v);
    ctx(&p3, t);
    let id = c.request_withdraw(U128(5_000), "nep141:usdc.example".into(), "0xabc".into());
    r.ret("request_withdraw", &id);
    ctx(&operator(), t);
    c.mark_withdraw(id, Some(WithdrawStatus::Sent), Some("tx-1".into()));
    r.logs_of("mark_withdraw_sent");
    ctx(&p3, t);
    r.view("get_withdraw_sent", &c.get_withdraw(id));
    ctx(&operator(), t);
    c.refund_withdraw(id);
    r.logs_of("refund_withdraw");
    ctx(&p3, t);
    r.view("get_withdrawals", &c.get_withdrawals(None, None));
    r.view("get_withdraw_missing", &c.get_withdraw(999));
    assert_money_conserved(&c);
}

#[test]
fn contract_json_fixtures_are_current() {
    let mut play = Recorder::new();
    play_script(&mut play);
    let mut live = Recorder::new();
    live_script(&mut live);
    let doc = json!({
        "_comment": "Generated by contracts/caravan/src/tests/fixture_tests.rs (UPDATE_CONTRACT_FIXTURES=1 cargo test fixture). Do not edit by hand.",
        "play": { "returns": play.returns, "views": play.views, "logs": play.logs },
        "live": { "returns": live.returns, "views": live.views, "logs": live.logs },
    });
    let text = format!("{}\n", near_sdk::serde_json::to_string_pretty(&doc).unwrap());
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures").join("contract-json.json");
    if std::env::var("UPDATE_CONTRACT_FIXTURES").as_deref() == Ok("1") {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &text).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
    assert!(
        committed == text,
        "contracts/caravan/fixtures/contract-json.json is out of date: run `UPDATE_CONTRACT_FIXTURES=1 cargo test fixture` and re-run the TypeScript parity tests"
    );
}
