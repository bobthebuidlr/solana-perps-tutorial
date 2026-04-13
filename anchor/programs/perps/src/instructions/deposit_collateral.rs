use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{constants::*, error::ErrorCode, state::UserAccount, ProtocolConfig};

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
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
      seeds = [CONFIG_SEED],
      bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
      mut,
      constraint = user_token_account.owner == user.key(),
      token::mint = config.usdc_mint
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Per-user collateral token account PDA
    #[account(
      init_if_needed,
      payer = user,
      seeds = [USER_COLLATERAL_SEED, user.key().as_ref()],
      bump,
      token::mint = usdc_mint,
      token::authority = user_collateral_token_account
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Deposits USDC from the user's wallet into their collateral account.
pub fn handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::InvalidAmount);

    let user_account = &mut ctx.accounts.user_account;

    // Initialize the values of the user account if it doesn't exist
    if user_account.authority == Pubkey::default() {
        user_account.authority = ctx.accounts.user.key();
        user_account.bump = ctx.bumps.user_account;
    }

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.user_collateral_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    Ok(())
}
