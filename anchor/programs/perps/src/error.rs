use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Available collateral is less than locked collateral")]
    InvalidCollateralState,

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

    #[msg("Leverage exceeds maximum allowed for this market")]
    ExceedsMaxLeverage,

    #[msg("Withdrawal would put account below maintenance margin")]
    BelowMaintenanceMargin,
}
