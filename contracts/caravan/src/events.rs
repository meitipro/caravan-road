//! NEP-297 events (https://github.com/near/NEPs/blob/master/neps/nep-0297.md):
//! one log line per event, `EVENT_JSON:` followed by
//! `{"standard":"caravan","version":"1.0.0","event":"<name>","data":[{...}]}`
//! (shape from master plan 5.3). Money values are decimal strings, `ts` is unix seconds.
//! Hand-written instead of `#[near(event_json)]` so the `data` array shape is exactly the plan's.

use near_sdk::env;
use near_sdk::serde_json::{Value, json};

pub const STANDARD: &str = "caravan";
pub const VERSION: &str = "1.0.0";

pub fn emit(event: &str, mut data: Value) {
    if let Value::Object(map) = &mut data {
        let ts = env::block_timestamp().checked_div(crate::math::NS_PER_SEC).unwrap_or(0);
        map.entry("ts").or_insert(json!(ts));
    }
    let line = json!({
        "standard": STANDARD,
        "version": VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{line}"));
}
