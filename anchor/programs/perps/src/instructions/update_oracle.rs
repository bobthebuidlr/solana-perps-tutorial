use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, Oracle, ProtocolConfig};

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub oracle: Account<'info, Oracle>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, ProtocolConfig>,
}

/// Updates the oracle price for a given token. Gated to the protocol authority.
///
/// @param ctx UpdateOracle accounts context
/// @param token Token mint pubkey to update
/// @param new_price New price value
/// @return Result<()>
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
