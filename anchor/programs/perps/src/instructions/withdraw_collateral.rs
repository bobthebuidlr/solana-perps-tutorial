use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{constants::*, error::ErrorCode, state::UserAccount};

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

    /// Per-user collateral token account PDA — signs outbound transfers
    #[account(
        mut,
        seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
        bump
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    /// User's USDC token account to receive the withdrawn collateral
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::UnauthorizedAccess
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Withdraws the specified amount of available (unlocked) collateral from the user's collateral token account to the user's wallet.
/// @param ctx - Accounts context.
/// @param amount - Amount of USDC (6-decimal) to withdraw.
/// @returns Ok(()) on success.
pub fn handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let user_account = &ctx.accounts.user_account;
    let token_balance = ctx.accounts.user_collateral_token_account.amount;

    let available = user_account.available_collateral(token_balance)?;
    require!(available >= amount, ErrorCode::InsufficientCollateral);

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
