use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Oracle price data is invalid or corrupted")]
    OraclePriceMismatch,

    #[msg("Available collateral is less than locked collateral")]
    InvalidCollateralState,

    #[msg("Insufficient collateral to perform this operation")]
    InsufficientCollateral,

    #[msg("Invalid position direction specified")]
    InvalidPositionDirection,

    #[msg("Oracle price is stale or outdated")]
    OracleStale,

    #[msg("Funding rate update not due yet")]
    FundingNotDue,

    #[msg("Position size must be greater than zero")]
    InvalidPositionSize,

    #[msg("Position not found or already closed")]
    PositionNotFound,

    #[msg("Market has already been initialized")]
    MarketAlreadyInitialized,

    #[msg("Unauthorized: you do not have permission for this action")]
    UnauthorizedAccess,

    #[msg("Cannot withdraw locked collateral")]
    CollateralLocked,

    #[msg("Oracle price is outside acceptable bounds")]
    OraclePriceOutOfBounds,

    #[msg("Oracle price change exceeds maximum allowed percentage")]
    OraclePriceChangeExcessive,

    #[msg("Oracle price not found")]
    OraclePriceNotFound,

    #[msg("Market not found")]
    MarketNotFound,

    #[msg("Vault has insufficient funds to pay settlement")]
    InsufficientVaultFunds,

    #[msg("Leverage exceeds maximum allowed for this market")]
    ExceedsMaxLeverage,

    #[msg("Withdrawal would put account below maintenance margin")]
    BelowMaintenanceMargin,
}
