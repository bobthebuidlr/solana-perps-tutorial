import { type Address } from "@solana/kit";

/** Number of decimal places for USDC amounts (1 USDC = 10^6 base units). */
export const USDC_DECIMALS = 6;

/** Number of decimal places for token quantities (1 token = 10^6 base units). */
export const TOKEN_DECIMALS = 6;

/** USDC mint address for localnet. */
export const USDC_MINT_ADDRESS =
  "3xcGW4uvAGbfiPUieTJLg4fMbL3SposFqRJp5WgTzooL" as Address;

/** SPL Token program address. */
export const TOKEN_PROGRAM_ADDRESS =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

/** Solana system program address. */
export const SYSTEM_PROGRAM_ADDRESS =
  "11111111111111111111111111111111" as Address;
