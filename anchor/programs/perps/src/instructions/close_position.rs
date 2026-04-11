use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::{
    calculate_funding_pnl, calculate_notional, calculate_price_pnl, constants::*,
    error::ErrorCode, remove_open_interest, settle_pnl, update_funding_indices, Markets, Oracle,
    Position, ProtocolConfig, UserAccount,
};

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [POSITION_SEED, user.key().as_ref(), token_mint.to_bytes().as_ref()],
        bump = position.bump,
        close = user
    )]
    pub position: Account<'info, Position>,

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

/// Closes a position, settles PnL, and adjusts market open interest.
pub fn handler(ctx: Context<ClosePosition>, token_mint: Pubkey) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // CRITICAL: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

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

    let price_pnl = calculate_price_pnl(position, oracle_price)?;
    let funding_pnl = calculate_funding_pnl(position, perps_market, None)?;
    let total_pnl = price_pnl
        .checked_add(funding_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let position_collateral = position.collateral;
    let position_direction = position.direction;
    let entry_notional = calculate_notional(position.position_size, position.entry_price)?;

    // Settle PnL via token transfers
    let user_key = ctx.accounts.user.key();
    let collateral_bump = ctx.bumps.user_collateral_token_account;
    let collateral_seeds: &[&[u8]] =
        &[USER_COLLATERAL_SEED, user_key.as_ref(), &[collateral_bump]];
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];

    settle_pnl(
        total_pnl,
        position_collateral,
        &ctx.accounts.user_collateral_token_account,
        &ctx.accounts.vault,
        &ctx.accounts.token_program,
        &[collateral_seeds],
        &[vault_seeds],
    )?;

    remove_open_interest(perps_market, position_direction, entry_notional)?;

    Ok(())
}
