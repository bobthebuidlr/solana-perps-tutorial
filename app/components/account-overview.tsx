"use client";

import { type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { useEffect, useState, useMemo } from "react";
import { useCollateral } from "../hooks/useCollateral";
import { usePositions } from "../hooks/usePositions";
import { usePositionPnl } from "../hooks/usePositionPnl";
import { formatUsdc } from "../lib/format";

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
    refresh: refreshCollateral,
  } = useCollateral();
  const { positions, isLoading: positionsLoading, refresh: refreshPositions } = usePositions();
  
  // Auto-refresh positions every 5 seconds (silent refresh)
  useEffect(() => {
    const interval = setInterval(() => {
      if (walletAddress && refreshPositions) {
        refreshPositions(true); // silent refresh
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [walletAddress, refreshPositions]);

  // Auto-refresh collateral every 5 seconds (silent refresh)
  useEffect(() => {
    const interval = setInterval(() => {
      if (walletAddress && refreshCollateral) {
        refreshCollateral(true); // silent refresh
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [walletAddress, refreshCollateral]);

  const availableCollateral = collateral ?? 0n;
  const locked = lockedCollateral ?? 0n;
  
  // Calculate total unrealized PnL from all positions
  const [totalUnrealizedPnl, setTotalUnrealizedPnl] = useState(0n);
  
  const totalEquity = availableCollateral + locked + totalUnrealizedPnl;

  // Calculate percentage of total equity for visualization
  const totalForPercentage = totalEquity > 0n ? totalEquity : 1n;
  const availablePct = Number((availableCollateral * 100n) / totalForPercentage);
  const lockedPct = Number((locked * 100n) / totalForPercentage);
  const pnlPct = totalUnrealizedPnl >= 0n
    ? Number((totalUnrealizedPnl * 100n) / totalForPercentage)
    : -Number((-totalUnrealizedPnl * 100n) / totalForPercentage);

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
          <button
            onClick={() => {
              refreshCollateral();
              refreshPositions();
            }}
            disabled={isLoading}
            className="rounded-lg border border-border-low bg-card px-3 py-1.5 text-xs font-medium text-muted transition hover:-translate-y-0.5 hover:text-foreground hover:shadow-sm disabled:opacity-50"
          >
            {isLoading ? "Loading…" : "Refresh"}
          </button>
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
            {totalEquity > 0n && !isLoading && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, availablePct))}%` }}
                />
              </div>
            )}
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
            {totalEquity > 0n && !isLoading && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full bg-yellow-500 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, lockedPct))}%` }}
                />
              </div>
            )}
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
            {totalEquity > 0n && !isLoading && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full transition-all ${
                    totalUnrealizedPnl >= 0n ? "bg-blue-500" : "bg-red-500"
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, Math.abs(pnlPct)))}%` }}
                />
              </div>
            )}
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
  positions: Array<any>;
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