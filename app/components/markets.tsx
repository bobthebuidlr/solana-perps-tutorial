"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useEffect, useState } from "react";
import { type PerpsMarket } from "../generated/perps";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { useCollateral } from "../hooks/useCollateral";
import { useMarkets } from "../hooks/useMarkets";
import { useOpenPosition } from "../hooks/useOpenPosition";
import { useOraclePrices } from "../hooks/useOraclePrices";
import { TOKEN_DECIMALS, USDC_DECIMALS } from "../lib/constants";
import { formatFundingRate, formatOi, getSymbol, iconColorClass } from "../lib/format";

/**
 * Markets component manages the selected market state and passes it to children.
 * Automatically pre-selects the first market when loaded.
 */
export function Markets() {
  const { markets, isLoading, error, refresh: refetch } = useMarkets();
  const refresh = () => refetch();
  const [selectedMarket, setSelectedMarket] = useState<PerpsMarket | null>(
    null
  );

  // Auto-select first market when markets load
  useEffect(() => {
    if (markets && markets.length > 0 && !selectedMarket) {
      // Use setTimeout to avoid synchronous setState in effect
      const timer = setTimeout(() => setSelectedMarket(markets[0]), 0);
      return () => clearTimeout(timer);
    }
  }, [markets, selectedMarket]);

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="p-6 space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl bg-cream/50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="rounded-xl border border-red-500/20 bg-red-50/50 px-4 py-3 text-sm">
          <p className="text-red-600">{error.message}</p>
          <button
            onClick={refresh}
            className="mt-2 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!markets || markets.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="rounded-xl bg-cream/50 px-4 py-8 text-center text-sm text-muted">
          No markets available
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[2fr_1fr] gap-4">
      <MarketsList
        markets={markets}
        isLoading={isLoading}
        error={error}
        refresh={refresh}
        selectedMarket={selectedMarket}
        onSelectMarket={setSelectedMarket}
      />
      <OrderForm market={selectedMarket} />
    </div>
  );
}

/**
 * MarketsList displays the list of available markets.
 * @param markets - Array of market data.
 * @param isLoading - Loading state.
 * @param error - Error state.
 * @param refresh - Refresh callback.
 * @param selectedMarket - Currently selected market.
 * @param onSelectMarket - Callback to select a market.
 */
export function MarketsList({
  markets,
  isLoading,
  error,
  refresh,
  selectedMarket,
  onSelectMarket,
}: {
  markets: PerpsMarket[] | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  selectedMarket: PerpsMarket | null;
  onSelectMarket: (market: PerpsMarket) => void;
}) {
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="p-6 space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl bg-cream/50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="rounded-xl border border-red-500/20 bg-red-50/50 px-4 py-3 text-sm">
          <p className="text-red-600">{error.message}</p>
          <button
            onClick={refresh}
            className="mt-2 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!markets || markets.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="rounded-xl bg-cream/50 px-4 py-8 text-center text-sm text-muted">
          No markets available
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">Markets</p>
          <span className="rounded-full bg-cream px-2.5 py-0.5 text-xs font-semibold text-foreground/70">
            {markets.length}
          </span>
        </div>

        <MarketsTable
          markets={markets}
          selectedMarket={selectedMarket}
          onSelectMarket={onSelectMarket}
        />
      </div>
    </div>
  );
}

/**
 * Inner table for the markets list, fetches oracle prices for display.
 * @param markets - Array of market data.
 * @param selectedMarket - Currently selected market.
 * @param onSelectMarket - Callback to select a market.
 */
