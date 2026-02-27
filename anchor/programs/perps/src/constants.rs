use anchor_lang::prelude::*;

#[constant]
pub const MARKETS_SEED: &[u8] = b"markets";

#[constant]
pub const SEED: &[u8] = b"anchor";

#[constant]
pub const ORACLE_SEED: &[u8] = b"oracle";

#[constant]
pub const MARKET_SEED: &[u8] = b"market";

#[constant]
pub const USER_SEED: &[u8] = b"user";

#[constant]
pub const POSITION_SEED: &[u8] = b"position";

pub const ANCHOR_DISCRIMINATOR: usize = 8;

pub const MAX_POSITIONS: usize = 2;

pub const MAX_MARKETS: usize = 10;

// Funding rate parameters
pub const FUNDING_INTERVAL: i64 = 300; // 5 minutes in seconds
pub const FUNDING_RATE_BASE: u64 = 1_000_000; // 1_000_000 = 100% for precision
pub const MAX_FUNDING_RATE: u64 = 1_000; // 0.1% max per interval
