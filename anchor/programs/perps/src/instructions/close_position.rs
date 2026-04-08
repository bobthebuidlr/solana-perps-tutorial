use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    calculate_funding_pnl, calculate_price_pnl, constants::*, error::ErrorCode,
    update_funding_indices, Markets, Oracle, Position, PositionDirection, ProtocolConfig,
    UserAccount,
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

    /// Protocol config — validates accepted USDC mint
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Per-user collateral token account PDA
    #[account(
        mut,
        seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
        bump,
        token::mint = config.usdc_mint
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    /// Vault (LP pool) token account
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump,
        token::mint = config.usdc_mint
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Closes an open position and settles PnL with actual token transfers.
/// Losses are transferred from user collateral to the vault (LP pool).
/// Profits are transferred from the vault to user collateral.
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

    let position_collateral = position.collateral;
    let position_direction = position.direction;

    // Compute entry notional for OI adjustment (position_size * entry_price / 10^6)
    let entry_notional = (position.position_size as u128)
        .checked_mul(position.entry_price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    // Settle PnL with actual token transfers
    if total_pnl < 0 {
        // User lost — transfer loss from user collateral to vault
        // Cap loss at position collateral (with leverage, losses can exceed margin)
        let abs_loss = total_pnl.unsigned_abs();
        let loss_amount = abs_loss
            .min(position_collateral)
            .min(ctx.accounts.user_collateral_token_account.amount);

        if loss_amount > 0 {
            let user_key = ctx.accounts.user.key();
            let collateral_bump = ctx.bumps.user_collateral_token_account;
            let collateral_seeds: &[&[u8]] =
                &[USER_COLLATERAL_SEED, user_key.as_ref(), &[collateral_bump]];
            let signer_seeds = &[collateral_seeds];

            let cpi_accounts = Transfer {
                from: ctx
                    .accounts
                    .user_collateral_token_account
                    .to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx
                    .accounts
                    .user_collateral_token_account
                    .to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                cpi_accounts,
                signer_seeds,
            );
            token::transfer(cpi_ctx, loss_amount)?;
        }
    } else if total_pnl > 0 {
        // User won — transfer profit from vault to user collateral
        let profit_amount = total_pnl as u64;
        require!(
            ctx.accounts.vault.amount >= profit_amount,
            ErrorCode::InsufficientVaultFunds
        );

        let vault_bump = ctx.bumps.vault;
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
        let signer_seeds = &[vault_seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx
                .accounts
                .user_collateral_token_account
                .to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, profit_amount)?;
    }

    // Decrease market OI by entry notional (matches what was added on open)
    match position_direction {
        PositionDirection::Long => {
            perps_market.total_long_oi = perps_market
                .total_long_oi
                .checked_sub(entry_notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            perps_market.total_short_oi = perps_market
                .total_short_oi
                .checked_sub(entry_notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }

    msg!("Position closed successfully");
    msg!("Price PnL: {}", price_pnl);
    msg!("Funding PnL: {}", funding_pnl);
    msg!("Total PnL: {}", total_pnl);

    Ok(())
}
