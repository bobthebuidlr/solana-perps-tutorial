use anchor_lang::prelude::*;

use crate::{
    calculate_mark_price, constants::*, error::ErrorCode, update_funding_indices, Markets, Oracle,
    Position, PositionDirection, UserAccount,
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

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<OpenPosition>,
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64,
) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    let user_account = &mut ctx.accounts.user_account;
    let position = &mut ctx.accounts.position;
    let markets = &mut ctx.accounts.markets;
    let clock = Clock::get()?;

    let available = user_account.available_collateral()?;
    require!(available >= size, ErrorCode::InsufficientCollateral);

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

    // Calculate current mark price based on open interest
    let mark_price = calculate_mark_price(
        spot_price,
        perps_market.total_long_oi,
        perps_market.total_short_oi,
        perps_market.mark_adjustment_factor,
    )?;

    // Initialize position
    position.user_account = user_account.key();
    position.perps_market = perps_market.token_mint;
    position.direction = direction;
    position.entry_price = mark_price;
    position.position_size = size;
    position.collateral = size; // 1x leverage: collateral = size
                                // Store current cumulative funding index for this position
    position.entry_funding_index = match direction {
        PositionDirection::Long => perps_market.cumulative_funding_long,
        PositionDirection::Short => perps_market.cumulative_funding_short,
    };
    position.opened_at = clock.unix_timestamp;
    position.bump = ctx.bumps.position;

    // Lock collateral in user account
    user_account.locked_collateral = user_account
        .locked_collateral
        .checked_add(size)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Add position to user's position list
    user_account.positions.push(position.key());

    // Update market open interest
    match direction {
        PositionDirection::Long => {
            perps_market.total_long_oi = perps_market
                .total_long_oi
                .checked_add(size)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            perps_market.total_short_oi = perps_market
                .total_short_oi
                .checked_add(size)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }

    msg!("Position opened successfully");
    msg!("Direction: {:?}", direction);
    msg!("Size: {} USDC", size);
    msg!("Entry price: {}", mark_price);
    msg!("Entry funding index: {}", position.entry_funding_index);
    msg!("Spot price: {}", spot_price);
    msg!("Total Long OI: {}", perps_market.total_long_oi);
    msg!("Total Short OI: {}", perps_market.total_short_oi);

    Ok(())
}
