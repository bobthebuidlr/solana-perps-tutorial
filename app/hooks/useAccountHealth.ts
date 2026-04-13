import { useMemo } from "react";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { useCollateral } from "./useCollateral";
import { useMarkets } from "./useMarkets";
import { useOraclePrices } from "./useOraclePrices";
import { usePositions } from "./usePositions";
import { TOKEN_DECIMALS } from "../lib/constants";

/**
 * Computes cross-margin account health metrics from on-chain position data.
 * Aggregates unrealised PnL, maintenance margin, portfolio value, and derives
 * health factor / available collateral used by the withdraw and order-form max buttons.
 *
 * @returns totalUnrealizedPnl - Signed aggregate PnL across all open positions (bigint, 6-dec USDC).
 * @returns totalMaintenanceMargin - Sum of per-position maintenance margin requirements (bigint, 6-dec USDC).
 * @returns totalNotional - Sum of position notional values at current prices (bigint, 6-dec USDC).
 * @returns portfolioValue - Collateral balance + unrealised PnL (bigint, 6-dec USDC).
 * @returns availableCollateral - Max collateral usable for new positions / withdrawals (bigint, 6-dec USDC).
 * @returns healthFactor - portfolioValue / maintenanceMargin ratio, null when no positions.
 * @returns accountLeverage - totalNotional / portfolioValue ratio (number).
 * @returns collateralBalance - Raw collateral token balance (bigint, 6-dec USDC).
 * @returns isLoading - True while underlying data is still being fetched.
 */
export function useAccountHealth() {
  const { balance, isLoading: collateralLoading } = useCollateral();
  const { positions, isLoading: positionsLoading } = usePositions();
  const { markets } = useMarkets();
  const { prices: oraclePrices } = useOraclePrices();

  const collateralBalance = balance ?? 0n;
  const isLoading = collateralLoading || positionsLoading;

  const {
    totalUnrealizedPnl,
    totalNotional,
    totalMaintenanceMargin,
  } = useMemo(() => {
    let pnl = 0n;
    let notional = 0n;
    let maintenance = 0n;

    for (const position of positions) {
      const price = oraclePrices?.find(
        (p) => p.tokenMint.toString() === position.perpsMarket.toString()
      )?.price;
      const market = markets?.find(
        (m) => m.tokenMint.toString() === position.perpsMarket.toString()
      );
      if (!price) continue;

      // Notional at current price
      const posNotional =
        (position.positionSize * price) / BigInt(10 ** TOKEN_DECIMALS);
      notional += posNotional;

      // Maintenance margin: notional * maintenance_margin_ratio / 1_000_000
      if (market) {
        maintenance +=
          (posNotional * market.maintenanceMarginRatio) / BigInt(1_000_000);
      }

      // Price PnL
      const isLong = position.direction === PositionDirection.Long;
      const pricePnl = isLong
        ? (position.positionSize * price -
            position.positionSize * position.entryPrice) /
          BigInt(10 ** TOKEN_DECIMALS)
        : (position.positionSize * position.entryPrice -
            position.positionSize * price) /
          BigInt(10 ** TOKEN_DECIMALS);

      // Funding PnL
      let fundingPnl = 0n;
      if (market) {
        const currentIndex = isLong
          ? market.cumulativeFundingLong
          : market.cumulativeFundingShort;
        const indexDiff = currentIndex - position.entryFundingIndex;
        const entryNotional =
          (position.positionSize * position.entryPrice) / BigInt(10 ** TOKEN_DECIMALS);
        const payment =
          (indexDiff * entryNotional) / BigInt(1_000_000);
        fundingPnl = -payment;
      }

      pnl += pricePnl + fundingPnl;
    }

    return {
      totalUnrealizedPnl: pnl,
      totalNotional: notional,
      totalMaintenanceMargin: maintenance,
    };
  }, [positions, oraclePrices, markets]);

  // Portfolio value = collateral balance + unrealized PnL
  const portfolioValue = collateralBalance + totalUnrealizedPnl;

  // Available collateral = equity above maintenance margin, capped at token balance
  const availableCollateral = (() => {
    if (totalMaintenanceMargin === 0n) return collateralBalance;
    const freeEquity = portfolioValue - totalMaintenanceMargin;
    if (freeEquity <= 0n) return 0n;
    return freeEquity < collateralBalance ? freeEquity : collateralBalance;
  })();

  // Health factor = portfolio value / maintenance margin
  const healthFactor =
    totalMaintenanceMargin > 0n
      ? Number(portfolioValue) / Number(totalMaintenanceMargin)
      : null;

  // Account leverage = total notional / portfolio value
  const accountLeverage =
    portfolioValue > 0n ? Number(totalNotional) / Number(portfolioValue) : 0;

  return {
    totalUnrealizedPnl,
    totalMaintenanceMargin,
    totalNotional,
    portfolioValue,
    availableCollateral,
    healthFactor,
    accountLeverage,
    collateralBalance,
    isLoading,
  };
}
