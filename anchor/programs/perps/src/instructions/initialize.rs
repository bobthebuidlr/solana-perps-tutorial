use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, Markets, Oracle, ANCHOR_DISCRIMINATOR};

const VAULT_SEED: &[u8] = b"vault";

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

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let markets = &mut ctx.accounts.markets;
    let oracle = &mut ctx.accounts.oracle;
    markets.perps = Vec::new();
    oracle.prices = Vec::new();
    Ok(())
}
