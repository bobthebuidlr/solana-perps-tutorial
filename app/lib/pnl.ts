import { type PerpsMarket } from "../generated/perps/types/perpsMarket";
import { type Position } from "../generated/perps/types/position";
import { PositionDirection } from "../generated/perps/types/positionDirection";

const PRECISION = 1_000_000n; // 6-decimal fixed point (same as LEVERAGE/MARGIN/FUNDING_RATE_BASE on-chain)

/**
 * Computes price-based PnL for a position at a given current price.
 * Mirrors `calculate_price_pnl` in anchor/programs/perps/src/utils.rs.
 *
 * @param position Position to compute PnL for
 * @param currentPrice Current oracle price in 6-decimal base units
 * @returns Signed PnL in USDC base units (positive = profit)
 */
export function calculatePricePnl(position: Position, currentPrice: bigint): bigint {
  const size = position.positionSize;
  const valueBefore = (size * position.entryPrice) / PRECISION;
  const valueAfter = (size * currentPrice) / PRECISION;
  return position.direction === PositionDirection.Long
    ? valueAfter - valueBefore
    : valueBefore - valueAfter;
}

/**
 * Computes funding PnL for a position using the market's cumulative indices.
 * Mirrors `calculate_funding_pnl` in anchor/programs/perps/src/utils.rs.
 *
 * The on-chain indices are mirrored (long += delta, short -= delta), so the
 * same `-payment` return applies to both directions.
 *
 * @param position Position to compute funding PnL for
 * @param market Market containing the cumulative funding indices
 * @returns Signed funding PnL in USDC base units (positive = user receives)
 */
export function calculateFundingPnl(position: Position, market: PerpsMarket): bigint {
  const currentIndex =
    position.direction === PositionDirection.Long
      ? market.cumulativeFundingLong
      : market.cumulativeFundingShort;

  const indexDiff = currentIndex - position.entryFundingIndex;
  const entryNotional = (position.positionSize * position.entryPrice) / PRECISION;
  const payment = (indexDiff * entryNotional) / PRECISION;
  return -payment;
}

/**
 * Computes combined price + funding PnL for a position.
 *
 * @param position Position to compute PnL for
 * @param market Market account with cumulative funding indices
 * @param currentPrice Current oracle price in 6-decimal base units
 * @returns Total PnL in USDC base units
 */
export function calculateTotalPnl(
  position: Position,
  market: PerpsMarket,
  currentPrice: bigint,
): bigint {
  return calculatePricePnl(position, currentPrice) + calculateFundingPnl(position, market);
}
