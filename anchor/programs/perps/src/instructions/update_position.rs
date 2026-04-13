use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::{
    add_open_interest, calculate_funding_pnl, calculate_notional, calculate_price_pnl,
    check_user_account_health, constants::*, error::ErrorCode, get_oracle_price,
    remove_open_interest, settle_pnl, update_funding_indices, Markets, Oracle, PositionDirection,
    ProtocolConfig, UserAccount,
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

pub fn handler(
    ctx: Context<UpdatePosition>,
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // CRITICAL: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    let oracle_price = get_oracle_price(&ctx.accounts.oracle, token_mint)?;

    // Realize the pnl of the existing position
    let position_before = ctx
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

    let price_pnl = calculate_price_pnl(&position_before, oracle_price)?;
    let funding_pnl = calculate_funding_pnl(&position_before, perps_market)?;
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
        &ctx.accounts.user_collateral_token_account,
        &ctx.accounts.vault,
        &ctx.accounts.token_program,
        &[collateral_seeds],
        &[vault_seeds],
    )?;

    // Update the market OI
    let old_entry_notional =
        calculate_notional(position_before.position_size, position_before.entry_price)?;
    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    remove_open_interest(perps_market, position_before.direction, old_entry_notional)?;

    let new_notional = calculate_notional(size, oracle_price)?;

    add_open_interest(perps_market, direction, new_notional)?;

    // Update the position
    let new_funding_index = match direction {
        PositionDirection::Long => perps_market.cumulative_funding_long,
        PositionDirection::Short => perps_market.cumulative_funding_short,
    };

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
    position.entry_funding_index = new_funding_index;

    // Health check
    ctx.accounts.user_collateral_token_account.reload()?;
    ctx.accounts.vault.reload()?;
    let token_balance = ctx.accounts.user_collateral_token_account.amount;

    check_user_account_health(
        &ctx.accounts.user_account,
        &ctx.accounts.markets,
        &ctx.accounts.oracle,
        token_balance,
    )?;

    Ok(())
}
