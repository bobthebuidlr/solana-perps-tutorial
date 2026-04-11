use anchor_lang::prelude::*;

use crate::{
    calculate_funding_pnl, calculate_price_pnl, error::ErrorCode, Markets, Oracle, PnlInfo,
    PositionInfo, UserAccount,
};

#[derive(Accounts)]
pub struct ViewPositionPnl<'info> {
    pub markets: Account<'info, Markets>,
    pub user_account: Account<'info, UserAccount>,
    pub oracle: Account<'info, Oracle>,
}

/// Returns position info with current price and funding PnL for the user's
/// inline position on `token_mint`.
///
/// @param ctx ViewPositionPnl accounts context
/// @param token_mint Market token mint identifying which position to read
/// @return PositionInfo for the requested position
pub fn handler(ctx: Context<ViewPositionPnl>, token_mint: Pubkey) -> Result<PositionInfo> {
    let clock = Clock::get()?;

    let position = ctx
        .accounts
        .user_account
        .positions
        .iter()
        .find(|p| p.perps_market == token_mint)
        .ok_or(error!(ErrorCode::PositionNotFound))?;

    let oracle_price = ctx
        .accounts
        .oracle
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

    let pnl = calculate_price_pnl(position, oracle_price.price)?;
    let funding_pnl = calculate_funding_pnl(position, perps_market, Some(clock.unix_timestamp))?;
    let total_pnl = pnl
        .checked_add(funding_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

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
