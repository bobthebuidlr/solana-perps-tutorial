use anchor_lang::prelude::Pubkey;

use crate::{
    calculate_funding_pnl, calculate_funding_rate,
    constants::MAX_FUNDING_RATE,
    PerpsMarket, Position, PositionDirection,
};

/// Creates a test PerpsMarket with the given OI and funding indices.
/// @param total_long_oi - Total long open interest.
/// @param total_short_oi - Total short open interest.
/// @param cumulative_funding_long - Cumulative funding index for longs.
/// @param cumulative_funding_short - Cumulative funding index for shorts.
/// @returns A PerpsMarket with default values for non-funding fields.
fn make_market(
    total_long_oi: u64,
    total_short_oi: u64,
    cumulative_funding_long: i128,
    cumulative_funding_short: i128,
) -> PerpsMarket {
    PerpsMarket {
        token_mint: Pubkey::default(),
        name: "TEST-PERP".to_string(),
        total_long_oi,
        total_short_oi,
        cumulative_funding_long,
        cumulative_funding_short,
        last_funding_update: 0,
        max_leverage: 10_000_000,
        maintenance_margin_ratio: 50_000,
    }
}

/// Creates a test Position.
/// @param direction - Long or Short.
/// @param position_size - Token quantity (6-decimal).
/// @param entry_price - Entry price (6-decimal fixed point).
/// @param collateral - USDC collateral locked.
/// @param entry_funding_index - Funding index at position open.
/// @returns A Position with default values for non-relevant fields.
fn make_position(
    direction: PositionDirection,
    position_size: u64,
    entry_price: u64,
    collateral: u64,
    entry_funding_index: i128,
) -> Position {
    Position {
        user_account: Pubkey::default(),
        perps_market: Pubkey::default(),
        direction,
        entry_price,
        position_size,
        collateral,
        entry_funding_index,
        opened_at: 0,
        bump: 0,
    }
}

// ── calculate_funding_rate ──

#[test]
fn funding_rate_zero_when_no_oi() {
    let rate = calculate_funding_rate(0, 0).unwrap();
    assert_eq!(rate, 0);
}

#[test]
fn funding_rate_zero_when_balanced() {
    let rate = calculate_funding_rate(500_000, 500_000).unwrap();
    assert_eq!(rate, 0);
}

#[test]
fn funding_rate_positive_when_long_heavy() {
    // 80/20 → imbalance = 600/1000 → rate = 600 * 1000 / 1000 = 600
    let rate = calculate_funding_rate(800, 200).unwrap();
    assert_eq!(rate, 600);
    assert!(rate > 0, "Positive rate means longs pay shorts");
}

#[test]
fn funding_rate_negative_when_short_heavy() {
    // 20/80 → imbalance = -600/1000 → rate = -600
    let rate = calculate_funding_rate(200, 800).unwrap();
    assert_eq!(rate, -600);
    assert!(rate < 0, "Negative rate means shorts pay longs");
}

#[test]
fn funding_rate_max_when_all_longs() {
    let rate = calculate_funding_rate(1000, 0).unwrap();
    assert_eq!(rate, MAX_FUNDING_RATE as i64);
}

#[test]
fn funding_rate_negative_max_when_all_shorts() {
    let rate = calculate_funding_rate(0, 1000).unwrap();
    assert_eq!(rate, -(MAX_FUNDING_RATE as i64));
}

#[test]
fn funding_rate_scales_linearly() {
    let rate_60_40 = calculate_funding_rate(600, 400).unwrap();
    let rate_70_30 = calculate_funding_rate(700, 300).unwrap();
    assert_eq!(rate_60_40, 200);
    assert_eq!(rate_70_30, 400);
    assert_eq!(rate_70_30, rate_60_40 * 2);
}

// ── calculate_funding_pnl — long-heavy market (longs pay, shorts receive) ──

