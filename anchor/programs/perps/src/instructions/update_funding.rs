use anchor_lang::prelude::*;

use crate::{state::Markets, update_funding_indices};

#[derive(Accounts)]
pub struct UpdateFunding<'info> {
    #[account(mut)]
    pub markets: Account<'info, Markets>,
}

/// Update the funding indices to the current timestamp
/// This should be called periodically to ensure funding indices stay up-to-date
pub fn handler(ctx: Context<UpdateFunding>) -> Result<()> {
    let markets = &mut ctx.accounts.markets;
    let clock = Clock::get()?;

    // Update funding indices to current time
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    msg!("Funding indices updated to current time");

    Ok(())
}
