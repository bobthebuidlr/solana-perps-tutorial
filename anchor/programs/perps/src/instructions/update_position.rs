use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::{
    add_open_interest, calculate_funding_pnl, calculate_notional, calculate_price_pnl,
    check_user_account_health, constants::*, error::ErrorCode, remove_open_interest, settle_pnl,
    update_funding_indices, Markets, Oracle, PositionDirection, ProtocolConfig, UserAccount,
    LEVERAGE_PRECISION,
};

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct UpdatePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut,
      seeds = [USER_SEED, user.key().as_ref()],
      bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(mut)]
    pub markets: Account<'info, Markets>,

    pub oracle: Account<'info, Oracle>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
        bump,
        token::mint = config.usdc_mint
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump,
        token::mint = config.usdc_mint
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Realizes current PnL on the user's position for `token_mint` and resets it
/// with new parameters. The position lives inline in the user account, so
/// cross-margin is read directly from `user_account.positions`.
///
/// @param ctx UpdatePosition accounts context
/// @param token_mint Market token mint
/// @param direction New direction (Long or Short)
/// @param size New position size in base units
/// @param leverage New leverage multiplier (6-decimal)
/// @return Result<()>
pub fn handler(
    ctx: Context<UpdatePosition>,
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64,
    leverage: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // CRITICAL: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    let oracle_price = ctx
        .accounts
        .oracle
        .prices
        .iter()
        .find(|p| p.token_mint == token_mint)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?
        .price;

    // --- Step 1: Look up the existing position and realize its PnL ---
    let existing = ctx
        .accounts
        .user_account
        .positions
        .iter()
        .find(|p| p.perps_market == token_mint)
        .ok_or(error!(ErrorCode::PositionNotFound))?
        .clone();

    let perps_market = markets
        .perps
        .iter()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    let price_pnl = calculate_price_pnl(&existing, oracle_price)?;
    let funding_pnl = calculate_funding_pnl(&existing, perps_market, None)?;
    let total_pnl = price_pnl
        .checked_add(funding_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let user_key = ctx.accounts.user.key();
    let collateral_bump = ctx.bumps.user_collateral_token_account;
    let collateral_seeds: &[&[u8]] = &[USER_COLLATERAL_SEED, user_key.as_ref(), &[collateral_bump]];
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];

    settle_pnl(
        total_pnl,
        existing.collateral,
        &ctx.accounts.user_collateral_token_account,
        &ctx.accounts.vault,
        &ctx.accounts.token_program,
        &[collateral_seeds],
        &[vault_seeds],
    )?;

    // --- Step 2: Remove old OI ---
    let old_entry_notional = calculate_notional(existing.position_size, existing.entry_price)?;
    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    remove_open_interest(perps_market, existing.direction, old_entry_notional)?;

    // --- Step 3: Compute new position values and add new OI ---
    let new_notional = calculate_notional(size, oracle_price)?;

    let new_collateral = (new_notional as u128)
        .checked_mul(LEVERAGE_PRECISION as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(leverage as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    add_open_interest(perps_market, direction, new_notional)?;

    let new_funding_index = match direction {
        PositionDirection::Long => perps_market.cumulative_funding_long,
        PositionDirection::Short => perps_market.cumulative_funding_short,
    };

    // --- Step 4: Write new position fields in place ---
    let position = ctx
        .accounts
        .user_account
        .positions
        .iter_mut()
        .find(|p| p.perps_market == token_mint)
        .ok_or(error!(ErrorCode::PositionNotFound))?;
    position.direction = direction;
    position.entry_price = oracle_price;
    position.position_size = size;
    position.collateral = new_collateral;
    position.entry_funding_index = new_funding_index;

    // --- Step 5: Post-trade cross-margin health check ---
    // Atomically rolled back if it fails.
    ctx.accounts.user_collateral_token_account.reload()?;
    let token_balance = ctx.accounts.user_collateral_token_account.amount;

    check_user_account_health(
        &ctx.accounts.user_account,
        &ctx.accounts.markets,
        &ctx.accounts.oracle,
        token_balance,
    )?;

    Ok(())
}
