"use client";

import { type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { useMemo, useState } from "react";
import { type Position } from "../generated/perps/accounts/position";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { useCollateral } from "../hooks/useCollateral";
import { useMarkets } from "../hooks/useMarkets";
import { useOraclePrices } from "../hooks/useOraclePrices";
import { usePositions } from "../hooks/usePositions";
import { useDeposit } from "../hooks/useDeposit";
import { useWithdraw } from "../hooks/useWithdraw";
import { useTokenAccount } from "../hooks/useTokenAccount";
import { useTokenBalance } from "../hooks/useTokenBalance";
import { formatUsdc } from "../lib/format";
import { USDC_DECIMALS, TOKEN_DECIMALS, USDC_MINT_ADDRESS } from "../lib/constants";


/**
 * Account overview component showing user's trading account status.
 * Hyperliquid-style: Portfolio Value, Unrealized PNL, Maintenance Margin, Account Leverage.
 */
export function AccountOverview() {
  const { wallet } = useWalletConnection();
  const walletAddress = wallet?.account.address;

  const { balance, isLoading: collateralLoading } = useCollateral();
  const { positions, isLoading: positionsLoading } = usePositions();
  const { markets } = useMarkets();
  const { prices: oraclePrices } = useOraclePrices();

  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const collateralBalance = balance ?? 0n;

  // Client-side PnL, notional, and maintenance margin calculation across all positions
  const { totalUnrealizedPnl, totalNotional, totalMaintenanceMargin } = useMemo(() => {
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
      const posNotional = position.positionSize * price / BigInt(10 ** TOKEN_DECIMALS);
      notional += posNotional;

      // Maintenance margin: notional * maintenance_margin_ratio / 1_000_000
      if (market) {
        maintenance += posNotional * market.maintenanceMarginRatio / BigInt(1_000_000);
      }

      // Price PnL
      const isLong = position.direction === PositionDirection.Long;
      const pricePnl = isLong
        ? (position.positionSize * price - position.positionSize * position.entryPrice) / BigInt(10 ** TOKEN_DECIMALS)
        : (position.positionSize * position.entryPrice - position.positionSize * price) / BigInt(10 ** TOKEN_DECIMALS);

      // Funding PnL
      let fundingPnl = 0n;
      if (market) {
        const currentIndex = isLong ? market.cumulativeFundingLong : market.cumulativeFundingShort;
        const indexDiff = currentIndex - position.entryFundingIndex;
        const payment = indexDiff * position.collateral / BigInt(1_000_000);
        fundingPnl = isLong ? -payment : payment;
      }

      pnl += pricePnl + fundingPnl;
    }
    return { totalUnrealizedPnl: pnl, totalNotional: notional, totalMaintenanceMargin: maintenance };
  }, [positions, oraclePrices, markets]);

  // Portfolio value = collateral balance + unrealized PnL
  const portfolioValue = collateralBalance + (totalUnrealizedPnl >= 0n ? totalUnrealizedPnl : 0n)
    - (totalUnrealizedPnl < 0n ? -totalUnrealizedPnl : 0n);

  // Account leverage = total notional / portfolio value
  const accountLeverage = portfolioValue > 0n
    ? Number(totalNotional) / Number(portfolioValue)
    : 0;

  if (!walletAddress) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]">
        <div className="p-6">
          <p className="text-sm font-semibold mb-4">Account Overview</p>
          <div className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
            Connect your wallet to view account details
          </div>
        </div>
      </div>
    );
  }

  const isLoading = collateralLoading || positionsLoading;

  return (
    <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Account Overview</p>
            <p className="mt-0.5 text-xs text-muted">
              {positions.length} open {positions.length === 1 ? "position" : "positions"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDepositOpen(true)}
              disabled={isLoading}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
            >
              Deposit
            </button>
            <button
              onClick={() => setWithdrawOpen(true)}
              disabled={isLoading || collateralBalance <= 0n}
              className="rounded-lg border border-border-low bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-foreground hover:border-border-strong hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Hyperliquid-style account stats */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Portfolio Value</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {isLoading ? (
                <span className="inline-block h-4 w-20 animate-pulse rounded bg-surface" />
              ) : (
                `${formatUsdc(portfolioValue)} USDC`
              )}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Unrealized PNL</span>
            <span
              className={`font-mono text-sm font-semibold tabular-nums ${
                totalUnrealizedPnl > 0n
                  ? "text-long"
                  : totalUnrealizedPnl < 0n
                    ? "text-short"
                    : ""
              }`}
            >
              {isLoading ? (
                <span className="inline-block h-4 w-20 animate-pulse rounded bg-surface" />
              ) : (
                `${totalUnrealizedPnl >= 0n ? "+" : "-"}${formatUsdc(totalUnrealizedPnl >= 0n ? totalUnrealizedPnl : -totalUnrealizedPnl)} USDC`
              )}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Perps Maintenance Margin</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {isLoading ? (
                <span className="inline-block h-4 w-20 animate-pulse rounded bg-surface" />
              ) : (
                `${formatUsdc(totalMaintenanceMargin)} USDC`
              )}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Account Leverage</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {isLoading ? (
                <span className="inline-block h-4 w-20 animate-pulse rounded bg-surface" />
              ) : (
                `${accountLeverage.toFixed(2)}x`
              )}
            </span>
          </div>
        </div>
      </div>
      
      {/* Deposit Dialog */}
      {depositOpen && (
        <DepositDialog
          onClose={() => setDepositOpen(false)}
          onSuccess={() => {
            setDepositOpen(false);
          }}
        />
      )}
      
      {/* Withdraw Dialog */}
      {withdrawOpen && (
        <WithdrawDialog
          onClose={() => setWithdrawOpen(false)}
          onSuccess={() => {
            setWithdrawOpen(false);
          }}
          maxAmount={collateralBalance}
        />
      )}
    </div>
  );
}

