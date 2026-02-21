use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

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

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let user_account = &mut ctx.accounts.user_account;

    if user_account.authority == Pubkey::default() {
        user_account.authority = ctx.accounts.user.key();
        user_account.collateral = 0;
        user_account.locked_collateral = 0;
        user_account.positions = Vec::with_capacity(MAX_POSITIONS);
        user_account.bump = ctx.bumps.user_account;
    }

    // Transfer tokens from user to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx: CpiContext<'_, '_, '_, '_, Transfer<'_>> =
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

    token::transfer(cpi_ctx, amount)?;

    // Update user collateral
    user_account.collateral = user_account
        .collateral
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    msg!("User deposited {} tokens", amount);
    msg!("User collateral: {}", user_account.collateral);

    Ok(())
}
