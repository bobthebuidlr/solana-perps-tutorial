use anchor_lang::prelude::Pubkey;

use crate::{calculate_price_pnl, Position, PositionDirection};

fn make_position(
    direction: PositionDirection,
    position_size: u64,
    entry_price: u64,
) -> Position {
    Position {
        perps_market: Pubkey::default(),
        direction,
        entry_price,
        position_size,
        entry_funding_index: 0,
    }
}

// ── Long positions ──

#[test]
fn long_profit_when_price_rises() {
    // 5 SOL at $100, price goes to $120
    // pnl = 5_000_000 * (120_000_000 - 100_000_000) / 1_000_000 = 100_000_000
    let pos = make_position(PositionDirection::Long, 5_000_000, 100_000_000);
    let pnl = calculate_price_pnl(&pos, 120_000_000).unwrap();
    assert_eq!(pnl, 100_000_000);
}

#[test]
fn long_loss_when_price_drops() {
    // 5 SOL at $100, price goes to $80
    let pos = make_position(PositionDirection::Long, 5_000_000, 100_000_000);
    let pnl = calculate_price_pnl(&pos, 80_000_000).unwrap();
    assert_eq!(pnl, -100_000_000);
}

#[test]
fn long_zero_pnl_at_entry() {
    let pos = make_position(PositionDirection::Long, 5_000_000, 100_000_000);
    let pnl = calculate_price_pnl(&pos, 100_000_000).unwrap();
    assert_eq!(pnl, 0);
}

// ── Short positions ──

#[test]
fn short_profit_when_price_drops() {
    // 5 SOL short at $100, price goes to $80
    let pos = make_position(PositionDirection::Short, 5_000_000, 100_000_000);
    let pnl = calculate_price_pnl(&pos, 80_000_000).unwrap();
    assert_eq!(pnl, 100_000_000);
}

#[test]
fn short_loss_when_price_rises() {
    // 5 SOL short at $100, price goes to $120
    let pos = make_position(PositionDirection::Short, 5_000_000, 100_000_000);
    let pnl = calculate_price_pnl(&pos, 120_000_000).unwrap();
    assert_eq!(pnl, -100_000_000);
}

#[test]
fn short_zero_pnl_at_entry() {
    let pos = make_position(PositionDirection::Short, 5_000_000, 100_000_000);
    let pnl = calculate_price_pnl(&pos, 100_000_000).unwrap();
    assert_eq!(pnl, 0);
}

// ── Scaling ──

#[test]
fn pnl_scales_linearly_with_size() {
    let pos_1x = make_position(PositionDirection::Long, 5_000_000, 100_000_000);
    let pos_3x = make_position(PositionDirection::Long, 15_000_000, 100_000_000);
    let pnl_1x = calculate_price_pnl(&pos_1x, 110_000_000).unwrap();
    let pnl_3x = calculate_price_pnl(&pos_3x, 110_000_000).unwrap();
    assert_eq!(pnl_3x, pnl_1x * 3);
}

#[test]
fn pnl_scales_linearly_with_price_move() {
    let pos = make_position(PositionDirection::Long, 5_000_000, 100_000_000);
    let pnl_10 = calculate_price_pnl(&pos, 110_000_000).unwrap();
    let pnl_20 = calculate_price_pnl(&pos, 120_000_000).unwrap();
    assert_eq!(pnl_20, pnl_10 * 2);
}
