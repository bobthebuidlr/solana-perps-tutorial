use crate::calculate_notional;

#[test]
fn basic_notional_calculation() {
    // 5 SOL at $100 = $500 = 500_000_000 base units
    let notional = calculate_notional(5_000_000, 100_000_000).unwrap();
    assert_eq!(notional, 500_000_000);
}

#[test]
fn notional_zero_size() {
    let notional = calculate_notional(0, 100_000_000).unwrap();
    assert_eq!(notional, 0);
}

#[test]
fn notional_zero_price() {
    let notional = calculate_notional(5_000_000, 0).unwrap();
    assert_eq!(notional, 0);
}

#[test]
fn notional_scales_with_size() {
    let n1 = calculate_notional(5_000_000, 100_000_000).unwrap();
    let n2 = calculate_notional(10_000_000, 100_000_000).unwrap();
    assert_eq!(n2, n1 * 2);
}

#[test]
fn notional_scales_with_price() {
    let n1 = calculate_notional(5_000_000, 100_000_000).unwrap();
    let n2 = calculate_notional(5_000_000, 200_000_000).unwrap();
    assert_eq!(n2, n1 * 2);
}

#[test]
fn notional_fractional_token() {
    // 0.5 SOL at $100 = $50
    let notional = calculate_notional(500_000, 100_000_000).unwrap();
    assert_eq!(notional, 50_000_000);
}
