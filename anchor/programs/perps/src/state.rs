use anchor_lang::prelude::*;

use crate::{MAX_MARKETS, MAX_POSITIONS};

#[account]
#[derive(InitSpace, Debug)]
pub struct ProtocolConfig {
    pub usdc_mint: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Markets {
    #[max_len(MAX_MARKETS)]
    pub perps: Vec<PerpsMarket>,
    // Other markets like Spot could be added here
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PerpsMarket {
    pub token_mint: Pubkey,

    #[max_len(32)]
    pub name: String,
    pub total_long_oi: u64,
    pub total_short_oi: u64,
    pub cumulative_funding_long: i128,
    pub cumulative_funding_short: i128,
    pub last_funding_update: i64,
    pub max_leverage: u64,
    pub maintenance_margin_ratio: u64,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Oracle {
    #[max_len(MAX_MARKETS)]
    pub prices: Vec<OraclePrice>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct OraclePrice {
    pub token_mint: Pubkey,
    pub price: u64,
    pub last_updated: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PositionDirection {
    Long,
    Short,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct UserAccount {
    pub authority: Pubkey,
    pub bump: u8,
    #[max_len(MAX_POSITIONS)]
    pub positions: Vec<Position>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Debug)]
pub struct Position {
    pub perps_market: Pubkey,
    pub direction: PositionDirection,
    pub entry_price: u64,
    pub position_size: u64,
    pub entry_funding_index: i128,
}
