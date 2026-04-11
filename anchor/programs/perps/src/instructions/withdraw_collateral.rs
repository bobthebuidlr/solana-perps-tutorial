use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    calculate_account_health, constants::*, error::ErrorCode, state::UserAccount, Markets, Oracle,
    Position, ProtocolConfig,
};

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_SEED, user.key().as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

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
        constraint = user_token_account.owner == user.key() @ ErrorCode::UnauthorizedAccess,
        token::mint = config.usdc_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub markets: Account<'info, Markets>,
    pub oracle: Account<'info, Oracle>,
    pub token_program: Program<'info, Token>,
}

/// Withdraws collateral to the user's wallet.
/// Pass all open positions as remaining_accounts for cross-margin health check.
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, WithdrawCollateral<'info>>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let token_balance = ctx.accounts.user_collateral_token_account.amount;
    require!(token_balance >= amount, ErrorCode::InsufficientCollateral);

    // Cross-margin health check
    if !ctx.remaining_accounts.is_empty() {
        let user_account = &ctx.accounts.user_account;
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

    Ok(())
}
