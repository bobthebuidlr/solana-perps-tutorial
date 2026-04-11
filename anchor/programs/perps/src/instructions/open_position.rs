use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    add_open_interest, calculate_notional, check_user_account_health, constants::*,
    error::ErrorCode, get_oracle_price, update_funding_indices, Markets, Oracle, Position,
    PositionDirection, UserAccount,
};

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
      mut,
      seeds = [USER_SEED, user.key().as_ref()],
      bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(mut)]
    pub markets: Account<'info, Markets>,

    pub oracle: Account<'info, Oracle>,

    #[account(
        seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
        bump
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,
}

/// Opens a new perps position under cross-margin. The user's collateral balance
/// backs every position in the account; initial-margin requirements are enforced
/// by the post-trade cross-margin health check, not by a per-position collateral field.
///
/// @param ctx OpenPosition accounts context
/// @param token_mint Market token mint
/// @param direction Long or Short
/// @param size Position size in base units
/// @return Result<()>
pub fn handler(
    ctx: Context<OpenPosition>,
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64,
) -> Result<()> {
    let token_balance = ctx.accounts.user_collateral_token_account.amount;

    // Enforce one position per market and the max-positions cap.
    require!(
        !ctx.accounts
            .user_account
            .positions
            .iter()
            .any(|p| p.perps_market == token_mint),
        ErrorCode::MarketAlreadyHasPosition
    );
    require!(
        ctx.accounts.user_account.positions.len() < MAX_POSITIONS,
        ErrorCode::MaxPositionsReached
    );

    let oracle_price = get_oracle_price(&ctx.accounts.oracle, token_mint)?;

    let notional = calculate_notional(size, oracle_price)?;

    let clock = Clock::get()?;

    // IMPORTANT: Update funding indices BEFORE OI changes, then add new OI.
    let new_funding_index = {
        let markets = &mut ctx.accounts.markets;
        update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

        let perps_market = markets
            .perps
            .iter_mut()
            .find(|m| m.token_mint == token_mint)
            .ok_or(error!(ErrorCode::MarketNotFound))?;

        add_open_interest(perps_market, direction, notional)?;

        match direction {
            PositionDirection::Long => perps_market.cumulative_funding_long,
            PositionDirection::Short => perps_market.cumulative_funding_short,
        }
    };

    // Append the new position to the user's inline list.
    ctx.accounts.user_account.positions.push(Position {
        perps_market: token_mint,
        direction,
        entry_price: oracle_price,
        position_size: size,
        entry_funding_index: new_funding_index,
    });

    // Post-trade cross-margin health check. Atomically rolled back if it fails.
    check_user_account_health(
        &ctx.accounts.user_account,
        &ctx.accounts.markets,
        &ctx.accounts.oracle,
        token_balance,
    )?;

    Ok(())
}
