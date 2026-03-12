use anchor_lang::prelude::*;

use crate::{
    calculate_funding_pnl, calculate_price_pnl, constants::*, error::ErrorCode,
    update_funding_indices, Markets, Oracle, Position, PositionDirection, UserAccount,
};

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct ClosePosition<'info> {
    /// User closing the position
    #[account(mut)]
    pub user: Signer<'info>,

    /// User collateral account
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    /// Position being closed — rent returned to user on close
    #[account(
        mut,
        seeds = [POSITION_SEED, user.key().as_ref(), token_mint.to_bytes().as_ref()],
        bump = position.bump,
        close = user
    )]
    pub position: Account<'info, Position>,

    /// Markets account — updated to adjust OI
    #[account(mut)]
    pub markets: Account<'info, Markets>,

    pub oracle: Account<'info, Oracle>,
}

/// Closes an open position and settles PnL to the user's collateral account.
/// Updates OI on the market and removes the position from the user account.
/// @param ctx - Accounts context.
/// @param token_mint - The token mint of the market being closed.
/// @returns Ok(()) on success.
pub fn handler(ctx: Context<ClosePosition>, token_mint: Pubkey) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // CRITICAL: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    // Resolve market and oracle price for this token_mint
    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    let oracle_price = ctx
        .accounts
        .oracle
        .prices
        .iter()
        .find(|p| p.token_mint == token_mint)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?
        .price;

    let position = &ctx.accounts.position;

    // Calculate PnL components (funding indices already updated above)
    let price_pnl = calculate_price_pnl(position, oracle_price)?;
    let funding_pnl = calculate_funding_pnl(position, perps_market, None)?;
    let total_pnl = price_pnl
        .checked_add(funding_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let position_collateral = position.collateral;
    let position_direction = position.direction;

    // Update user's collateral: apply PnL only (don't subtract position collateral)
    // The position collateral is already tracked in locked_collateral
    // New collateral = current_collateral + total_pnl
    let user_account = &mut ctx.accounts.user_account;

    // Apply the PnL (can be positive or negative) to total collateral
    // If the result would be negative (user lost more than total collateral), floor at 0
    let new_collateral = if total_pnl >= 0 {
        user_account
            .collateral
            .checked_add(total_pnl as u64)
            .ok_or(ErrorCode::ArithmeticOverflow)?
    } else {
        let abs_loss = total_pnl.abs() as u64;
        if abs_loss > user_account.collateral {
            0
        } else {
            user_account
                .collateral
                .checked_sub(abs_loss)
                .ok_or(ErrorCode::ArithmeticOverflow)?
        }
    };

    user_account.collateral = new_collateral;
    user_account.locked_collateral = user_account
        .locked_collateral
        .checked_sub(position_collateral)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Decrease market OI
    match position_direction {
        PositionDirection::Long => {
            perps_market.total_long_oi = perps_market
                .total_long_oi
                .checked_sub(position_collateral)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            perps_market.total_short_oi = perps_market
                .total_short_oi
                .checked_sub(position_collateral)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }

    msg!("Position closed successfully");
    msg!("Price PnL: {}", price_pnl);
    msg!("Funding PnL: {}", funding_pnl);
    msg!("Total PnL: {}", total_pnl);
    msg!(
        "Updated user collateral: {} USDC (6-decimal)",
        user_account.collateral
    );

    Ok(())
}
