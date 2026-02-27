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

    /// Vault PDA that holds all user USDC — signs outbound transfers
    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// User's USDC token account to receive the withdrawn collateral
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::UnauthorizedAccess
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Withdraws all available (unlocked) collateral from the vault to the user's token account.
/// @param ctx - Accounts context.
/// @returns Ok(()) on success.
pub fn handler(ctx: Context<WithdrawCollateral>) -> Result<()> {
    let user_account = &mut ctx.accounts.user_account;

    let available = user_account.available_collateral()?;
    require!(available > 0, ErrorCode::CollateralLocked);

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
    token::transfer(cpi_ctx, available)?;

    // Deduct withdrawn amount from user's recorded collateral
    user_account.collateral = user_account
        .collateral
        .checked_sub(available)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    msg!("Withdrew {} USDC (6-decimal) to user", available);

    Ok(())
}
