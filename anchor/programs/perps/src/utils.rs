use anchor_lang::prelude::*;

use crate::{constants::*, error::ErrorCode, Markets, Oracle, PerpsMarket, Position, PositionDirection};

/// Calculate price-based PnL for a position.
/// position_size is token quantity (6-decimal), prices are 6-decimal fixed point.
/// Returns PnL in USDC base units (6-decimal).
/// @param position - The open position account.
/// @param current_price - Current oracle price (6-decimal fixed point).
/// @returns Signed PnL in USDC base units (positive = profit, negative = loss).
pub fn calculate_price_pnl(position: &Position, current_price: u64) -> Result<i64> {
    let size = position.position_size as i128;
    let entry = position.entry_price as i128;
    let current = current_price as i128;

    // value = token_qty * price / 10^6 → USDC base units
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

/// Computes the notional value of a position at a given price.
/// @param position - The position account.
/// @param price - The price to compute notional at (6-decimal fixed point).
/// @returns Notional value in USDC base units (6-decimal).
pub fn position_notional_at_price(position: &Position, price: u64) -> Result<u64> {
    Ok(((position.position_size as u128)
        .checked_mul(price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(1_000_000u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?) as u64)
}

/// Calculates cross-margin account health across all open positions.
/// @param positions - Slice of all user's open positions.
/// @param markets - The Markets account containing all perps markets.
/// @param oracle - The Oracle account containing all prices.
/// @param token_balance - Current USDC balance in the user's collateral token account.
/// @returns (total_equity, total_maintenance_margin) — healthy when equity >= maintenance_margin.
pub fn calculate_account_health(
    positions: &[Position],
    markets: &Markets,
    oracle: &Oracle,
    token_balance: u64,
) -> Result<(i64, u64)> {
    let mut total_unrealized_pnl: i64 = 0;
    let mut total_maintenance_margin: u128 = 0;

    for position in positions {
        // Find the market and oracle price for this position
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

        // Calculate unrealized PnL for this position
        let price_pnl = calculate_price_pnl(position, current_price)?;
        let funding_pnl = calculate_funding_pnl(position, perps_market, None)?;
        let position_pnl = price_pnl
            .checked_add(funding_pnl)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        total_unrealized_pnl = total_unrealized_pnl
            .checked_add(position_pnl)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // Calculate maintenance margin for this position: notional_at_current_price * maintenance_margin_ratio / MARGIN_PRECISION
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

    // total_equity = token_balance + total_unrealized_pnl
    let total_equity = (token_balance as i64)
        .checked_add(total_unrealized_pnl)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok((total_equity, total_maintenance_margin as u64))
}

/// Calculate the current funding rate based on OI imbalance
/// Returns funding rate scaled by FUNDING_RATE_BASE (1_000_000 = 100%)
/// Positive rate = longs pay shorts, Negative rate = shorts pay longs
pub fn calculate_funding_rate(total_long_oi: u64, total_short_oi: u64) -> Result<i64> {
    let total_oi = total_long_oi
        .checked_add(total_short_oi)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // If no open interest, funding rate is 0
    if total_oi == 0 {
        return Ok(0);
    }

    // Calculate OI imbalance ratio: (long - short) / total
    let oi_imbalance = (total_long_oi as i128)
        .checked_sub(total_short_oi as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Funding rate = (imbalance / total) * MAX_FUNDING_RATE
    // If 100% imbalance (all longs or all shorts), funding rate = MAX_FUNDING_RATE
    let funding_rate = oi_imbalance
        .checked_mul(MAX_FUNDING_RATE as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(total_oi as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(funding_rate as i64)
}

/// Updates cumulative funding indices for both long and short positions
/// Must be called BEFORE any OI change to ensure accurate funding accumulation
pub fn update_funding_indices(
    perps_markets: &mut Vec<PerpsMarket>,
    current_timestamp: i64,
) -> Result<()> {
    for perps_market in perps_markets {
        // Calculate time elapsed
        let time_elapsed = current_timestamp
            .checked_sub(perps_market.last_funding_update)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // If no time passed or timestamp went backwards, no update needed
        if time_elapsed <= 0 {
            return Ok(());
        }

        // Calculate number of intervals (5-minute periods)
        let intervals = time_elapsed
            .checked_div(FUNDING_INTERVAL)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // If less than one interval passed, no update needed
        if intervals == 0 {
            return Ok(());
        }

        // Calculate current funding rate based on OI imbalance
        let funding_rate =
            calculate_funding_rate(perps_market.total_long_oi, perps_market.total_short_oi)?;

        // Calculate funding delta for this period
        let funding_delta = (funding_rate as i128)
            .checked_mul(intervals as i128)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // Update cumulative indices
        perps_market.cumulative_funding_long = perps_market
            .cumulative_funding_long
            .checked_add(funding_delta)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        perps_market.cumulative_funding_short = perps_market
            .cumulative_funding_short
            .checked_sub(funding_delta)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        // Update timestamp
        perps_market.last_funding_update = current_timestamp;

        msg!(
            "Funding indices updated: long={}, short={}",
            perps_market.cumulative_funding_long,
            perps_market.cumulative_funding_short
        );
    }

    Ok(())
}

/// Calculate what the current funding indices would be without mutating the market
/// Returns (current_long_index, current_short_index)
pub fn calculate_current_funding_indices(
    perps_market: &PerpsMarket,
    current_timestamp: i64,
) -> Result<(i128, i128)> {
    // Calculate time elapsed
    let time_elapsed = current_timestamp
        .checked_sub(perps_market.last_funding_update)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // If no time passed or timestamp went backwards, return current indices
    if time_elapsed <= 0 {
        return Ok((
            perps_market.cumulative_funding_long,
            perps_market.cumulative_funding_short,
        ));
    }

    // Calculate number of intervals (5-minute periods)
    let intervals = time_elapsed
        .checked_div(FUNDING_INTERVAL)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // If less than one interval passed, return current indices
    if intervals == 0 {
        return Ok((
            perps_market.cumulative_funding_long,
            perps_market.cumulative_funding_short,
        ));
    }

    // Calculate current funding rate based on OI imbalance
    let funding_rate =
        calculate_funding_rate(perps_market.total_long_oi, perps_market.total_short_oi)?;

    // Calculate funding delta for this period
    let funding_delta = (funding_rate as i128)
        .checked_mul(intervals as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Calculate what the new indices would be
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

/// Calculate funding PnL for a position using cumulative index approach
/// Returns funding payment (positive = received, negative = paid)
/// Can optionally provide pre-calculated current indices, otherwise uses market's stored indices
pub fn calculate_funding_pnl(
    position: &Position,
    perps_market: &PerpsMarket,
    current_timestamp: Option<i64>,
) -> Result<i64> {
    // Get current cumulative index based on position direction
    let current_index = if let Some(timestamp) = current_timestamp {
        // Calculate what the current index would be
        let (long_index, short_index) = calculate_current_funding_indices(perps_market, timestamp)?;
        match position.direction {
            PositionDirection::Long => long_index,
            PositionDirection::Short => short_index,
        }
    } else {
        // Use the stored index from perps_market
        match position.direction {
            PositionDirection::Long => perps_market.cumulative_funding_long,
            PositionDirection::Short => perps_market.cumulative_funding_short,
        }
    };

    // Calculate index difference since position entry
    let index_diff = current_index
        .checked_sub(position.entry_funding_index)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Calculate funding PnL using USDC collateral as the notional value.
    // position.collateral holds the USDC amount locked for this position, giving
    // funding payments in USDC base units consistent with price PnL.
    let funding_pnl = match position.direction {
        PositionDirection::Long => {
            // Longs pay when index increases (negative PnL)
            let payment = index_diff
                .checked_mul(position.collateral as i128)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(FUNDING_RATE_BASE as i128)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            -(payment as i64)
        }
        PositionDirection::Short => {
            // Shorts receive when longs pay (positive PnL when index decreases)
            let payment = index_diff
                .checked_mul(position.collateral as i128)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                .checked_div(FUNDING_RATE_BASE as i128)
                .ok_or(ErrorCode::ArithmeticOverflow)?;
            payment as i64
        }
    };

    Ok(funding_pnl)
}
