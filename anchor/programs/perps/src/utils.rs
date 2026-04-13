use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    constants::*, error::ErrorCode, Markets, Oracle, PerpsMarket, Position, PositionDirection,
    UserAccount,
};

/// Looks up the oracle price for a given token mint.
///
/// @param oracle Oracle account
/// @param token_mint Token mint pubkey
/// @return Result<u64> price
pub fn get_oracle_price(oracle: &Oracle, token_mint: Pubkey) -> Result<u64> {
    oracle
        .prices
        .iter()
        .find(|p| p.token_mint == token_mint)
        .map(|p| p.price)
        .ok_or(error!(ErrorCode::OraclePriceNotFound))
}

/// Calculates price PnL for a position at a given current price.
///
/// @param position The position to calculate PnL for
/// @param current_price Current oracle price
/// @return Result<i64> PnL in USDC base units
pub fn calculate_price_pnl(position: &Position, current_price: u64) -> Result<i64> {
    let size = position.position_size as i128;
    let entry = position.entry_price as i128;
    let current = current_price as i128;

    let value_before = size
        .checked_mul(entry)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(PRICE_PRECISION as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let value_after = size
        .checked_mul(current)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(PRICE_PRECISION as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let pnl = match position.direction {
        PositionDirection::Long => value_after
            .checked_sub(value_before)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
        PositionDirection::Short => value_before
            .checked_sub(value_after)
            .ok_or(ErrorCode::ArithmeticOverflow)?,
    };

    i64::try_from(pnl).map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

/// Returns the notional value of a position at a given price.
///
/// @param position The position
/// @param price Price to use
/// @return Result<u64> notional value
pub fn position_notional_at_price(position: &Position, price: u64) -> Result<u64> {
    calculate_notional(position.position_size, price)
}

/// Validates that the user account is above both maintenance and initial margin.
///
/// @param user_account User account to check
/// @param markets Markets account
/// @param oracle Oracle account
/// @param token_balance User's collateral token balance
/// @return Result<()>
pub fn check_user_account_health(
    user_account: &UserAccount,
    markets: &Markets,
    oracle: &Oracle,
    token_balance: u64,
) -> Result<()> {
    let (equity, maintenance, initial) =
        calculate_account_health(&user_account.positions, markets, oracle, token_balance)?;
    require!(
        equity >= maintenance as i64,
        ErrorCode::BelowMaintenanceMargin
    );
    require!(equity >= initial as i64, ErrorCode::InitialMarginExceeded);
    Ok(())
}

/// Computes equity, maintenance margin, and initial margin for a set of positions.
///
/// @param positions Slice of positions
/// @param markets Markets account
/// @param oracle Oracle account
/// @param token_balance User's collateral token balance
/// @return Result<(i64, u64, u64)> (equity, maintenance_margin, initial_margin)
pub fn calculate_account_health(
    positions: &[Position],
    markets: &Markets,
    oracle: &Oracle,
    token_balance: u64,
) -> Result<(i64, u64, u64)> {
    let mut total_unrealized_pnl: i64 = 0;
    let mut total_maintenance_margin: u128 = 0;
    let mut total_initial_margin: u128 = 0;

    for position in positions {
        let perps_market = markets
            .perps
            .iter()
            .find(|m| m.token_mint == position.perps_market)
            .ok_or(error!(ErrorCode::MarketNotFound))?;

        let current_price = get_oracle_price(oracle, position.perps_market)?;

        let price_pnl = calculate_price_pnl(position, current_price)?;
        let funding_pnl = calculate_funding_pnl(position, perps_market)?;
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

        // Initial margin = notional / max_leverage. max_leverage is 6-decimal
        // (10_000_000 = 10x), so multiplying by MARGIN_PRECISION yields a 10%
        // requirement for a 10x cap.
        let initial = notional
            .checked_mul(MARGIN_PRECISION as u128)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            .checked_div(perps_market.max_leverage as u128)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        total_initial_margin = total_initial_margin
            .checked_add(initial)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }

    let total_equity_i128 = (token_balance as i128)
        .checked_add(total_unrealized_pnl as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let total_equity: i64 = total_equity_i128
        .try_into()
        .map_err(|_| ErrorCode::ArithmeticOverflow)?;

    let total_maintenance_margin_u64: u64 = total_maintenance_margin
        .try_into()
        .map_err(|_| ErrorCode::ArithmeticOverflow)?;
    let total_initial_margin_u64: u64 = total_initial_margin
        .try_into()
        .map_err(|_| ErrorCode::ArithmeticOverflow)?;

    Ok((
        total_equity,
        total_maintenance_margin_u64,
        total_initial_margin_u64,
    ))
}

/// Calculates the funding rate based on OI imbalance.
/// Positive = longs pay shorts, negative = shorts pay longs.
///
/// @param total_long_oi Total long open interest
/// @param total_short_oi Total short open interest
/// @return Result<i64> funding rate
pub fn calculate_funding_rate(total_long_oi: u64, total_short_oi: u64) -> Result<i64> {
    let total_oi = total_long_oi
        .checked_add(total_short_oi)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    if total_oi == 0 {
        return Ok(0);
    }

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
///
/// @param perps_markets Mutable vec of perps markets
/// @param current_timestamp Current unix timestamp
/// @return Result<()>
pub fn update_funding_indices(
    perps_markets: &mut Vec<PerpsMarket>,
    current_timestamp: i64,
) -> Result<()> {
    for perps_market in perps_markets {
        let time_elapsed = current_timestamp
            .checked_sub(perps_market.last_funding_update)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        if time_elapsed <= 0 {
            continue;
        }

        let intervals = time_elapsed
            .checked_div(FUNDING_INTERVAL)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        if intervals == 0 {
            continue;
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

/// Calculates funding PnL using the cumulative index approach.
///
/// Reads directly from the market's persisted cumulative indices — callers that
/// need up-to-date funding must call `update_funding_indices` first (as all
/// state-changing instructions already do).
///
/// The two cumulative indices move in opposite directions (long += delta, short -= delta),
/// so the same negation formula works for both sides:
///   Long-heavy (rate>0): long index goes up -> long pays, short index goes down -> short receives
///   Short-heavy (rate<0): long index goes down -> long receives, short index goes up -> short pays
///
/// @param position Position to calculate funding PnL for
/// @param perps_market The perps market the position belongs to
/// @return Result<i64> funding PnL in USDC base units
pub fn calculate_funding_pnl(position: &Position, perps_market: &PerpsMarket) -> Result<i64> {
    let current_index = match position.direction {
        PositionDirection::Long => perps_market.cumulative_funding_long,
        PositionDirection::Short => perps_market.cumulative_funding_short,
    };

    let index_diff = current_index
        .checked_sub(position.entry_funding_index)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let entry_notional = (position.position_size as i128)
        .checked_mul(position.entry_price as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(PRICE_PRECISION as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let payment = index_diff
        .checked_mul(entry_notional)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(FUNDING_RATE_BASE as i128)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let negated = payment
        .checked_neg()
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    i64::try_from(negated).map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

/// Computes notional value: size * price / PRICE_PRECISION.
///
/// @param size Position size in base units
/// @param price Price in 6-decimal fixed-point
/// @return Result<u64> notional value
pub fn calculate_notional(size: u64, price: u64) -> Result<u64> {
    let result = (size as u128)
        .checked_mul(price as u128)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        .checked_div(PRICE_PRECISION)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    u64::try_from(result).map_err(|_| error!(ErrorCode::ArithmeticOverflow))
}

/// Adds notional to the market's long or short OI.
///
/// @param market Mutable perps market
/// @param direction Position direction
/// @param notional Notional value to add
/// @return Result<()>
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
///
/// @param market Mutable perps market
/// @param direction Position direction
/// @param notional Notional value to remove
/// @return Result<()>
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
///
/// @param total_pnl Net PnL to settle (negative = user loss, positive = user profit)
/// @param user_collateral User's collateral token account
/// @param vault Protocol vault token account
/// @param token_program SPL Token program
/// @param collateral_signer_seeds PDA signer seeds for user collateral
/// @param vault_signer_seeds PDA signer seeds for vault
/// @return Result<()>
pub fn settle_pnl<'info>(
    total_pnl: i64,
    user_collateral: &Account<'info, TokenAccount>,
    vault: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    collateral_signer_seeds: &[&[&[u8]]],
    vault_signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if total_pnl < 0 {
        let abs_loss = total_pnl.unsigned_abs();
        let loss_amount = abs_loss.min(user_collateral.amount);

        if abs_loss > user_collateral.amount {
            msg!(
                "Bad debt: loss={} but collateral={}; shortfall={}",
                abs_loss,
                user_collateral.amount,
                abs_loss - user_collateral.amount
            );
        }

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
