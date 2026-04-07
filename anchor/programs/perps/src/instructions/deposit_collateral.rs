use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{constants::*, error::ErrorCode, state::UserAccount};

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    /// User depositing collateral
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
      init_if_needed,
      payer = user,
      space = ANCHOR_DISCRIMINATOR + UserAccount::INIT_SPACE,
      seeds = [USER_SEED, user.key().as_ref()],
      bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
      mut,
      constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Per-user collateral token account PDA — holds the user's deposited USDC
    #[account(
      init_if_needed,
      payer = user,
      seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
      bump,
      token::mint = usdc_mint,
      token::authority = user_collateral_token_account
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Deposits USDC from the user's wallet into their per-user collateral token account.
/// @param ctx - Accounts context.
/// @param amount - Amount of USDC (6-decimal) to deposit.
/// @returns Ok(()) on success.
pub fn handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let user_account = &mut ctx.accounts.user_account;

    if user_account.authority == Pubkey::default() {
        user_account.authority = ctx.accounts.user.key();
        user_account.locked_collateral = 0;
        user_account.bump = ctx.bumps.user_account;
    }

    // Transfer tokens from user wallet to user's collateral token account
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx
            .accounts
            .user_collateral_token_account
            .to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx: CpiContext<'_, '_, '_, '_, Transfer<'_>> =
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

    token::transfer(cpi_ctx, amount)?;

    msg!("User deposited {} tokens", amount);

    Ok(())
}
