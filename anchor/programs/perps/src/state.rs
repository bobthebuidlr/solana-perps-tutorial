use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::MAX_MARKETS;

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

    /// 6-decimal (e.g. 10_000_000 = 10x)
    pub max_leverage: u64,

    /// 6-decimal (e.g. 50_000 = 5%)
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
    pub locked_collateral: u64,
    pub bump: u8,
}

impl UserAccount {
    /// Returns available (unlocked) collateral.
    pub fn available_collateral(&self, token_balance: u64) -> Result<u64> {
        token_balance
            .checked_sub(self.locked_collateral)
            .ok_or(error!(ErrorCode::InvalidCollateralState))
    }
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Position {
    pub user_account: Pubkey,
    pub perps_market: Pubkey,
    pub direction: PositionDirection,
    pub entry_price: u64,
    pub position_size: u64,
    pub collateral: u64,
    pub entry_funding_index: i128,
    pub opened_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, InitSpace)]
pub struct PositionInfo {
    pub size: u64,
    pub direction: PositionDirection,
    pub entry_price: u64,
    pub pnl_info: PnlInfo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Debug, InitSpace)]
pub struct PnlInfo {
    pub price: i64,
    pub funding: i64,
    pub total: i64,
}