function MarketsTable({
  markets,
  selectedMarket,
  onSelectMarket,
}: {
  markets: PerpsMarket[];
  selectedMarket: PerpsMarket | null;
  onSelectMarket: (market: PerpsMarket) => void;
}) {
  const { prices: oraclePrices } = useOraclePrices();

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border-low">
          {["Market", "Oracle Price", "OI", "Funding"].map((col) => (
            <th
              key={col}
              className={`pb-3 text-xs font-medium uppercase tracking-wide text-muted ${
                col === "Market" ? "text-left" : "text-right"
              }`}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border-low">
        {markets.map((market) => {
          const price = oraclePrices?.find(
            (p) => p.tokenMint.toString() === market.tokenMint.toString()
          )?.price ?? null;
          return (
            <MarketRow
              key={market.tokenMint.toString()}
              market={market}
              oraclePrice={price}
              isSelected={
                selectedMarket?.tokenMint.toString() ===
                market.tokenMint.toString()
              }
              onClick={() => onSelectMarket(market)}
            />
          );
        })}
      </tbody>
    </table>
  );
}

// ── Market list row ────────────────────────────────────────────────────────────────

/**
 * Clickable row in the market list.
 * @param market - Market data to display.
 * @param oraclePrice - Current oracle price for this market, or null.
 * @param isSelected - Whether this row is currently selected.
 * @param onClick - Called when the row is clicked.
 */
function MarketRow({
  market,
  oraclePrice,
  isSelected,
  onClick,
}: {
  market: PerpsMarket;
  oraclePrice: bigint | null;
  isSelected: boolean;
  onClick: () => void;
}) {
  const symbol = getSymbol(market.name);
  const colorClass = iconColorClass(market.name);
  const totalOi = market.totalLongOi + market.totalShortOi;
  // Long percentage for the skew bar; defaults to 50 when there is no open interest
  const longPct =
    totalOi > 0n ? Number((market.totalLongOi * 100n) / totalOi) : 50;
  // When long OI exceeds short OI, longs pay shorts (positive funding)
  const fundingPositive = market.totalLongOi >= market.totalShortOi;
  const fundingRate = formatFundingRate(market.totalLongOi, market.totalShortOi);

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${
        isSelected ? "bg-cream/70" : "hover:bg-cream/40"
      }`}
    >
      {/* Market identity */}
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2.5">
          {/* Selection indicator */}
          <span
            className={`h-4 w-0.5 rounded-full transition-colors ${
              isSelected ? "bg-foreground" : "bg-transparent"
            }`}
          />
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${colorClass}`}
          >
            {symbol.slice(0, 3)}
          </span>
          <p className="font-semibold leading-tight">{market.name}</p>
        </div>
      </td>

      {/* Oracle price */}
      <td className="py-3 pr-4 text-right font-mono text-xs font-medium tabular-nums">
        {oraclePrice !== null
          ? `$${(Number(oraclePrice) / 10 ** USDC_DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "—"}
      </td>

      {/* Open interest with long/short skew bar */}
      <td className="py-3 pr-4 text-right">
        <p className="font-mono text-xs font-medium tabular-nums">
          {formatOi(totalOi)}
        </p>
        <div className="mt-1 flex items-center justify-end gap-1">
          <div className="h-1 w-12 overflow-hidden rounded-full bg-red-500/25">
            <div
              className="h-full rounded-full bg-green-500/70 transition-all"
              style={{ width: `${longPct}%` }}
            />
          </div>
        </div>
      </td>

      {/* Funding rate */}
      <td className="py-3 text-right">
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${
            fundingPositive
              ? "bg-green-500/10 text-green-600"
              : "bg-red-500/10 text-red-500"
          }`}
        >
          {fundingRate}
        </span>
      </td>
    </tr>
  );
}

// ── Order form ─────────────────────────────────────────────────────────────────

/**
 * Order form for the selected market. Handles collateral check,
 * direction toggle, size input (in token quantity), and submitting the open-position tx.
 * @param market - The currently selected market, or null.
 */
