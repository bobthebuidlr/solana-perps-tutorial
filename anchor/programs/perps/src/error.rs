use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Insufficient collateral to perform this operation")]
    InsufficientCollateral,

    #[msg("Unauthorized: you do not have permission for this action")]
    UnauthorizedAccess,

    #[msg("Oracle price not found")]
    OraclePriceNotFound,

    #[msg("Market not found")]
    MarketNotFound,

    #[msg("Vault has insufficient funds to pay settlement")]
    InsufficientVaultFunds,

    #[msg("Operation would put account below maintenance margin")]
    BelowMaintenanceMargin,

    #[msg("No open position found for this market")]
    PositionNotFound,

    #[msg("User already has an open position on this market")]
    MarketAlreadyHasPosition,

    #[msg("User has reached the maximum number of open positions")]
    MaxPositionsReached,

    #[msg("Trade exceeds the market's initial margin limit (max leverage)")]
    InitialMarginExceeded,

    #[msg("Account is still above maintenance margin and cannot be liquidated")]
    AccountNotLiquidatable,

    #[msg("Target account has no open positions to liquidate")]
    NoPositionsToLiquidate,
}
