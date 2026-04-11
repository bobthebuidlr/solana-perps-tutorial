use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::{
    calculate_funding_pnl, calculate_notional, calculate_price_pnl, constants::*, error::ErrorCode,
    get_oracle_price, remove_open_interest, settle_pnl, update_funding_indices, Markets, Oracle,
    ProtocolConfig, UserAccount,
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

pub fn handler(ctx: Context<ClosePosition>, token_mint: Pubkey) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // IMPORTANT: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    let oracle_price = get_oracle_price(&ctx.accounts.oracle, token_mint)?;

    // Locate the position inline and snapshot it for PnL math.
    let idx = ctx
        .accounts
        .user_account
        .positions
        .iter()
        .position(|p| p.perps_market == token_mint)
        .ok_or(error!(ErrorCode::PositionNotFound))?;
    let position = ctx.accounts.user_account.positions[idx].clone();

    let price_pnl = calculate_price_pnl(&position, oracle_price)?;
    let funding_pnl = calculate_funding_pnl(&position, perps_market)?;
    let total_pnl = price_pnl
        .checked_add(funding_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let entry_notional = calculate_notional(position.position_size, position.entry_price)?;

    // Settle PnL
    let user_key = ctx.accounts.user.key();
    let collateral_bump = ctx.bumps.user_collateral_token_account;
    let collateral_seeds: &[&[u8]] = &[USER_COLLATERAL_SEED, user_key.as_ref(), &[collateral_bump]];
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];

    settle_pnl(
        total_pnl,
        &ctx.accounts.user_collateral_token_account,
        &ctx.accounts.vault,
        &ctx.accounts.token_program,
        &[collateral_seeds],
        &[vault_seeds],
    )?;

    // Update the market OI
    remove_open_interest(perps_market, position.direction, entry_notional)?;

    // Drop the position from the inline list.
    ctx.accounts.user_account.positions.swap_remove(idx);

    Ok(())
}
