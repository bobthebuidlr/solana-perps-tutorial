use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{constants::*, error::ErrorCode, Markets, Oracle, PerpsMarket, Position, PositionDirection};

/// Returns price-based PnL in USDC base units (6-decimal).
pub fn calculate_price_pnl(position: &Position, current_price: u64) -> Result<i64> {
    let size = position.position_size as i128;
    let entry = position.entry_price as i128;
    let current = current_price as i128;

    // value = token_qty * price / 10^6
    let value_before = size
        .checked_mul(entry)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let value_after = size
        .checked_mul(current)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    match position.direction {
        PositionDirection::Long => Ok(value_after
            .checked_sub(value_before)
            .ok_or(ErrorCode::ArithmeticOverflow)? as i64),
        PositionDirection::Short => Ok(value_before
            .checked_sub(value_after)
            .ok_or(ErrorCode::ArithmeticOverflow)? as i64),
    }
}

/// Computes notional value at a given price: position_size * price / 10^6.
pub fn position_notional_at_price(position: &Position, price: u64) -> Result<u64> {
    calculate_notional(position.position_size, price)
}

/// Returns (total_equity, total_maintenance_margin) across all open positions.
/// Account is healthy when equity >= maintenance_margin.
pub fn calculate_account_health(
    positions: &[Position],
    markets: &Markets,
    oracle: &Oracle,
    token_balance: u64,
) -> Result<(i64, u64)> {
    let mut total_unrealized_pnl: i64 = 0;
    let mut total_maintenance_margin: u128 = 0;

    for position in positions {
        let perps_market = markets
            .perps
            .iter()
            .find(|m| m.token_mint == position.perps_market)
            .ok_or(error!(ErrorCode::MarketNotFound))?;

        let current_price = oracle
            .prices
            .iter()
            .find(|p| p.token_mint == position.perps_market)
            .ok_or(error!(ErrorCode::OraclePriceNotFound))?
            .price;

        let price_pnl = calculate_price_pnl(position, current_price)?;
        let funding_pnl = calculate_funding_pnl(position, perps_market, None)?;
        let position_pnl = price_pnl
            .checked_add(funding_pnl)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        total_unrealized_pnl = total_unrealized_pnl
            .checked_add(position_pnl)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        let notional = position_notional_at_price(position, current_price)? as u128;
        let maintenance = notional
            .checked_mul(perps_market.maintenance_margin_ratio as u128)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(MARGIN_PRECISION as u128)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        total_maintenance_margin = total_maintenance_margin
            .checked_add(maintenance)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    let total_equity = (token_balance as i64)
        .checked_add(total_unrealized_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok((total_equity, total_maintenance_margin as u64))
}

/// Calculates the funding rate based on OI imbalance.
/// Positive = longs pay shorts, negative = shorts pay longs.
pub fn calculate_funding_rate(total_long_oi: u64, total_short_oi: u64) -> Result<i64> {
    let total_oi = total_long_oi
        .checked_add(total_short_oi)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    if total_oi == 0 {
        return Ok(0);
    }

    // rate = (long - short) / total * MAX_FUNDING_RATE
    let oi_imbalance = (total_long_oi as i128)
        .checked_sub(total_short_oi as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let funding_rate = oi_imbalance
        .checked_mul(MAX_FUNDING_RATE as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(total_oi as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(funding_rate as i64)
}

/// Updates cumulative funding indices for all markets.
/// Must be called BEFORE any OI change to ensure accurate funding accumulation.
pub fn update_funding_indices(
    perps_markets: &mut Vec<PerpsMarket>,
    current_timestamp: i64,
) -> Result<()> {
    for perps_market in perps_markets {
        let time_elapsed = current_timestamp
            .checked_sub(perps_market.last_funding_update)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        if time_elapsed <= 0 {
            return Ok(());
        }

        let intervals = time_elapsed
            .checked_div(FUNDING_INTERVAL)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        if intervals == 0 {
            return Ok(());
        }

        let funding_rate =
            calculate_funding_rate(perps_market.total_long_oi, perps_market.total_short_oi)?;

        let funding_delta = (funding_rate as i128)
            .checked_mul(intervals as i128)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        perps_market.cumulative_funding_long = perps_market
            .cumulative_funding_long
            .checked_add(funding_delta)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        perps_market.cumulative_funding_short = perps_market
            .cumulative_funding_short
            .checked_sub(funding_delta)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        perps_market.last_funding_update = current_timestamp;
    }

    Ok(())
}

/// Calculates what the current funding indices would be without mutating state.
pub fn calculate_current_funding_indices(
    perps_market: &PerpsMarket,
    current_timestamp: i64,
) -> Result<(i128, i128)> {
    let time_elapsed = current_timestamp
        .checked_sub(perps_market.last_funding_update)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    if time_elapsed <= 0 {
        return Ok((
            perps_market.cumulative_funding_long,
            perps_market.cumulative_funding_short,
        ));
    }

    let intervals = time_elapsed
        .checked_div(FUNDING_INTERVAL)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    if intervals == 0 {
        return Ok((
            perps_market.cumulative_funding_long,
            perps_market.cumulative_funding_short,
        ));
    }

    let funding_rate =
        calculate_funding_rate(perps_market.total_long_oi, perps_market.total_short_oi)?;

    let funding_delta = (funding_rate as i128)
        .checked_mul(intervals as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let new_long_index = perps_market
        .cumulative_funding_long
        .checked_add(funding_delta)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let new_short_index = perps_market
        .cumulative_funding_short
        .checked_sub(funding_delta)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok((new_long_index, new_short_index))
}

/// Calculates funding PnL using the cumulative index approach.
/// Uses entry notional (not collateral) so funding scales with leverage.
///
/// The two cumulative indices move in opposite directions (long += delta, short -= delta),
/// so the same negation formula works for both sides:
///   Long-heavy (rate>0): long index goes up -> long pays, short index goes down -> short receives
///   Short-heavy (rate<0): long index goes down -> long receives, short index goes up -> short pays
pub fn calculate_funding_pnl(
    position: &Position,
    perps_market: &PerpsMarket,
    current_timestamp: Option<i64>,
) -> Result<i64> {
    let current_index = if let Some(timestamp) = current_timestamp {
        let (long_index, short_index) = calculate_current_funding_indices(perps_market, timestamp)?;
        match position.direction {
            PositionDirection::Long => long_index,
            PositionDirection::Short => short_index,
        }
    } else {
        match position.direction {
            PositionDirection::Long => perps_market.cumulative_funding_long,
            PositionDirection::Short => perps_market.cumulative_funding_short,
        }
    };

    let index_diff = current_index
        .checked_sub(position.entry_funding_index)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let entry_notional = (position.position_size as i128)
        .checked_mul(position.entry_price as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // funding_pnl = -(index_diff * notional / BASE)
    let payment = index_diff
        .checked_mul(entry_notional)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(FUNDING_RATE_BASE as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(-(payment as i64))
}

/// Computes notional value: size * price / 10^6.
pub fn calculate_notional(size: u64, price: u64) -> Result<u64> {
    Ok((size as u128)
        .checked_mul(price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000u128)
        .ok_or(ErrorCode::ArithmeticOverflow)? as u64)
}

/// Adds notional to the market's long or short OI.
pub fn add_open_interest(
    market: &mut PerpsMarket,
    direction: PositionDirection,
    notional: u64,
) -> Result<()> {
    match direction {
        PositionDirection::Long => {
            market.total_long_oi = market
                .total_long_oi
                .checked_add(notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            market.total_short_oi = market
                .total_short_oi
                .checked_add(notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }
    Ok(())
}

/// Subtracts notional from the market's long or short OI.
pub fn remove_open_interest(
    market: &mut PerpsMarket,
    direction: PositionDirection,
    notional: u64,
) -> Result<()> {
    match direction {
        PositionDirection::Long => {
            market.total_long_oi = market
                .total_long_oi
                .checked_sub(notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
        PositionDirection::Short => {
            market.total_short_oi = market
                .total_short_oi
                .checked_sub(notional)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
        }
    }
    Ok(())
}

/// Settles PnL between user collateral and vault via token transfers.
/// Losses transfer from user collateral to vault, profits from vault to user collateral.
pub fn settle_pnl<'info>(
    total_pnl: i64,
    max_loss: u64,
    user_collateral: &Account<'info, TokenAccount>,
    vault: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    collateral_signer_seeds: &[&[&[u8]]],
    vault_signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if total_pnl < 0 {
        // Cap loss at position collateral and available balance
        let abs_loss = total_pnl.unsigned_abs();
        let loss_amount = abs_loss.min(max_loss).min(user_collateral.amount);

        if loss_amount > 0 {
            let cpi_accounts = Transfer {
                from: user_collateral.to_account_info(),
                to: vault.to_account_info(),
                authority: user_collateral.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                token_program.key(),
                cpi_accounts,
                collateral_signer_seeds,
            );
            token::transfer(cpi_ctx, loss_amount)?;
        }
    } else if total_pnl > 0 {
        let profit_amount = total_pnl as u64;
        require!(
            vault.amount >= profit_amount,
            ErrorCode::InsufficientVaultFunds
        );

        let cpi_accounts = Transfer {
            from: vault.to_account_info(),
            to: user_collateral.to_account_info(),
            authority: vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            token_program.key(),
            cpi_accounts,
            vault_signer_seeds,
        );
        token::transfer(cpi_ctx, profit_amount)?;
    }

    Ok(())
}
