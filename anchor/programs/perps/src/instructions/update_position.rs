use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::{
    add_open_interest, calculate_account_health, calculate_funding_pnl, calculate_notional,
    calculate_price_pnl, constants::*, error::ErrorCode, remove_open_interest, settle_pnl,
    update_funding_indices, Markets, Oracle, Position, PositionDirection, ProtocolConfig,
    UserAccount, LEVERAGE_PRECISION,
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

    #[account(
      mut,
      seeds = [POSITION_SEED, user.key().as_ref(), token_mint.to_bytes().as_ref()],
      bump = position.bump
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

/// Realizes current PnL and resets position with new parameters.
/// Pass other open positions as remaining_accounts for cross-margin health check.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdatePosition<'info>>,
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

    let market_max_leverage = markets
        .perps
        .iter()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?
        .max_leverage;

    require!(leverage >= LEVERAGE_PRECISION, ErrorCode::ExceedsMaxLeverage);
    require!(leverage <= market_max_leverage, ErrorCode::ExceedsMaxLeverage);

    // --- Step 1: Realize PnL on existing position ---
    let position = &ctx.accounts.position;
    let perps_market = markets
        .perps
        .iter()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    let price_pnl = calculate_price_pnl(position, oracle_price)?;
    let funding_pnl = calculate_funding_pnl(position, perps_market, None)?;
    let total_pnl = price_pnl
        .checked_add(funding_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let old_position_size = position.position_size;
    let old_entry_price = position.entry_price;
    let old_direction = position.direction;
    let old_collateral = position.collateral;

    let user_key = ctx.accounts.user.key();
    let collateral_bump = ctx.bumps.user_collateral_token_account;
    let collateral_seeds: &[&[u8]] =
        &[USER_COLLATERAL_SEED, user_key.as_ref(), &[collateral_bump]];
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];

    settle_pnl(
        total_pnl,
        old_collateral,
        &ctx.accounts.user_collateral_token_account,
        &ctx.accounts.vault,
        &ctx.accounts.token_program,
        &[collateral_seeds],
        &[vault_seeds],
    )?;

    // --- Step 2: Remove old OI ---
    let old_entry_notional = calculate_notional(old_position_size, old_entry_price)?;
    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    remove_open_interest(perps_market, old_direction, old_entry_notional)?;

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

    // --- Step 4: Cross-margin health check ---
    ctx.accounts.user_collateral_token_account.reload()?;
    let token_balance = ctx.accounts.user_collateral_token_account.amount;
    let user_account_key = ctx.accounts.user_account.key();

    let position_key = ctx.accounts.position.key();
    let mut existing_positions: Vec<Position> = Vec::new();
    for account_info in ctx.remaining_accounts.iter() {
        if let Ok(pos) = Account::<Position>::try_from(account_info) {
            if pos.user_account == user_account_key && pos.key() != position_key {
                existing_positions.push(pos.into_inner());
            }
        }
    }

    // Build temporary position snapshot for health check
    let mut new_position_snapshot = ctx.accounts.position.clone().into_inner();
    new_position_snapshot.direction = direction;
    new_position_snapshot.entry_price = oracle_price;
    new_position_snapshot.position_size = size;
    new_position_snapshot.collateral = new_collateral;
    new_position_snapshot.entry_funding_index = new_funding_index;
    existing_positions.push(new_position_snapshot);

    let (current_equity, current_maintenance) = calculate_account_health(
        &existing_positions,
        &ctx.accounts.markets,
        &ctx.accounts.oracle,
        token_balance,
    )?;

    require!(
        current_equity >= current_maintenance as i64,
        ErrorCode::InsufficientCollateral
    );

    // --- Step 5: Reset position fields ---
    let position = &mut ctx.accounts.position;
    position.direction = direction;
    position.entry_price = oracle_price;
    position.position_size = size;
    position.collateral = new_collateral;
    position.entry_funding_index = new_funding_index;
    position.opened_at = clock.unix_timestamp;

    Ok(())
}
