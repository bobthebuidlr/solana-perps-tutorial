use anchor_lang::prelude::Pubkey;

use crate::{
    calculate_account_health, Markets, Oracle, OraclePrice, PerpsMarket, Position,
    PositionDirection,
};

fn sol_mint() -> Pubkey {
    Pubkey::new_unique()
}

fn make_market(token_mint: Pubkey, max_leverage: u64, maintenance_margin_ratio: u64) -> PerpsMarket {
    PerpsMarket {
        token_mint,
        name: "SOL-PERP".to_string(),
        total_long_oi: 0,
        total_short_oi: 0,
        cumulative_funding_long: 0,
        cumulative_funding_short: 0,
        last_funding_update: 0,
        max_leverage,
        maintenance_margin_ratio,
    }
}

fn make_oracle(token_mint: Pubkey, price: u64) -> Oracle {
    Oracle {
        prices: vec![OraclePrice {
            token_mint,
            price,
            last_updated: 0,
        }],
    }
}

fn make_position(
    token_mint: Pubkey,
    direction: PositionDirection,
    size: u64,
    entry_price: u64,
) -> Position {
    Position {
        perps_market: token_mint,
        direction,
        entry_price,
        position_size: size,
        entry_funding_index: 0,
    }
}

// ── No positions ──

#[test]
fn no_positions_returns_collateral_as_equity() {
    let markets = Markets { perps: vec![] };
    let oracle = Oracle { prices: vec![] };
    let (equity, maintenance, initial) = calculate_account_health(&[], &markets, &oracle, 1_000_000).unwrap();
    assert_eq!(equity, 1_000_000);
    assert_eq!(maintenance, 0);
    assert_eq!(initial, 0);
}

// ── Single long position at entry ──

#[test]
fn single_long_at_entry_price() {
    let mint = sol_mint();
    // 10x leverage, 5% maintenance margin
    let market = make_market(mint, 10_000_000, 50_000);
    let oracle = make_oracle(mint, 100_000_000); // $100
    let markets = Markets { perps: vec![market] };

    // 5 SOL at $100 = $500 notional
    let pos = make_position(mint, PositionDirection::Long, 5_000_000, 100_000_000);

    let (equity, maintenance, initial) =
        calculate_account_health(&[pos], &markets, &oracle, 100_000_000).unwrap();

    // Equity = collateral ($100) + unrealized PnL ($0)
    assert_eq!(equity, 100_000_000);
    // Maintenance = $500 * 5% = $25
    assert_eq!(maintenance, 25_000_000);
    // Initial = $500 / 10 = $50
    assert_eq!(initial, 50_000_000);
}

// ── With profit ──

#[test]
fn long_with_profit_increases_equity() {
    let mint = sol_mint();
    let market = make_market(mint, 10_000_000, 50_000);
    let oracle = make_oracle(mint, 120_000_000); // $120 (up from $100)
    let markets = Markets { perps: vec![market] };

    let pos = make_position(mint, PositionDirection::Long, 5_000_000, 100_000_000);

    let (equity, _maintenance, _initial) =
        calculate_account_health(&[pos], &markets, &oracle, 100_000_000).unwrap();

    // PnL = 5 * (120 - 100) = $100 profit
    assert_eq!(equity, 200_000_000);
}

// ── With loss ──

#[test]
fn long_with_loss_decreases_equity() {
    let mint = sol_mint();
    let market = make_market(mint, 10_000_000, 50_000);
    let oracle = make_oracle(mint, 80_000_000); // $80 (down from $100)
    let markets = Markets { perps: vec![market] };

    let pos = make_position(mint, PositionDirection::Long, 5_000_000, 100_000_000);

    let (equity, _maintenance, _initial) =
        calculate_account_health(&[pos], &markets, &oracle, 100_000_000).unwrap();

    // PnL = 5 * (80 - 100) = -$100 loss
    assert_eq!(equity, 0);
}

// ── Multiple positions aggregate ──

#[test]
fn multiple_positions_aggregate_correctly() {
    let mint_a = Pubkey::new_unique();
    let mint_b = Pubkey::new_unique();

    let market_a = make_market(mint_a, 10_000_000, 50_000);
    let market_b = make_market(mint_b, 10_000_000, 50_000);
    let markets = Markets {
        perps: vec![market_a, market_b],
    };

    let oracle = Oracle {
        prices: vec![
            OraclePrice { token_mint: mint_a, price: 110_000_000, last_updated: 0 },
            OraclePrice { token_mint: mint_b, price: 90_000_000, last_updated: 0 },
        ],
    };

    // Long SOL-A: 5 tokens at $100, now $110 → +$50 profit
    let pos_a = make_position(mint_a, PositionDirection::Long, 5_000_000, 100_000_000);
    // Short SOL-B: 5 tokens at $100, now $90 → +$50 profit
    let pos_b = make_position(mint_b, PositionDirection::Short, 5_000_000, 100_000_000);

    let (equity, maintenance, initial) =
        calculate_account_health(&[pos_a, pos_b], &markets, &oracle, 200_000_000).unwrap();

    // Collateral $200 + $50 + $50 = $300
    assert_eq!(equity, 300_000_000);

    // Notional A = 5 * 110 = $550, Notional B = 5 * 90 = $450
    // Maintenance = ($550 + $450) * 5% = $50
    assert_eq!(maintenance, 50_000_000);

    // Initial = ($550 + $450) / 10 = $100
    assert_eq!(initial, 100_000_000);
}
