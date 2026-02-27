use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

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

    /// Vault PDA that holds all user USDC — signs outbound transfers
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// User's USDC token account to receive settlement
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::UnauthorizedAccess
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Closes an open position and settles PnL from the vault to the user's token account.
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

    // Settlement = collateral + PnL, floored at 0 (trader cannot owe more than collateral)
    let settlement_amount = (position.collateral as i64)
        .checked_add(total_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .max(0) as u64;

    require!(
        ctx.accounts.vault.amount >= settlement_amount,
        ErrorCode::InsufficientVaultFunds
    );

    // CPI: vault PDA signs the transfer to user_token_account
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
    let signer_seeds = &[vault_seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, settlement_amount)?;

    let position_collateral = position.collateral;
    let position_direction = position.direction;
    let position_key = ctx.accounts.position.key();

    // Update user account: deduct the actual vault outflow from collateral tracking,
    // then release the locked amount. Using saturating_sub because a large profit could
    // theoretically exceed the user's own recorded collateral (funded by pool reserves).
    let user_account = &mut ctx.accounts.user_account;
    user_account.collateral = user_account.collateral.saturating_sub(settlement_amount);
    user_account.locked_collateral = user_account
        .locked_collateral
        .checked_sub(position_collateral)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Remove position from the user's positions list
    user_account.positions.retain(|p| *p != position_key);

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
    msg!("Settlement paid: {} USDC (6-decimal)", settlement_amount);

    Ok(())
}
