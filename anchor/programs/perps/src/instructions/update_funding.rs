use anchor_lang::prelude::*;

use crate::{state::Markets, update_funding_indices};

#[derive(Accounts)]
pub struct UpdateFunding<'info> {
    #[account(mut)]
    pub markets: Account<'info, Markets>,
}

/// Updates funding indices for all markets to the current timestamp.
pub fn handler(ctx: Context<UpdateFunding>) -> Result<()> {
    let markets = &mut ctx.accounts.markets;
    let clock = Clock::get()?;
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;
    Ok(())
}
