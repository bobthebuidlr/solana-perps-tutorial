use anchor_lang::prelude::*;

use crate::{
    calculate_funding_pnl, calculate_pnl, error::ErrorCode, Markets, Oracle, PnlInfo, Position,
    PositionInfo,
};

#[derive(Accounts)]
pub struct ViewPositionPnl<'info> {
    pub markets: Account<'info, Markets>,
    pub position: Account<'info, Position>,
    pub oracle: Account<'info, Oracle>,
}

// TODO: Find out if I should name it always token or token_mint
pub fn handler(ctx: Context<ViewPositionPnl>, token_mint: Pubkey) -> Result<PositionInfo> {
    let position = &ctx.accounts.position;
    let oracle = &ctx.accounts.oracle;
    let clock = Clock::get()?;

    let oracle_price = oracle
        .prices
        .iter()
        .find(|p| p.token_mint == token_mint)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?;

    let perps_market = ctx
        .accounts
        .markets
        .perps
        .iter()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    // Calculate price-based PnL
    let pnl = calculate_pnl(position, oracle_price.price)?;

    // Calculate accumulated funding PnL (calculates current indices without mutating)
    let funding_pnl = calculate_funding_pnl(position, perps_market, Some(clock.unix_timestamp))?;

    // Calculate total PnL (price PnL + funding PnL)
    let total_pnl = pnl
        .checked_add(funding_pnl)
        .ok_or(error!(crate::error::ErrorCode::ArithmeticOverflow))?;

    Ok(PositionInfo {
        size: position.position_size,
        direction: position.direction,
        entry_price: position.entry_price,
        pnl_info: PnlInfo {
            price: pnl,
            funding: funding_pnl,
            total: total_pnl,
        },
    })
}