export function OrderForm({ market }: { market: PerpsMarket | null }) {
  const { wallet } = useWalletConnection();
  const { balance, isLoading: collateralLoading } = useCollateral();
  const {
    openPosition,
    isLoading: isOpening,
  } = useOpenPosition();
  const { prices: oraclePrices, isLoading: pricesLoading } = useOraclePrices();

  const [direction, setDirection] = useState<PositionDirection>(
    PositionDirection.Long
  );
  const [sizeInput, setSizeInput] = useState("");

  const walletAddress = wallet?.account.address;
  const collateralBalance = balance ?? 0n;
  const hasCollateral = collateralBalance > 0n;

  // Look up oracle price for the selected market
  const oraclePrice =
    oraclePrices?.find(
      (p) => p.tokenMint.toString() === market?.tokenMint.toString()
    )?.price ?? null;

  // Fixed leverage from market config (6-decimal, e.g. 10_000_000 = 10x)
  const leverage = market ? Number(market.maxLeverage) / 1_000_000 : 1;

  // Max token quantity: (available_collateral * leverage) / oracle_price
  const maxQtyBase =
    oraclePrice && oraclePrice > 0n && collateralBalance > 0n
      ? (collateralBalance * BigInt(leverage) * BigInt(10 ** TOKEN_DECIMALS)) / oraclePrice
      : 0n;
  const maxQtyDisplay = Number(maxQtyBase) / 10 ** TOKEN_DECIMALS;

  // Reset form whenever the selected market changes
  const marketTokenMint = market?.tokenMint.toString();
  useEffect(() => {
    setSizeInput("");
  }, [marketTokenMint]);

  /**
   * Submits the open-position transaction with token quantity as size.
   */
  const handleOpenPosition = async () => {
    if (!market || !walletAddress || !sizeInput || parseFloat(sizeInput) <= 0)
      return;
    // Convert token quantity to 6-decimal base units (e.g. 1.5 SOL → 1_500_000)
    const qtyBase = Math.floor(parseFloat(sizeInput) * 10 ** TOKEN_DECIMALS);
    // Pass the market's fixed leverage (already 6-decimal on-chain)
    const sig = await openPosition(market.tokenMint, direction, qtyBase, Number(market.maxLeverage));
    if (sig) {
      setSizeInput("");
    }
  };

  if (!walletAddress) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="flex h-full flex-col items-center justify-center p-6 py-16 text-center gap-2">
          <p className="text-sm text-muted">Connect your wallet to trade.</p>
        </div>
      </div>
    );
  }

  if (collateralLoading || pricesLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="space-y-3 p-6">
          <div className="h-9 animate-pulse rounded-xl bg-cream/50" />
          <div className="h-20 animate-pulse rounded-xl bg-cream/50" />
          <div className="h-12 animate-pulse rounded-xl bg-cream/50" />
        </div>
      </div>
    );
  }

  const symbol = market ? getSymbol(market.name) : "";
  const colorClass = market ? iconColorClass(market.name) : "";
  const parsedQty = parseFloat(sizeInput) || 0;
  const parsedQtyBase = BigInt(Math.floor(parsedQty * 10 ** TOKEN_DECIMALS));

  // Notional value: qty * oracle_price / 10^6
  const notionalValue =
    oraclePrice && parsedQtyBase > 0n
      ? (parsedQtyBase * oraclePrice) / BigInt(10 ** TOKEN_DECIMALS)
      : 0n;

  // Collateral cost (margin): notional / leverage
  const collateralCost = leverage > 0 ? notionalValue / BigInt(leverage) : 0n;

  const sizeValid =
    parsedQty > 0 &&
    oraclePrice !== null &&
    collateralCost <= collateralBalance;

  // No collateral deposited yet
  if (!hasCollateral) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="space-y-4 p-6">
          {market && (
            <MarketHeader
              symbol={symbol}
              colorClass={colorClass}
              name={market.name}
            />
          )}
          <div className="space-y-3 rounded-xl border border-dashed border-border-strong bg-cream/20 p-6 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-cream text-base">
              ⚡
            </span>
            <div>
              <p className="text-sm font-medium">No collateral deposited</p>
              <p className="mt-1 text-xs text-muted">
                Deposit USDC collateral before opening a position.
              </p>
            </div>
            <p className="text-xs text-center text-muted mt-2">
              Use the Account Overview to deposit collateral and start trading.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      <div className="space-y-4 p-6">
        {/* Market header */}
        {market && (
          <MarketHeader
            symbol={symbol}
            colorClass={colorClass}
            name={market.name}
          />
        )}

        {/* Long / Short direction toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border-low bg-cream/30 p-1">
          <button
            onClick={() => setDirection(PositionDirection.Long)}
            className={`rounded-lg py-2.5 text-sm font-semibold transition ${
              direction === PositionDirection.Long
                ? "bg-green-500/15 text-green-600 shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Long
          </button>
          <button
            onClick={() => setDirection(PositionDirection.Short)}
            className={`rounded-lg py-2.5 text-sm font-semibold transition ${
              direction === PositionDirection.Short
                ? "bg-red-500/15 text-red-500 shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Short
          </button>
        </div>

        {/* Position size input (token quantity) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              Size {market ? `(${symbol})` : ""}
            </label>
            <button
              onClick={() =>
                setSizeInput(
                  maxQtyDisplay.toLocaleString("en-US", {
                    maximumFractionDigits: 6,
                    useGrouping: false,
                  })
                )
              }
              disabled={!oraclePrice || maxQtyDisplay <= 0}
              className="text-xs font-medium text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Max:{" "}
              {maxQtyDisplay > 0
                ? `${maxQtyDisplay.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol}`
                : "—"}
            </button>
          </div>
          <div className="relative">
            <input
              type="number"
              value={sizeInput}
              onChange={(e) => setSizeInput(e.target.value)}
              placeholder="0.000000"
              step="0.000001"
              min="0"
              disabled={isOpening || !oraclePrice}
              className="w-full rounded-xl border border-border-low bg-card px-4 py-3 pr-16 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">
              {symbol || "—"}
            </span>
          </div>
          {parsedQty > 0 &&
            oraclePrice !== null &&
            collateralCost > collateralBalance && (
              <p className="text-xs text-red-500">
                Exceeds available collateral
              </p>
            )}
          {!oraclePrice && market && (
            <p className="text-xs text-muted">Waiting for oracle price…</p>
          )}
        </div>

        {/* Order summary */}
        <div className="space-y-2 rounded-xl border border-border-low bg-cream/20 px-4 py-3 text-sm">
          <SummaryRow label="Direction">
            <span
              className={
                direction === PositionDirection.Long
                  ? "font-semibold text-green-600"
                  : "font-semibold text-red-500"
              }
            >
              {direction === PositionDirection.Long ? "Long" : "Short"}
            </span>
          </SummaryRow>
          <SummaryRow label="Size">
            <span className="font-mono tabular-nums">
              {parsedQty > 0 ? `${sizeInput} ${symbol}` : "—"}
            </span>
          </SummaryRow>
          <SummaryRow label="Leverage">
            <span className="font-mono tabular-nums">{leverage}x</span>
          </SummaryRow>
        </div>

        {/* Submit */}
        <button
          onClick={handleOpenPosition}
          disabled={isOpening || !sizeValid}
          className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
            direction === PositionDirection.Long
              ? "bg-green-500 text-white"
              : "bg-red-500 text-white"
          }`}
        >
          {isOpening
            ? "Opening position…"
            : `Open ${direction === PositionDirection.Long ? "Long" : "Short"}`}
        </button>

      </div>
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────────

/**
 * Market identity block: colored avatar + name.
 * @param symbol - Short ticker (e.g. "SOL").
 * @param colorClass - Tailwind bg+text classes for the avatar.
 * @param name - Full market name (e.g. "SOL-PERP").
 */
function MarketHeader({
  symbol,
  colorClass,
  name,
}: {
  symbol: string;
  colorClass: string;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${colorClass}`}
      >
        {symbol.slice(0, 3)}
      </span>
      <div>
        <p className="font-semibold leading-tight">{name}</p>
        <p className="text-xs text-muted">Perpetual</p>
      </div>
    </div>
  );
}

/**
 * A single label/value row inside the order summary panel.
 * @param label - Left-side label text.
 * @param children - Right-side value node.
 */
function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}
