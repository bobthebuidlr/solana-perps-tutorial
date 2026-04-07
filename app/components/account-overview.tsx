"use client";

import { type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { useEffect, useState } from "react";
import { useCollateral } from "../hooks/useCollateral";
import { usePositions } from "../hooks/usePositions";
import { usePositionPnl } from "../hooks/usePositionPnl";
import { useDeposit } from "../hooks/useDeposit";
import { useWithdraw } from "../hooks/useWithdraw";
import { useTokenAccount } from "../hooks/useTokenAccount";
import { useTokenBalance } from "../hooks/useTokenBalance";
import { formatUsdc } from "../lib/format";
import { USDC_DECIMALS, USDC_MINT_ADDRESS } from "../lib/constants";


/**
 * Account overview component showing user's trading account status.
 * Displays available collateral, locked collateral, unrealized PnL, and total equity.
 */
export function AccountOverview() {
  const { wallet } = useWalletConnection();
  const walletAddress = wallet?.account.address;
  
  const {
    collateral,
    lockedCollateral,
    isLoading: collateralLoading,
  } = useCollateral();
  const { positions, isLoading: positionsLoading } = usePositions();

  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const availableCollateral = collateral ?? 0n;
  const locked = lockedCollateral ?? 0n;
  
  // Calculate total unrealized PnL from all positions
  const [totalUnrealizedPnl, setTotalUnrealizedPnl] = useState(0n);
  
  const totalEquity = availableCollateral + locked + totalUnrealizedPnl;

  if (!walletAddress) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="p-6">
          <p className="text-sm font-semibold mb-4">Account Overview</p>
          <div className="rounded-xl bg-cream/30 px-4 py-8 text-center text-sm text-muted">
            Connect your wallet to view account details
          </div>
        </div>
      </div>
    );
  }

  const isLoading = collateralLoading || positionsLoading;

  return (
    <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
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
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
            >
              Deposit
            </button>
            <button
              onClick={() => setWithdrawOpen(true)}
              disabled={isLoading || (availableCollateral ?? 0n) <= 0n}
              className="rounded-lg border border-border-low bg-card px-3 py-1.5 text-xs font-medium text-muted transition hover:-translate-y-0.5 hover:text-foreground hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Withdraw
            </button>
          </div>
        </div>

        {/* Total Equity */}
        <div className="mb-6 rounded-xl bg-gradient-to-br from-foreground/5 to-foreground/10 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted mb-2">
            Total Equity
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {isLoading ? (
              <span className="inline-block h-7 w-32 animate-pulse rounded bg-cream/50" />
            ) : (
              formatUsdc(totalEquity)
            )}
          </p>
          <p className="text-xs text-muted mt-1">USDC</p>
        </div>

        {/* Equity breakdown */}
        <div className="space-y-4">
          {/* Available Collateral */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm font-medium">Available</span>
              </div>
              <span className="font-mono text-sm tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-4 w-20 animate-pulse rounded bg-cream/50" />
                ) : (
                  formatUsdc(availableCollateral)
                )}
              </span>
            </div>
          </div>

          {/* Locked Collateral */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-yellow-500" />
                <span className="text-sm font-medium">Locked</span>
              </div>
              <span className="font-mono text-sm tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-4 w-20 animate-pulse rounded bg-cream/50" />
                ) : (
                  formatUsdc(locked)
                )}
              </span>
            </div>
          </div>

          {/* Unrealized PnL */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    totalUnrealizedPnl >= 0n ? "bg-blue-500" : "bg-red-500"
                  }`}
                />
                <span className="text-sm font-medium">Unrealized PnL</span>
              </div>
              <span
                className={`font-mono text-sm tabular-nums ${
                  totalUnrealizedPnl >= 0n ? "text-green-600" : "text-red-500"
                }`}
              >
                {isLoading ? (
                  <span className="inline-block h-4 w-20 animate-pulse rounded bg-cream/50" />
                ) : (
                  <>
                    {totalUnrealizedPnl >= 0n ? "+" : "-"}
                    {formatUsdc(totalUnrealizedPnl >= 0n ? totalUnrealizedPnl : -totalUnrealizedPnl)}
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="my-4 border-t border-border-low" />

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted">Positions</p>
            <p className="font-semibold">{positions.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Utilization</p>
            <p className="font-semibold">
              {availableCollateral + locked > 0n
                ? `${Math.round(Number(locked * 100n / (availableCollateral + locked)))}%`
                : "0%"}
            </p>
          </div>
        </div>
      </div>
      
      {/* PnL aggregator component - handles fetching PnL for all positions */}
      <PnLAggregator 
        positions={positions} 
        onPnlUpdate={setTotalUnrealizedPnl}
      />
      
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
          maxAmount={availableCollateral ?? 0n}
        />
      )}
    </div>
  );
}

/**
 * Component that aggregates PnL from multiple positions.
 * Uses a shared context to collect PnL values from multiple hooks.
 */
function PnLAggregator({ 
  positions, 
  onPnlUpdate 
}: { 
  positions: Array<{ perpsMarket: { toString: () => string } }>;
  onPnlUpdate: (total: bigint) => void;
}) {
  const [pnlMap, setPnlMap] = useState<Map<string, bigint>>(new Map());
  
  // Calculate total whenever pnlMap changes
  useEffect(() => {
    const total = Array.from(pnlMap.values()).reduce((sum, val) => sum + val, 0n);
    onPnlUpdate(total);
  }, [pnlMap, onPnlUpdate]);
  
  // Clear PnL when no positions
  useEffect(() => {
    if (positions.length === 0) {
      setPnlMap(new Map());
      onPnlUpdate(0n);
    }
  }, [positions.length, onPnlUpdate]);
  
  return (
    <>
      {positions.map((position) => (
        <SinglePositionPnL
          key={position.perpsMarket.toString()}
          tokenMint={position.perpsMarket as Address}
          onPnlChange={(pnl) => {
            setPnlMap(prev => {
              const newMap = new Map(prev);
              if (pnl !== null) {
                newMap.set(position.perpsMarket.toString(), pnl);
              } else {
                newMap.delete(position.perpsMarket.toString());
              }
              return newMap;
            });
          }}
        />
      ))}
    </>
  );
}

/**
 * Component to handle PnL for a single position.
 */
function SinglePositionPnL({ 
  tokenMint, 
  onPnlChange 
}: { 
  tokenMint: Address;
  onPnlChange: (pnl: bigint | null) => void;
}) {
  const { pnl } = usePositionPnl(tokenMint);
  
  useEffect(() => {
    if (pnl) {
      const totalPnl = pnl.price + pnl.funding;
      onPnlChange(totalPnl);
    } else {
      onPnlChange(null);
    }
  }, [pnl, onPnlChange]);
  
  return null;
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
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-xl"
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
            className="w-full rounded-xl border border-border-low bg-card px-4 py-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
          />
        </div>

        {walletBalance !== null && (
          <div className="rounded-lg bg-cream/30 px-3 py-2 text-xs text-muted">
            <span>Wallet Balance: </span>
            <span className="font-mono font-semibold text-foreground">
              {(Number(walletBalance) / 10 ** USDC_DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-50/50 px-3 py-2 text-xs text-red-600">
            {error.message}
          </div>
        )}

        <button
          onClick={handleDeposit}
          disabled={isLoading || !amount || parseFloat(amount) <= 0 || !userTokenAccount}
          className="w-full rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-xl"
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
            className="w-full rounded-xl border border-border-low bg-card px-4 py-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
          />
        </div>

        <div className="rounded-lg bg-cream/30 px-3 py-2 text-xs text-muted">
          <span>Available Collateral: </span>
          <span className="font-mono font-semibold text-foreground">
            {maxAmountDisplay.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
          </span>
        </div>

        {parseFloat(amount) > maxAmountDisplay && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-50/50 px-3 py-2 text-xs text-yellow-600">
            Amount exceeds available collateral
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-50/50 px-3 py-2 text-xs text-red-600">
            {error.message}
          </div>
        )}

        <button
          onClick={handleWithdraw}
          disabled={isLoading || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxAmountDisplay || !userTokenAccount}
          className="w-full rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Withdrawing..." : "Withdraw USDC"}
        </button>
      </div>
    </div>
  );
}