use anchor_lang::prelude::*;

#[constant]
pub const MARKETS_SEED: &[u8] = b"markets";

#[constant]
pub const ORACLE_SEED: &[u8] = b"oracle";

#[constant]
pub const USER_SEED: &[u8] = b"user";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const USER_COLLATERAL_SEED: &[u8] = b"user_collateral";

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

pub const ANCHOR_DISCRIMINATOR: usize = 8;

pub const MAX_MARKETS: usize = 10;

// One position per market per user, so this matches MAX_MARKETS.
pub const MAX_POSITIONS: usize = 10;

// Funding rate parameters
// Rate is based on OI imbalance: rate = (long_oi - short_oi) / total_oi * MAX_FUNDING_RATE
// At full imbalance (100% one side) the rate is 0.1% per hour.
// Real protocols use much lower caps; this is aggressive for easy demonstration.
pub const FUNDING_INTERVAL: i64 = 3600; // 1 hour in seconds
pub const FUNDING_RATE_BASE: u64 = 1_000_000; // 1_000_000 = 100% for precision
pub const MAX_FUNDING_RATE: u64 = 1_000; // 0.1% max per interval

// Leverage and margin parameters
pub const LEVERAGE_PRECISION: u64 = 1_000_000; // 6-decimal (1_000_000 = 1x)
pub const MARGIN_PRECISION: u64 = 1_000_000; // 6-decimal (1_000_000 = 100%)
