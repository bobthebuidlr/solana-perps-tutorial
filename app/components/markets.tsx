"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useEffect, useState } from "react";
import { type PerpsMarket } from "../generated/perps";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { useAccountHealth } from "../hooks/useAccountHealth";
import { useCollateral } from "../hooks/useCollateral";
import { useMarkets } from "../hooks/useMarkets";
import { useClosePosition } from "../hooks/useClosePosition";
import { useOpenPosition } from "../hooks/useOpenPosition";
import { useOraclePrices } from "../hooks/useOraclePrices";
import { usePositions } from "../hooks/usePositions";
import { useUpdatePosition } from "../hooks/useUpdatePosition";
import { TOKEN_DECIMALS, USDC_DECIMALS } from "../lib/constants";
import { formatFundingRate, formatOi, getSymbol, iconColorClass } from "../lib/format";
import { Card, EmptyState, Skeleton } from "./ui";

/**
 * Markets component with market list and order form side-by-side.
 */
export function Markets() {
  const { markets, isLoading, error, refresh: refetch } = useMarkets();
  const [selectedMarket, setSelectedMarket] = useState<PerpsMarket | null>(null);

  useEffect(() => {
    if (markets && markets.length > 0 && !selectedMarket) {
      const timer = setTimeout(() => setSelectedMarket(markets[0]), 0);
      return () => clearTimeout(timer);
    }
  }, [markets, selectedMarket]);

  if (isLoading) {
    return <Card><Skeleton /></Card>;
  }

  if (error) {
    return (
      <Card>
        <div className="p-6">
          <div className="rounded-xl border border-short/20 bg-short-muted px-4 py-3 text-sm">
            <p className="text-short">{error.message}</p>
            <button
              onClick={() => refetch()}
              className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-hover"
            >
              Retry
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (!markets || markets.length === 0) {
    return <Card><div className="p-6"><EmptyState>No markets available</EmptyState></div></Card>;
  }

  return (
    <div className="grid grid-cols-[2fr_1fr] gap-4">
      <MarketsList
        markets={markets}
        selectedMarket={selectedMarket}
        onSelectMarket={setSelectedMarket}
      />
      <OrderForm market={selectedMarket} />
    </div>
  );
}

/**
 * Displays the list of available markets in a table.
 * @param markets - Array of market data.
 * @param selectedMarket - Currently selected market.
 * @param onSelectMarket - Callback to select a market.
 */
function MarketsList({
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
    <Card>
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">Markets</p>
          <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-semibold text-foreground/70">
            {markets.length}
          </span>
        </div>

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
                  isSelected={selectedMarket?.tokenMint.toString() === market.tokenMint.toString()}
                  onClick={() => onSelectMarket(market)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * Clickable row in the market list.
 * @param market - Market data to display.
 * @param oraclePrice - Current oracle price, or null.
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
  const longPct = totalOi > 0n ? Number((market.totalLongOi * 100n) / totalOi) : 50;
  const fundingPositive = market.totalLongOi >= market.totalShortOi;
  const fundingRate = formatFundingRate(market.totalLongOi, market.totalShortOi);

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors ${isSelected ? "bg-surface-hover" : "hover:bg-surface"}`}
    >
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2.5">
          <span className={`h-4 w-0.5 rounded-full transition-colors ${isSelected ? "bg-primary" : "bg-transparent"}`} />
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${colorClass}`}>
            {symbol.slice(0, 3)}
          </span>
          <p className="font-semibold leading-tight">{market.name}</p>
        </div>
      </td>

      <td className="py-3 pr-4 text-right font-mono text-xs font-medium tabular-nums">
        {oraclePrice !== null
          ? `$${(Number(oraclePrice) / 10 ** USDC_DECIMALS).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "\u2014"}
      </td>

      <td className="py-3 pr-4 text-right">
        <p className="font-mono text-xs font-medium tabular-nums">{formatOi(totalOi)}</p>
        <div className="mt-1 flex items-center justify-end gap-1">
          <div className="h-1 w-12 overflow-hidden rounded-full bg-short-muted">
            <div className="h-full rounded-full bg-long transition-all" style={{ width: `${longPct}%` }} />
          </div>
        </div>
      </td>

      <td className="py-3 text-right">
        <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${
          fundingPositive ? "bg-long-muted text-long" : "bg-short-muted text-short"
        }`}>
          {fundingRate}
        </span>
      </td>
    </tr>
  );
}

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
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${colorClass}`}>
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
function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

/**
 * Order form for the selected market.
 * @param market - The currently selected market, or null.
 */
export function OrderForm({ market }: { market: PerpsMarket | null }) {
  const { wallet } = useWalletConnection();
  const { balance, isLoading: collateralLoading } = useCollateral();
  const { availableCollateral } = useAccountHealth();
  const { openPosition, isLoading: isOpening } = useOpenPosition();
  const { updatePosition, isLoading: isUpdating } = useUpdatePosition();
  const { closePosition, isLoading: isClosing } = useClosePosition();
  const { prices: oraclePrices, isLoading: pricesLoading } = useOraclePrices();
  const { positions } = usePositions();

  const [direction, setDirection] = useState<PositionDirection>(PositionDirection.Long);
  const [sizeInput, setSizeInput] = useState("");

  const walletAddress = wallet?.account.address;
  const collateralBalance = balance ?? 0n;
  const hasCollateral = collateralBalance > 0n;
  const existingPosition = positions.find(
    (p) => p.perpsMarket.toString() === market?.tokenMint.toString()
  );
  const isSubmitting = isOpening || isUpdating || isClosing;
  const isOppositeDirection = existingPosition
    ? (direction === PositionDirection.Long) !== (existingPosition.direction === PositionDirection.Long)
    : false;

  const oraclePrice =
    oraclePrices?.find((p) => p.tokenMint.toString() === market?.tokenMint.toString())?.price ?? null;

  const leverage = market ? Number(market.maxLeverage) / 1_000_000 : 1;

  const baseMaxQty =
    oraclePrice && oraclePrice > 0n && availableCollateral > 0n
      ? (availableCollateral * BigInt(leverage) * BigInt(10 ** TOKEN_DECIMALS)) / oraclePrice
      : 0n;
  const maxQtyBase = isOppositeDirection
    ? existingPosition!.positionSize + baseMaxQty
    : baseMaxQty;
  const maxQtyDisplay = Number(maxQtyBase) / 10 ** TOKEN_DECIMALS;

  const marketTokenMint = market?.tokenMint.toString();
  useEffect(() => { setSizeInput(""); }, [marketTokenMint]);

  /**
   * Submits an order that nets against any existing position.
   */
  const handleSubmitOrder = async () => {
    if (!market || !walletAddress || !sizeInput || parseFloat(sizeInput) <= 0) return;

    const orderQty = Math.floor(parseFloat(sizeInput) * 10 ** TOKEN_DECIMALS);
    let sig: string | null = null;

    if (!existingPosition) {
      sig = await openPosition(market.tokenMint, direction, orderQty);
    } else {
      const currentSize = Number(existingPosition.positionSize);
      const sameDirection =
        (direction === PositionDirection.Long && existingPosition.direction === PositionDirection.Long) ||
        (direction === PositionDirection.Short && existingPosition.direction === PositionDirection.Short);

      if (sameDirection) {
        sig = await updatePosition(market.tokenMint, direction, currentSize + orderQty);
      } else if (orderQty < currentSize) {
        sig = await updatePosition(market.tokenMint, existingPosition.direction, currentSize - orderQty);
      } else if (orderQty === currentSize) {
        sig = await closePosition(market.tokenMint);
      } else {
        sig = await updatePosition(market.tokenMint, direction, orderQty - currentSize);
      }
    }

    if (sig) setSizeInput("");
  };

  if (!walletAddress) {
    return (
      <Card>
        <div className="flex h-full flex-col items-center justify-center p-6 py-16 text-center gap-2">
          <p className="text-sm text-muted">Connect your wallet to trade.</p>
        </div>
      </Card>
    );
  }

  if (collateralLoading || pricesLoading) {
    return (
      <Card>
        <div className="space-y-3 p-6">
          <div className="h-9 animate-pulse rounded-xl bg-surface" />
          <div className="h-20 animate-pulse rounded-xl bg-surface" />
          <div className="h-12 animate-pulse rounded-xl bg-surface" />
        </div>
      </Card>
    );
  }

  const symbol = market ? getSymbol(market.name) : "";
  const colorClass = market ? iconColorClass(market.name) : "";
  const parsedQty = parseFloat(sizeInput) || 0;
  const parsedQtyBase = BigInt(Math.floor(parsedQty * 10 ** TOKEN_DECIMALS));

  const notionalValue =
    oraclePrice && parsedQtyBase > 0n
      ? (parsedQtyBase * oraclePrice) / BigInt(10 ** TOKEN_DECIMALS)
      : 0n;

  const grossCollateralCost = leverage > 0 ? notionalValue / BigInt(leverage) : 0n;
  const effectiveCollateralCost = (() => {
    if (!isOppositeDirection || !oraclePrice) return grossCollateralCost;
    if (parsedQtyBase <= existingPosition!.positionSize) return 0n;
    const netSize = parsedQtyBase - existingPosition!.positionSize;
    const netNotional = (netSize * oraclePrice) / BigInt(10 ** TOKEN_DECIMALS);
    return leverage > 0 ? netNotional / BigInt(leverage) : 0n;
  })();

  const sizeValid =
    parsedQty > 0 && oraclePrice !== null && effectiveCollateralCost <= availableCollateral;

  if (!hasCollateral) {
    return (
      <Card>
        <div className="space-y-4 p-6">
          {market && <MarketHeader symbol={symbol} colorClass={colorClass} name={market.name} />}
          <div className="space-y-3 rounded-xl border border-dashed border-border-strong bg-surface p-6 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover text-base">
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
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-4 p-6">
        {market && <MarketHeader symbol={symbol} colorClass={colorClass} name={market.name} />}

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border-low bg-surface p-1">
          <button
            onClick={() => setDirection(PositionDirection.Long)}
            className={`rounded-lg py-2.5 text-sm font-semibold transition ${
              direction === PositionDirection.Long
                ? "bg-long-muted text-long shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Long
          </button>
          <button
            onClick={() => setDirection(PositionDirection.Short)}
            className={`rounded-lg py-2.5 text-sm font-semibold transition ${
              direction === PositionDirection.Short
                ? "bg-short-muted text-short shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Short
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              Size {market ? `(${symbol})` : ""}
            </label>
            <button
              onClick={() =>
                setSizeInput(maxQtyDisplay.toLocaleString("en-US", { maximumFractionDigits: 6, useGrouping: false }))
              }
              disabled={!oraclePrice || maxQtyDisplay <= 0}
              className="text-xs font-medium text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Max: {maxQtyDisplay > 0
                ? `${maxQtyDisplay.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol}`
                : "\u2014"}
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
              disabled={isSubmitting || !oraclePrice}
              className="w-full rounded-xl border border-input-border bg-input-bg px-4 py-3 pr-16 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">
              {symbol || "\u2014"}
            </span>
          </div>
          {parsedQty > 0 && oraclePrice !== null && effectiveCollateralCost > availableCollateral && (
            <p className="text-xs text-short">Exceeds available collateral</p>
          )}
          {!oraclePrice && market && (
            <p className="text-xs text-muted">Waiting for oracle price\u2026</p>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-border-low bg-surface px-4 py-3 text-sm">
          <SummaryRow label="Direction">
            <span className={direction === PositionDirection.Long ? "font-semibold text-long" : "font-semibold text-short"}>
              {direction === PositionDirection.Long ? "Long" : "Short"}
            </span>
          </SummaryRow>
          <SummaryRow label="Size">
            <span className="font-mono tabular-nums">
              {parsedQty > 0 ? `${sizeInput} ${symbol}` : "\u2014"}
            </span>
          </SummaryRow>
          <SummaryRow label="Leverage">
            <span className="font-mono tabular-nums">{leverage}x</span>
          </SummaryRow>
        </div>

        <button
          onClick={handleSubmitOrder}
          disabled={isSubmitting || !sizeValid}
          className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
            direction === PositionDirection.Long ? "bg-long text-background" : "bg-short text-background"
          }`}
        >
          {isSubmitting
            ? "Submitting\u2026"
            : `${existingPosition ? "Modify" : "Open"} ${direction === PositionDirection.Long ? "Long" : "Short"}`}
        </button>
      </div>
    </Card>
  );
}
