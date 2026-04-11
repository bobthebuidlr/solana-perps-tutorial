use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, Markets, Oracle, ProtocolConfig, ANCHOR_DISCRIMINATOR};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
      init,
      payer = authority,
      space = ANCHOR_DISCRIMINATOR + Markets::INIT_SPACE,
      seeds = [MARKETS_SEED],
      bump
    )]
    pub markets: Account<'info, Markets>,

    #[account(
      init,
      payer = authority,
      space = ANCHOR_DISCRIMINATOR + Oracle::INIT_SPACE,
      seeds = [ORACLE_SEED],
      bump
    )]
    pub oracle: Account<'info, Oracle>,

    #[account(
      init,
      payer = authority,
      space = ANCHOR_DISCRIMINATOR + ProtocolConfig::INIT_SPACE,
      seeds = [CONFIG_SEED],
      bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
      init,
      payer = authority,
      seeds = [VAULT_SEED],
      bump,
      token::mint = usdc_mint,
      token::authority = vault
    )]
    pub vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Initializes the protocol: Markets, Oracle, ProtocolConfig, and Vault.
pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.markets.perps = Vec::new();
    ctx.accounts.oracle.prices = Vec::new();

    let config = &mut ctx.accounts.config;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.bump = ctx.bumps.config;

    Ok(())
}
