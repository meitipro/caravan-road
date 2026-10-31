//! Error codes from spec/API.md section 2.12. Every contract panic message starts with one of
//! these codes followed by ": " and a short English message, e.g. `SLIPPAGE: price moved`.
//! The server maps a failed transaction to `ApiResult.error.code` by reading the prefix.

use near_sdk::env;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    Unauthenticated,
    BadRequest,
    RateLimit,
    ModeNotAllowed,
    NotInCity,
    InTransit,
    NotArrived,
    InsufficientFunds,
    InsufficientStock,
    MerchantBroke,
    Slippage,
    CargoLimit,
    Paused,
    Internal,
}

impl ErrorCode {
    pub const ALL: [ErrorCode; 14] = [
        ErrorCode::Unauthenticated,
        ErrorCode::BadRequest,
        ErrorCode::RateLimit,
        ErrorCode::ModeNotAllowed,
        ErrorCode::NotInCity,
        ErrorCode::InTransit,
        ErrorCode::NotArrived,
        ErrorCode::InsufficientFunds,
        ErrorCode::InsufficientStock,
        ErrorCode::MerchantBroke,
        ErrorCode::Slippage,
        ErrorCode::CargoLimit,
        ErrorCode::Paused,
        ErrorCode::Internal,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Unauthenticated => "UNAUTHENTICATED",
            ErrorCode::BadRequest => "BAD_REQUEST",
            ErrorCode::RateLimit => "RATE_LIMIT",
            ErrorCode::ModeNotAllowed => "MODE_NOT_ALLOWED",
            ErrorCode::NotInCity => "NOT_IN_CITY",
            ErrorCode::InTransit => "IN_TRANSIT",
            ErrorCode::NotArrived => "NOT_ARRIVED",
            ErrorCode::InsufficientFunds => "INSUFFICIENT_FUNDS",
            ErrorCode::InsufficientStock => "INSUFFICIENT_STOCK",
            ErrorCode::MerchantBroke => "MERCHANT_BROKE",
            ErrorCode::Slippage => "SLIPPAGE",
            ErrorCode::CargoLimit => "CARGO_LIMIT",
            ErrorCode::Paused => "PAUSED",
            ErrorCode::Internal => "INTERNAL",
        }
    }
}

/// A rejected call. Internal `try_*` functions return it; public methods turn it into a panic,
/// which reverts every state change of the transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaravanError {
    pub code: ErrorCode,
    pub msg: String,
}

impl CaravanError {
    pub fn new(code: ErrorCode, msg: impl Into<String>) -> Self {
        Self { code, msg: msg.into() }
    }

    /// The panic message: `"<CODE>: <message>"`.
    pub fn message(&self) -> String {
        format!("{}: {}", self.code.as_str(), self.msg)
    }

    pub fn panic(self) -> ! {
        env::panic_str(&self.message())
    }
}

pub type CResult<T> = Result<T, CaravanError>;

pub fn fail<T>(code: ErrorCode, msg: impl Into<String>) -> CResult<T> {
    Err(CaravanError::new(code, msg))
}

/// Converts a failed checked operation into `INTERNAL: arithmetic overflow`.
pub fn ovf<T>(v: Option<T>) -> CResult<T> {
    v.ok_or_else(|| CaravanError::new(ErrorCode::Internal, "arithmetic overflow"))
}

/// Unwraps a contract result, panicking with the mapped error code on failure.
pub trait OrPanic<T> {
    fn or_panic(self) -> T;
}

impl<T> OrPanic<T> for CResult<T> {
    fn or_panic(self) -> T {
        match self {
            Ok(v) => v,
            Err(e) => e.panic(),
        }
    }
}
