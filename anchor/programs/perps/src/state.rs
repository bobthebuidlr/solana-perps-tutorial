use anchor_lang::prelude::*;

use crate::constants::MAX_POSITIONS;
use crate::error::ErrorCode;
use crate::MAX_MARKETS;

#[account]
#[derive(InitSpace, Debug)]
pub struct Markets {
    #[max_len(MAX_MARKETS)]
    pub perps: Vec<PerpsMarket>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PerpsMarket {
    /// The token for which the perps market is trading
    pub token_mint: Pubkey,

    /// Name of the perps market
    #[max_len(32)]
    pub name: String,

    /// Total long open interest
    pub total_long_oi: u64,

    /// Total short open interest
    pub total_short_oi: u64,

    /// Cumulative funding index for long positions
    pub cumulative_funding_long: i128,

    /// Cumulative funding index for short positions
    pub cumulative_funding_short: i128,

    /// Last funding update timestamp
    pub last_funding_update: i64,

    /// Multiplier determining how OI imbalance affects mark price
    /// Higher value = stronger impact
    pub mark_adjustment_factor: u64,
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
    /// User that owns this account
    pub authority: Pubkey,

    /// Market this user is associated with
    pub market: Pubkey,

    pub collateral: u64,
    pub locked_collateral: u64,

    // Positions the user has open
    #[max_len(MAX_POSITIONS)]
    pub positions: Vec<Pubkey>,

    // PDA bump seed
    pub bump: u8,
}

impl UserAccount {
    pub fn available_collateral(&self) -> Result<u64> {
        self.collateral
            .checked_sub(self.locked_collateral)
            .ok_or(error!(ErrorCode::InvalidCollateralState))
    }
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Position {
    /// User account that owns this position
    pub user_account: Pubkey,

    // TODO: Rename otehr entries to use
    /// The market this position refers to
    pub perps_market: Pubkey,

    /// Long or short
    pub direction: PositionDirection,

    /// Entry price
    pub entry_price: u64,

    /// Position size
    pub position_size: u64,

    // todo: Check if we really need this
    /// Collateral locked for this position
    pub collateral: u64,

    /// Funding index when position was opened
    pub entry_funding_index: i128,

    /// Timestamp when position was opened
    pub opened_at: i64,

    /// PDA bump seed
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
