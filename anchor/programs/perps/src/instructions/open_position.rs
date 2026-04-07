use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    constants::*, error::ErrorCode, update_funding_indices, Markets, Oracle, Position,
    PositionDirection, UserAccount,
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

pub fn handler(
    ctx: Context<OpenPosition>,
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64, // token quantity in 6-decimal fixed point (e.g. 1 SOL = 1_000_000)
) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let user_account = &mut ctx.accounts.user_account;
    let position = &mut ctx.accounts.position;
    let markets = &mut ctx.accounts.markets;
    let clock = Clock::get()?;

    // CRITICAL: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    let oracle_price = oracle
        .prices
        .iter_mut()
        .find(|p| p.token_mint == token_mint)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?;
    // Get current spot price from oracle
    let spot_price = oracle_price.price;

    // Compute USDC collateral required: quantity * spot_price / 10^6
    // Both size and spot_price are 6-decimal fixed point, so divide by 10^6 to get USDC base units
    let collateral_usdc = (size as u128)
        .checked_mul(spot_price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    let token_balance = ctx.accounts.user_collateral_token_account.amount;
    let available = user_account.available_collateral(token_balance)?;
    require!(
        available >= collateral_usdc,
        ErrorCode::InsufficientCollateral
    );

    // Initialize position
    position.user_account = user_account.key();
    position.perps_market = perps_market.token_mint;
    position.direction = direction;
    position.entry_price = spot_price;
    position.position_size = size; // token quantity (6-decimal)
    position.collateral = collateral_usdc; // USDC collateral locked (6-decimal)
                                           // Store current cumulative funding index for this position
    position.entry_funding_index = match direction {
        PositionDirection::Long => perps_market.cumulative_funding_long,
        PositionDirection::Short => perps_market.cumulative_funding_short,
    };
    position.opened_at = clock.unix_timestamp;
    position.bump = ctx.bumps.position;

    // Lock USDC collateral in user account
    user_account.locked_collateral = user_account
        .locked_collateral
        .checked_add(collateral_usdc)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Update market open interest in USDC terms
    match direction {
        PositionDirection::Long => {
            perps_market.total_long_oi = perps_market
                .total_long_oi
                .checked_add(collateral_usdc)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            perps_market.total_short_oi = perps_market
                .total_short_oi
                .checked_add(collateral_usdc)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }

    msg!("Position opened successfully");
    msg!("Direction: {:?}", direction);
    msg!("Token quantity: {} (6-decimal)", size);
    msg!("Collateral locked: {} USDC (6-decimal)", collateral_usdc);
    msg!("Entry price: {}", spot_price);
    msg!("Entry funding index: {}", position.entry_funding_index);
    msg!("Total Long OI: {}", perps_market.total_long_oi);
    msg!("Total Short OI: {}", perps_market.total_short_oi);

    Ok(())
}
