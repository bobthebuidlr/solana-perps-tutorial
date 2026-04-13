use anchor_lang::prelude::*;

use crate::{constants::*, Markets, Oracle, OraclePrice, PerpsMarket, ProtocolConfig};

#[derive(Accounts)]
pub struct InitializeMarketWithOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub markets: Account<'info, Markets>,

    #[account(mut)]
    pub oracle: Account<'info, Oracle>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, ProtocolConfig>,
}

/// Creates a new perpetual market with an initial oracle price.
/// Normally it would refer to a third party oracle, but for this demo
/// we're using a mock oracle.
///
/// @param ctx InitializeMarketWithOracle accounts context
/// @param token Token mint pubkey
/// @param name Market name
/// @param price Initial oracle price
/// @param max_leverage Maximum leverage (6-decimal)
/// @param maintenance_margin_ratio Maintenance margin ratio (6-decimal)
/// @return Result<()>
pub fn handler(
    ctx: Context<InitializeMarketWithOracle>,
    token: Pubkey,
    name: String,
    price: u64,
    max_leverage: u64,
    maintenance_margin_ratio: u64,
) -> Result<()> {
    let clock = Clock::get()?;

    ctx.accounts.markets.perps.push(PerpsMarket {
        token_mint: token,
        name,
        total_long_oi: 0,
        total_short_oi: 0,
        cumulative_funding_long: 0,
        cumulative_funding_short: 0,
        last_funding_update: clock.unix_timestamp,
        max_leverage,
        maintenance_margin_ratio,
    });

    ctx.accounts.oracle.prices.push(OraclePrice {
        token_mint: token,
        price,
        last_updated: clock.unix_timestamp,
    });

    Ok(())
}