/**
 * Dialog component for depositing collateral.
 * @param onClose - Callback when dialog is closed
 * @param onSuccess - Callback when deposit is successful
 */
function DepositDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { deposit, isLoading, error } = useDeposit();
  const userTokenAccount = useTokenAccount(USDC_MINT_ADDRESS);
  const { balance: walletBalance } = useTokenBalance(userTokenAccount);
  const [amount, setAmount] = useState("");

  /**
   * Fires the deposit transaction and calls onSuccess if it lands.
   */
  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0 || !userTokenAccount) return;
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** USDC_DECIMALS);
    const sig = await deposit(amountLamports, userTokenAccount);
    if (sig) onSuccess();
  };

  /** Sets the input to the user's full wallet balance. */
  const handleMax = () => {
    if (walletBalance === null) return;
    const maxAmount = Number(walletBalance) / 10 ** USDC_DECIMALS;
    setAmount(maxAmount.toString());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border-low bg-card-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Deposit Collateral</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted transition hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-muted">
          Deposit USDC to use as collateral for perpetual futures trading.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              Amount (USDC)
            </label>
            <button
              onClick={handleMax}
              disabled={!walletBalance || walletBalance === 0n}
              className="text-xs font-medium text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Max: {walletBalance !== null
                ? `${(Number(walletBalance) / 10 ** USDC_DECIMALS).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                : "—"} USDC
            </button>
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            disabled={isLoading}
            className="w-full rounded-xl border border-input-border bg-input-bg px-4 py-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
          />
        </div>

        {walletBalance !== null && (
          <div className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
            <span>Wallet Balance: </span>
            <span className="font-mono font-semibold text-foreground">
              {(Number(walletBalance) / 10 ** USDC_DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-short/20 bg-short-muted px-3 py-2 text-xs text-short">
            {error.message}
          </div>
        )}

        <button
          onClick={handleDeposit}
          disabled={isLoading || !amount || parseFloat(amount) <= 0 || !userTokenAccount}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Depositing..." : "Deposit USDC"}
        </button>
      </div>
    </div>
  );
}

/**
 * Dialog component for withdrawing collateral.
 * @param onClose - Callback when dialog is closed
 * @param onSuccess - Callback when withdrawal is successful
 * @param maxAmount - Maximum amount available to withdraw
 */
function WithdrawDialog({
  onClose,
  onSuccess,
  maxAmount,
}: {
  onClose: () => void;
  onSuccess: () => void;
  maxAmount: bigint;
}) {
  const { withdraw, isLoading, error } = useWithdraw();
  const userTokenAccount = useTokenAccount(USDC_MINT_ADDRESS);
  const [amount, setAmount] = useState("");

  /**
   * Fires the withdraw transaction and calls onSuccess if it lands.
   */
  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0 || !userTokenAccount) return;
    const amountLamports = Math.floor(parseFloat(amount) * 10 ** USDC_DECIMALS);
    const sig = await withdraw(amountLamports, userTokenAccount);
    if (sig) onSuccess();
  };

  /** Sets the input to the maximum available collateral. */
  const handleMax = () => {
    const maxAmountNumber = Number(maxAmount) / 10 ** USDC_DECIMALS;
    setAmount(maxAmountNumber.toString());
  };

  const maxAmountDisplay = Number(maxAmount) / 10 ** USDC_DECIMALS;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border-low bg-card-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Withdraw Collateral</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted transition hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-muted">
          Withdraw USDC collateral from your trading account.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              Amount (USDC)
            </label>
            <button
              onClick={handleMax}
              disabled={maxAmount === 0n}
              className="text-xs font-medium text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Max: {maxAmountDisplay.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC
            </button>
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            max={maxAmountDisplay}
            disabled={isLoading}
            className="w-full rounded-xl border border-input-border bg-input-bg px-4 py-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
          />
        </div>

        <div className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
          <span>Available Collateral: </span>
          <span className="font-mono font-semibold text-foreground">
            {maxAmountDisplay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
          </span>
        </div>

        {parseFloat(amount) > maxAmountDisplay && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
            Amount exceeds available collateral
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-short/20 bg-short-muted px-3 py-2 text-xs text-short">
            {error.message}
          </div>
        )}

        <button
          onClick={handleWithdraw}
          disabled={isLoading || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxAmountDisplay || !userTokenAccount}
          className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Withdrawing..." : "Withdraw USDC"}
        </button>
      </div>
    </div>
  );
}