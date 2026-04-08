use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    calculate_account_health, constants::*, error::ErrorCode, state::UserAccount, Markets, Oracle,
    Position, ProtocolConfig,
};

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    /// User withdrawing collateral
    #[account(mut)]
    pub user: Signer<'info>,

    /// User collateral account
    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    /// Protocol config — validates accepted USDC mint
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Per-user collateral token account PDA — signs outbound transfers
    #[account(
        mut,
        seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
        bump,
        token::mint = config.usdc_mint
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    /// User's USDC token account to receive the withdrawn collateral
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::UnauthorizedAccess,
        token::mint = config.usdc_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Markets account — needed for maintenance margin ratios
    pub markets: Account<'info, Markets>,

    /// Oracle account — needed for current prices
    pub oracle: Account<'info, Oracle>,

    pub token_program: Program<'info, Token>,
}

/// Withdraws collateral from the user's collateral token account to the user's wallet.
/// Checks that withdrawal does not put the account below maintenance margin.
/// Pass all open position accounts as remaining_accounts for cross-margin health check.
/// @param ctx - Accounts context.
/// @param amount - Amount of USDC (6-decimal) to withdraw.
/// @returns Ok(()) on success.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, WithdrawCollateral<'info>>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let user_account = &ctx.accounts.user_account;
    let token_balance = ctx.accounts.user_collateral_token_account.amount;

    require!(token_balance >= amount, ErrorCode::InsufficientCollateral);

    // Cross-margin health check: if positions exist in remaining_accounts,
    // verify withdrawal doesn't breach maintenance margin
    if !ctx.remaining_accounts.is_empty() {
        let mut positions: Vec<Position> = Vec::new();
        for account_info in ctx.remaining_accounts.iter() {
            if let Ok(position) = Account::<Position>::try_from(account_info) {
                if position.user_account == user_account.key() {
                    positions.push(position.into_inner());
                }
            }
        }

        if !positions.is_empty() {
            let post_withdrawal_balance = token_balance
                .checked_sub(amount)
                .ok_or(ErrorCode::ArithmeticOverflow)?;

            let (total_equity, total_maintenance_margin) = calculate_account_health(
                &positions,
                &ctx.accounts.markets,
                &ctx.accounts.oracle,
                post_withdrawal_balance,
            )?;

            require!(
                total_equity >= total_maintenance_margin as i64,
                ErrorCode::BelowMaintenanceMargin
            );
        }
    }

    // CPI: user collateral PDA signs the transfer to user_token_account
    let collateral_bump = ctx.bumps.user_collateral_token_account;
    let user_key = ctx.accounts.user.key();
    let collateral_seeds: &[&[u8]] =
        &[USER_COLLATERAL_SEED, user_key.as_ref(), &[collateral_bump]];
    let signer_seeds = &[collateral_seeds];

    let cpi_accounts = Transfer {
        from: ctx
            .accounts
            .user_collateral_token_account
            .to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
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
    token::transfer(cpi_ctx, amount)?;

    msg!("Withdrew {} USDC (6-decimal) to user", amount);

    Ok(())
}
