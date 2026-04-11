use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    calculate_account_health, calculate_funding_pnl, calculate_notional, calculate_price_pnl,
    constants::*, error::ErrorCode, get_oracle_price, remove_open_interest, settle_pnl,
    update_funding_indices, Markets, Oracle, ProtocolConfig, UserAccount,
};

#[derive(Accounts)]
#[instruction(liquidatee: Pubkey)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        token::mint = config.usdc_mint
    )]
    pub liquidator_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [USER_SEED, liquidatee.as_ref()],
        bump = user_account.bump
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [USER_COLLATERAL_SEED, liquidatee.as_ref()],
        bump,
        token::mint = config.usdc_mint
    )]
    pub user_collateral_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub markets: Account<'info, Markets>,

    pub oracle: Account<'info, Oracle>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump,
        token::mint = config.usdc_mint
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Permissionlessly liquidates an underwater user account. Any signer can call this
/// against any `liquidatee` whose equity has dropped below maintenance margin. All
/// positions are force-closed, PnL is settled, and the liquidator is paid a bonus
/// equal to LIQUIDATION_FEE_RATIO of the total liquidated notional (capped by
/// whatever collateral remains after PnL settlement).
///
/// @param ctx Liquidate accounts context
/// @param liquidatee Pubkey of the user being liquidated (binds user_account + collateral PDAs)
/// @return Result<()>
pub fn handler(ctx: Context<Liquidate>, liquidatee: Pubkey) -> Result<()> {
    let clock = Clock::get()?;
    let markets = &mut ctx.accounts.markets;

    // IMPORTANT: Update funding indices BEFORE OI changes so health + PnL use
    // the same accrued funding numbers.
    update_funding_indices(&mut markets.perps, clock.unix_timestamp)?;

    let token_balance = ctx.accounts.user_collateral_token_account.amount;

    require!(
        !ctx.accounts.user_account.positions.is_empty(),
        ErrorCode::NoPositionsToLiquidate
    );

    let (equity, maintenance, _initial) = calculate_account_health(
        &ctx.accounts.user_account.positions,
        markets,
        &ctx.accounts.oracle,
        token_balance,
    )?;

    // The trigger threshold is maintenance + the upfront bonus reservation, not
    // just maintenance. Reserving room for the bonus inside the trigger means
    // that at the moment of liquidation there is provably enough equity to
    // pay LIQUIDATION_FEE_RATIO of notional AND leave the user with the
    // maintenance buffer — so the protocol is not silently subsidising the
    // liquidator out of the vault when the timing is tight. Late/gap
    // liquidations beyond this point can still eat into bonus or vault, but
    // the trigger now fires as early as the protocol allows.
    let mut total_current_notional: u128 = 0;
    for position in ctx.accounts.user_account.positions.iter() {
        let price = get_oracle_price(&ctx.accounts.oracle, position.perps_market)?;
        let notional = calculate_notional(position.position_size, price)?;
        total_current_notional = total_current_notional
            .checked_add(notional as u128)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    let bonus_reserve = total_current_notional
        .checked_mul(LIQUIDATION_FEE_RATIO as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(MARGIN_PRECISION as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64;
    let trigger_threshold = maintenance
        .checked_add(bonus_reserve)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        equity < trigger_threshold as i64,
        ErrorCode::AccountNotLiquidatable
    );

    // Snapshot positions out so we can mutate `markets` while iterating.
    let positions_snapshot = ctx.accounts.user_account.positions.clone();

    let collateral_bump = ctx.bumps.user_collateral_token_account;
    let collateral_seeds: &[&[u8]] =
        &[USER_COLLATERAL_SEED, liquidatee.as_ref(), &[collateral_bump]];
    let vault_bump = ctx.bumps.vault;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];

    for position in positions_snapshot.iter() {
        let perps_market = markets
            .perps
            .iter_mut()
            .find(|m| m.token_mint == position.perps_market)
            .ok_or(error!(ErrorCode::MarketNotFound))?;

        let oracle_price = get_oracle_price(&ctx.accounts.oracle, position.perps_market)?;

        let price_pnl = calculate_price_pnl(position, oracle_price)?;
        let funding_pnl = calculate_funding_pnl(position, perps_market)?;
        let total_pnl = price_pnl
            .checked_add(funding_pnl)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let entry_notional = calculate_notional(position.position_size, position.entry_price)?;

        settle_pnl(
            total_pnl,
            &ctx.accounts.user_collateral_token_account,
            &ctx.accounts.vault,
            &ctx.accounts.token_program,
            &[collateral_seeds],
            &[vault_seeds],
        )?;

        remove_open_interest(perps_market, position.direction, entry_notional)?;

        // Reload so subsequent settle_pnl calls see the updated balances (the
        // next position's loss cap depends on what collateral is still here).
        ctx.accounts.user_collateral_token_account.reload()?;
        ctx.accounts.vault.reload()?;
    }

    ctx.accounts.user_account.positions.clear();

    // Bonus reservation was already computed at trigger-check time from the
    // same current notionals. It is still capped by whatever collateral
    // remains after settlement — in a bankrupt/late-liquidation case this can
    // land at zero, meaning the protocol absorbs the shortfall.
    let available = ctx.accounts.user_collateral_token_account.amount;
    let bonus = bonus_reserve.min(available);

    if bonus > 0 {
        let cpi_accounts = Transfer {
            from: ctx
                .accounts
                .user_collateral_token_account
                .to_account_info(),
            to: ctx.accounts.liquidator_token_account.to_account_info(),
            authority: ctx
                .accounts
                .user_collateral_token_account
                .to_account_info(),
        };
        let signer_seeds: &[&[&[u8]]] = &[collateral_seeds];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, bonus)?;
    }

    Ok(())
}
