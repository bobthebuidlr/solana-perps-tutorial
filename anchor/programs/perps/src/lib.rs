pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;
pub use utils::*;

declare_id!("6q2SoxHGceNGtQbf3fwYWZwPQkP14yDbLjhythtPkB7P");

#[program]
pub mod perps {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn initialize_market_with_oracle(
        ctx: Context<InitializeMarketWithOracle>,
        token: Pubkey,
        name: String,
        price: u64,
        max_leverage: u64,
        maintenance_margin_ratio: u64,
    ) -> Result<()> {
        initialize_market_with_oracle::handler(ctx, token, name, price, max_leverage, maintenance_margin_ratio)
    }

    pub fn update_oracle(ctx: Context<UpdateOracle>, token: Pubkey, new_price: u64) -> Result<()> {
        update_oracle::handler(ctx, token, new_price)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        deposit_collateral::handler(ctx, amount)
    }

    pub fn open_position<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenPosition<'info>>,
        token_mint: Pubkey,
        direction: PositionDirection,
        amount: u64,
        leverage: u64,
    ) -> Result<()> {
        open_position::handler(ctx, token_mint, direction, amount, leverage)
    }

    pub fn view_position_pnl(
        ctx: Context<ViewPositionPnl>,
        token_mint: Pubkey,
    ) -> Result<PositionInfo> {
        view_position_pnl::handler(ctx, token_mint)
    }

    pub fn update_funding(ctx: Context<UpdateFunding>) -> Result<()> {
        update_funding::handler(ctx)
    }

    pub fn close_position(ctx: Context<ClosePosition>, token_mint: Pubkey) -> Result<()> {
        close_position::handler(ctx, token_mint)
    }

    pub fn withdraw_collateral<'info>(ctx: Context<'_, '_, 'info, 'info, WithdrawCollateral<'info>>, amount: u64) -> Result<()> {
        withdraw_collateral::handler(ctx, amount)
    }
}
