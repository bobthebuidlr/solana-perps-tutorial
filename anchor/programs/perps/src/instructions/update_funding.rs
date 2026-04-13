use anchor_lang::prelude::*;

use crate::{constants::MARKETS_SEED, state::Markets, update_funding_indices};

#[derive(Accounts)]
pub struct UpdateFunding<'info> {
    #[account(mut, seeds = [MARKETS_SEED], bump)]
    pub markets: Account<'info, Markets>,
}

/// Permissionlessly updates funding indices for all markets to the current
/// timestamp. Intentionally ungated: the operation is idempotent and monotonic,
/// so anyone may crank it without risk.
///
/// @param ctx UpdateFunding accounts context
/// @return Result<()>
pub fn handler(ctx: Context<UpdateFunding>) -> Result<()> {
    let markets = &mut ctx.accounts.markets;
    let clock = Clock::get()?;
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;
    Ok(())
}