#[test]
fn long_pays_in_long_heavy_market() {
    // After 1 interval with rate=500: long index += 500, short index -= 500
    let market = make_market(1000, 200, 500, -500);
    // 5 SOL at $100 = $500 notional (500_000_000 USDC base units)
    // payment = 500 * 500_000_000 / 1_000_000 = 250_000
    // pnl = -250_000
    let position = make_position(
        PositionDirection::Long,
        5_000_000,   // 5 SOL
        100_000_000, // $100
        100_000_000, // $100 collateral (5x leverage)
        0,
    );
    let pnl = calculate_funding_pnl(&position, &market, None).unwrap();
    assert_eq!(pnl, -250_000);
}

#[test]
fn short_receives_in_long_heavy_market() {
    // Same market: short index went from 0 to -500
    // index_diff = -500, payment = -500 * 500_000_000 / 1_000_000 = -250_000
    // pnl = -(-250_000) = 250_000 (receives)
    let market = make_market(1000, 200, 500, -500);
    let position = make_position(
        PositionDirection::Short,
        5_000_000,
        100_000_000,
        100_000_000,
        0,
    );
    let pnl = calculate_funding_pnl(&position, &market, None).unwrap();
    assert_eq!(pnl, 250_000);
    assert!(pnl > 0, "Short should receive when market is long-heavy");
}

// ── calculate_funding_pnl — short-heavy market (shorts pay, longs receive) ──

#[test]
fn long_receives_in_short_heavy_market() {
    // Negative rate → funding_delta negative → long index decreases, short index increases
    // After 1 interval with rate=-500: long index = -500, short index = 500
    let market = make_market(200, 1000, -500, 500);
    let position = make_position(
        PositionDirection::Long,
        5_000_000,
        100_000_000,
        100_000_000,
        0,
    );
    let pnl = calculate_funding_pnl(&position, &market, None).unwrap();
    assert_eq!(pnl, 250_000);
    assert!(pnl > 0, "Long should receive when market is short-heavy");
}

#[test]
fn short_pays_in_short_heavy_market() {
    // Short index went from 0 to 500 (increased because rate is negative)
    // index_diff = 500, payment = 500 * 500_000_000 / 1_000_000 = 250_000
    // pnl = -250_000 (pays)
    let market = make_market(200, 1000, -500, 500);
    let position = make_position(
        PositionDirection::Short,
        5_000_000,
        100_000_000,
        100_000_000,
        0,
    );
    let pnl = calculate_funding_pnl(&position, &market, None).unwrap();
    assert_eq!(pnl, -250_000);
    assert!(pnl < 0, "Short should pay when market is short-heavy");
}

// ── Funding scales with notional (leverage), not collateral ──

#[test]
fn funding_scales_with_leverage() {
    let market = make_market(1000, 0, 500, -500);

    // 1x leverage: 5 SOL at $100, collateral = $500
    let pos_1x = make_position(
        PositionDirection::Long,
        5_000_000,
        100_000_000,
        500_000_000, // $500 collateral
        0,
    );

    // 10x leverage: 50 SOL at $100, collateral = $500 (same collateral, 10x notional)
    let pos_10x = make_position(
        PositionDirection::Long,
        50_000_000,  // 50 SOL
        100_000_000, // $100
        500_000_000, // $500 collateral (same as 1x)
        0,
    );

    let pnl_1x = calculate_funding_pnl(&pos_1x, &market, None).unwrap();
    let pnl_10x = calculate_funding_pnl(&pos_10x, &market, None).unwrap();

    assert_eq!(pnl_10x, pnl_1x * 10, "10x leveraged position should pay 10x more funding");
}

// ── Zero funding when balanced ──

#[test]
fn zero_funding_when_indices_unchanged() {
    let market = make_market(500, 500, 0, 0);
    let position = make_position(
        PositionDirection::Long,
        5_000_000,
        100_000_000,
        500_000_000,
        0,
    );
    let pnl = calculate_funding_pnl(&position, &market, None).unwrap();
    assert_eq!(pnl, 0);
}
