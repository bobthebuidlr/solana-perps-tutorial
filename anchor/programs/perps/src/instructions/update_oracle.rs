use anchor_lang::prelude::*;

use crate::{error::ErrorCode, Oracle};

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    #[account(mut)]
    pub oracle: Account<'info, Oracle>,
}

pub fn handler(ctx: Context<UpdateOracle>, token: Pubkey, new_price: u64) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let clock = Clock::get()?;

    let oracle_prices = &mut oracle.prices;

    let oracle_price = oracle_prices
        .iter_mut()
        .find(|p| p.token_mint == token)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?;

    oracle_price.price = new_price;
    oracle_price.last_updated = clock.unix_timestamp.try_into().unwrap();

    msg!("Oracle updated with price: {}", new_price);

    Ok(())
}
