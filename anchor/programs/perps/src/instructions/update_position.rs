use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    calculate_account_health, calculate_funding_pnl, calculate_price_pnl, constants::*,
    error::ErrorCode, update_funding_indices, Markets, Oracle, Position, PositionDirection,
    ProtocolConfig, UserAccount, LEVERAGE_PRECISION,
};

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct UpdatePosition<'info> {
    /// User updating the position
    #[account(mut)]
    pub user: Signer<'info>,

    /// User account PDA
    #[account(mut,
      seeds = [USER_SEED, user.key().as_ref()],
      bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    /// Existing position being updated
    #[account(
      mut,
      seeds = [POSITION_SEED, user.key().as_ref(), token_mint.to_bytes().as_ref()],
      bump = position.bump
    )]
    pub position: Account<'info, Position>,

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

/// Updates an existing position: realizes current PnL and resets with new parameters.
/// Pass other open positions as remaining_accounts for cross-margin health check.
/// @param ctx - Accounts context.
/// @param token_mint - The token mint of the market.
/// @param direction - New direction (Long or Short, can flip).
/// @param size - New token quantity in 6-decimal fixed point.
/// @param leverage - New leverage multiplier in 6-decimal.
/// @returns Ok(()) on success.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdatePosition<'info>>,
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64,
    leverage: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // CRITICAL: Update funding indices BEFORE OI changes
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    // Resolve market and oracle price
    let oracle_price = ctx
        .accounts
        .oracle
        .prices
        .iter()
        .find(|p| p.token_mint == token_mint)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))?
        .price;

    let market_max_leverage = markets
        .perps
        .iter()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?
        .max_leverage;

    // Validate new leverage bounds
    require!(leverage >= LEVERAGE_PRECISION, ErrorCode::ExceedsMaxLeverage);
    require!(leverage <= market_max_leverage, ErrorCode::ExceedsMaxLeverage);

    // --- Step 1: Realize PnL on existing position ---
    let position = &ctx.accounts.position;
    let perps_market = markets
        .perps
        .iter()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    let price_pnl = calculate_price_pnl(position, oracle_price)?;
    let funding_pnl = calculate_funding_pnl(position, perps_market, None)?;
    let total_pnl = price_pnl
        .checked_add(funding_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let old_position_size = position.position_size;
    let old_entry_price = position.entry_price;
    let old_direction = position.direction;
    let old_collateral = position.collateral;

    // Settle PnL with token transfers
    if total_pnl < 0 {
        // User lost — transfer loss from user collateral to vault
        let abs_loss = total_pnl.unsigned_abs();
        let loss_amount = abs_loss
            .min(old_collateral)
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

    // --- Step 2: Remove old OI ---
    let old_entry_notional = (old_position_size as u128)
        .checked_mul(old_entry_price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    let perps_market = markets
        .perps
        .iter_mut()
        .find(|m| m.token_mint == token_mint)
        .ok_or(error!(ErrorCode::MarketNotFound))?;

    match old_direction {
        PositionDirection::Long => {
            perps_market.total_long_oi = perps_market
                .total_long_oi
                .checked_sub(old_entry_notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            perps_market.total_short_oi = perps_market
                .total_short_oi
                .checked_sub(old_entry_notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }

    // --- Step 3: Compute new position values ---
    let new_notional = (size as u128)
        .checked_mul(oracle_price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let new_collateral = new_notional
        .checked_mul(LEVERAGE_PRECISION as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(leverage as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;

    // Add new OI
    let new_notional_u64 = new_notional as u64;
    match direction {
        PositionDirection::Long => {
            perps_market.total_long_oi = perps_market
                .total_long_oi
                .checked_add(new_notional_u64)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            perps_market.total_short_oi = perps_market
                .total_short_oi
                .checked_add(new_notional_u64)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }

    let new_funding_index = match direction {
        PositionDirection::Long => perps_market.cumulative_funding_long,
        PositionDirection::Short => perps_market.cumulative_funding_short,
    };

    // --- Step 4: Cross-margin health check ---
    // Reload token balance after PnL settlement
    ctx.accounts.user_collateral_token_account.reload()?;
    let token_balance = ctx.accounts.user_collateral_token_account.amount;
    let user_account_key = ctx.accounts.user_account.key();

    // Collect other open positions from remaining_accounts (excluding this one)
    let position_key = ctx.accounts.position.key();
    let mut existing_positions: Vec<Position> = Vec::new();
    for account_info in ctx.remaining_accounts.iter() {
        if let Ok(pos) = Account::<Position>::try_from(account_info) {
            if pos.user_account == user_account_key && pos.key() != position_key {
                existing_positions.push(pos.into_inner());
            }
        }
    }

    // Build a temporary position with the new values for health check
    let mut new_position_snapshot = ctx.accounts.position.clone().into_inner();
    new_position_snapshot.direction = direction;
    new_position_snapshot.entry_price = oracle_price;
    new_position_snapshot.position_size = size;
    new_position_snapshot.collateral = new_collateral;
    new_position_snapshot.entry_funding_index = new_funding_index;
    existing_positions.push(new_position_snapshot);

    let (current_equity, current_maintenance) = calculate_account_health(
        &existing_positions,
        &ctx.accounts.markets,
        &ctx.accounts.oracle,
        token_balance,
    )?;

    require!(
        current_equity >= current_maintenance as i64,
        ErrorCode::InsufficientCollateral
    );

    // --- Step 5: Reset position fields ---
    let position = &mut ctx.accounts.position;
    position.direction = direction;
    position.entry_price = oracle_price;
    position.position_size = size;
    position.collateral = new_collateral;
    position.entry_funding_index = new_funding_index;
    position.opened_at = clock.unix_timestamp;

    msg!("Position updated successfully");
    msg!("Realized PnL: {} (price: {}, funding: {})", total_pnl, price_pnl, funding_pnl);
    msg!("New direction: {:?}", direction);
    msg!("New size: {} (6-decimal)", size);
    msg!("New entry price: {}", oracle_price);
    msg!("New collateral: {} USDC (6-decimal)", new_collateral);

    Ok(())
}
