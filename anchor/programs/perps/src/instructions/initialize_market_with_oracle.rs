use anchor_lang::prelude::*;

use crate::{Markets, Oracle, OraclePrice, PerpsMarket, DEFAULT_MARK_ADJUSTMENT_FACTOR};

#[derive(Accounts)]
pub struct InitializeMarketWithOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub markets: Account<'info, Markets>,

    #[account(mut)]
    pub oracle: Account<'info, Oracle>,
}

pub fn handler(
    ctx: Context<InitializeMarketWithOracle>,
    token: Pubkey,
    name: String,
    price: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;
    let oracle = &mut ctx.accounts.oracle;

    let perps_market = PerpsMarket {
        token_mint: token,
        name: name,
        total_long_oi: 0,
        total_short_oi: 0,
        cumulative_funding_long: 0,
        cumulative_funding_short: 0,
        last_funding_update: clock.unix_timestamp,
        mark_adjustment_factor: DEFAULT_MARK_ADJUSTMENT_FACTOR,
    };

    let oracle_price = OraclePrice {
        token_mint: token,
        price: price,
        last_updated: clock.unix_timestamp,
    };

    markets.perps.push(perps_market);
    oracle.prices.push(oracle_price);

    Ok(())
}
