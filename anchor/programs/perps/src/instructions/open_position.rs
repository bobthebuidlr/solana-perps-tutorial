use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    calculate_account_health, constants::*, error::ErrorCode, update_funding_indices, Markets,
    Oracle, Position, PositionDirection, UserAccount, LEVERAGE_PRECISION,
};

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct OpenPosition<'info> {
    /// User opening the position
    #[account(mut)]
    pub user: Signer<'info>,

    /// User collateral account
    #[account(mut,
      seeds = [USER_SEED, user.key().as_ref()],
      bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
      init,
      payer = user,
      space = ANCHOR_DISCRIMINATOR + Position::INIT_SPACE,
      seeds = [POSITION_SEED, user.key().as_ref(), token_mint.to_bytes().as_ref()],
      bump
    )]
    pub position: Account<'info, Position>,

    #[account(mut)]
    pub markets: Account<'info, Markets>,

    pub oracle: Account<'info, Oracle>,

    /// Per-user collateral token account PDA — read to check available balance
    #[account(
        seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
        bump
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

/// Opens a new leveraged position in a perps market.
/// Pass existing open positions as remaining_accounts for cross-margin health check.
/// @param ctx - Accounts context.
/// @param token_mint - The token mint of the market.
/// @param direction - Long or Short.
/// @param size - Token quantity in 6-decimal fixed point (e.g. 1 SOL = 1_000_000).
/// @param leverage - Leverage multiplier in 6-decimal (e.g. 5_000_000 = 5x, 1_000_000 = 1x).
/// @returns Ok(()) on success.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, OpenPosition<'info>>,
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64,
    leverage: u64,
) -> Result<()> {
    let token_balance = ctx.accounts.user_collateral_token_account.amount;
    let user_account_key = ctx.accounts.user_account.key();

    // Read spot price and max leverage before mutable borrow
    let spot_price = ctx
        .accounts
        .oracle
        .prices
        .iter()
        .find(|p| p.token_mint == token_mint)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?
        .price;

    let market_max_leverage = ctx
        .accounts
        .markets
        .perps
        .iter()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?
        .max_leverage;

    // Validate leverage bounds
    require!(leverage >= LEVERAGE_PRECISION, ErrorCode::ExceedsMaxLeverage);
    require!(leverage <= market_max_leverage, ErrorCode::ExceedsMaxLeverage);

    // Compute notional value: size * spot_price / 10^6
    let notional = (size as u128)
        .checked_mul(spot_price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Compute required collateral (margin): notional * LEVERAGE_PRECISION / leverage
    let collateral_usdc = notional
        .checked_mul(LEVERAGE_PRECISION as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(leverage as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    // Cross-margin check: ensure account can afford this new position
    // Collect existing positions from remaining_accounts
    let mut existing_positions: Vec<Position> = Vec::new();
    for account_info in ctx.remaining_accounts.iter() {
        if let Ok(pos) = Account::<Position>::try_from(account_info) {
            if pos.user_account == user_account_key {
                existing_positions.push(pos.into_inner());
            }
        }
    }

    // Calculate current account health (immutable borrow of markets/oracle)
    let (current_equity, current_maintenance) = calculate_account_health(
        &existing_positions,
        &ctx.accounts.markets,
        &ctx.accounts.oracle,
        token_balance,
    )?;

    // Equity must cover existing maintenance margin + new position's initial margin
    require!(
        current_equity >= current_maintenance as i64 + collateral_usdc as i64,
        ErrorCode::InsufficientCollateral
    );

    // Now take mutable borrows for state updates
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // CRITICAL: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    // Initialize position
    let user_account = &mut ctx.accounts.user_account;
    let position = &mut ctx.accounts.position;
    position.user_account = user_account.key();
    position.perps_market = perps_market.token_mint;
    position.direction = direction;
    position.entry_price = spot_price;
    position.position_size = size;
    position.collateral = collateral_usdc;
    position.entry_funding_index = match direction {
        PositionDirection::Long => perps_market.cumulative_funding_long,
        PositionDirection::Short => perps_market.cumulative_funding_short,
    };
    position.opened_at = clock.unix_timestamp;
    position.bump = ctx.bumps.position;

    // Update market open interest in notional (USDC) terms
    let notional_u64 = notional as u64;
    match direction {
        PositionDirection::Long => {
            perps_market.total_long_oi = perps_market
                .total_long_oi
                .checked_add(notional_u64)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            perps_market.total_short_oi = perps_market
                .total_short_oi
                .checked_add(notional_u64)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }

    msg!("Position opened successfully");
    msg!("Direction: {:?}", direction);
    msg!("Token quantity: {} (6-decimal)", size);
    msg!("Leverage: {}x", leverage / LEVERAGE_PRECISION);
    msg!("Notional: {} USDC (6-decimal)", notional_u64);
    msg!("Margin: {} USDC (6-decimal)", collateral_usdc);
    msg!("Entry price: {}", spot_price);
    msg!("Entry funding index: {}", position.entry_funding_index);
    msg!("Total Long OI: {}", perps_market.total_long_oi);
    msg!("Total Short OI: {}", perps_market.total_short_oi);

    Ok(())
}
