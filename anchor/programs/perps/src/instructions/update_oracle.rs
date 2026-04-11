use anchor_lang::prelude::*;

use crate::{error::ErrorCode, Oracle};

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    #[account(mut)]
    pub oracle: Account<'info, Oracle>,
}

/// Updates the oracle price for a given token.
pub fn handler(ctx: Context<UpdateOracle>, token: Pubkey, new_price: u64) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let clock = Clock::get()?;

    let oracle_price = oracle
        .prices
        .iter_mut()
        .find(|p| p.token_mint == token)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?;

    oracle_price.price = new_price;
    oracle_price.last_updated = clock.unix_timestamp;

    Ok(())
}
