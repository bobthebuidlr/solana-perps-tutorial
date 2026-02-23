"use client";

import { type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { useEffect, useState } from "react";
import { type PerpsMarket } from "../generated/perps";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { useCollateral } from "../hooks/useCollateral";
import { useDeposit } from "../hooks/useDeposit";
import { useMarkets } from "../hooks/useMarkets";
import { useOpenPosition } from "../hooks/useOpenPosition";
import { useTokenAccount } from "../hooks/useTokenAccount";

const USDC_DECIMALS = 6;
const USDC_MINT_ADDRESS =
  "3xcGW4uvAGbfiPUieTJLg4fMbL3SposFqRJp5WgTzooL" as Address;

/**
 * Formats a raw bigint USDC amount into a two-decimal display string.
 * @param amount - Raw amount in base units (10^6 per USDC), or null.
 * @returns Human-readable string like "123.45".
 */
function formatUsdc(amount: bigint | null): string {
  if (amount === null) return "0.00";
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const whole = amount / divisor;
  const frac = (amount % divisor).toString().padStart(USDC_DECIMALS, "0");
  return `${whole}.${frac.slice(0, 2)}`;
}

/**
 * Extracts the base ticker from a market name (e.g. "SOL-PERP" → "SOL").
 * @param name - Raw market name string.
 * @returns Uppercase ticker symbol, max 4 chars.
 */
function getSymbol(name: string): string {
  return (name.split("-")[0] ?? name).slice(0, 4).toUpperCase();
}

/**
 * Returns a deterministic Tailwind color pair for a market icon avatar.
 * @param name - Market name used to hash into the palette.
 * @returns Tailwind class string for background and text color.
 */
function iconColorClass(name: string): string {
  const palette = [
    "bg-blue-500/15 text-blue-500",
    "bg-violet-500/15 text-violet-500",
    "bg-emerald-500/15 text-emerald-500",
    "bg-orange-500/15 text-orange-500",
    "bg-pink-500/15 text-pink-500",
    "bg-cyan-500/15 text-cyan-500",
  ];
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[hash % palette.length]!;
}

/**
 * Formats a bigint into a compact human-readable string (K / M suffix).
 * @param val - Raw bigint value.
 * @returns Formatted string, e.g. "1.23M" or "456K".
 */
function fmt(val: bigint): string {
  const n = Number(val);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString();
}

/**
 * Combined markets list + order form panel.
 * Left column: clickable market rows, first market auto-selected.
 * Right column: order form scoped to the selected market.
 */
export function Markets() {
  const { markets, isLoading, error, refresh } = useMarkets();
  const [selectedMarket, setSelectedMarket] = useState<PerpsMarket | null>(
    null
  );

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
    <div className="grid grid-cols-[3fr_2fr] overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      {/* ── Left: market list ──────────────────────────────────────────────── */}
      <div className="border-r border-border-low p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">Markets</p>
          <span className="rounded-full bg-cream px-2.5 py-0.5 text-xs font-semibold text-foreground/70">
            {markets.length}
          </span>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-low">
              {["Market", "OI", "Funding"].map((col) => (
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
            {markets.map((market) => (
              <MarketRow
                key={market.tokenMint.toString()}
                market={market}
                isSelected={
                  selectedMarket?.tokenMint.toString() ===
                  market.tokenMint.toString()
                }
                onClick={() => setSelectedMarket(market)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Right: order form ─────────────────────────────────────────────── */}
      <div className="p-6">
        <OrderForm market={selectedMarket} />
      </div>
    </div>
  );
}

// ── Market list ────────────────────────────────────────────────────────────────

/**
 * Clickable row in the market list.
 * @param market - Market data to display.
 * @param isSelected - Whether this row is currently selected.
 * @param onClick - Called when the row is clicked.
 */
function MarketRow({
  market,
  isSelected,
  onClick,
}: {
  market: PerpsMarket;
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
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{market.name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted">
              {market.tokenMint.toString().slice(0, 4)}…
              {market.tokenMint.toString().slice(-4)}
            </p>
          </div>
        </div>
      </td>

      {/* Open interest with long/short skew bar */}
      <td className="py-3 pr-4 text-right">
        <p className="font-mono text-xs font-medium tabular-nums">
          {fmt(totalOi)}
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

      {/* Funding direction */}
      <td className="py-3 text-right">
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
            fundingPositive
              ? "bg-green-500/10 text-green-600"
              : "bg-red-500/10 text-red-500"
          }`}
        >
          {fundingPositive ? "▲" : "▼"}
          {fundingPositive ? "L" : "S"}
        </span>
      </td>
    </tr>
  );
}

// ── Order form ─────────────────────────────────────────────────────────────────

/**
 * Order form for the selected market. Handles collateral check,
 * direction toggle, size input, and submitting the open-position tx.
 * @param market - The currently selected market, or null.
 */
function OrderForm({ market }: { market: PerpsMarket | null }) {
  const { wallet } = useWalletConnection();
  const {
    collateral,
    lockedCollateral,
    isLoading: collateralLoading,
    refresh: refreshCollateral,
  } = useCollateral();
  const {
    openPosition,
    isLoading: isOpening,
    error: openError,
  } = useOpenPosition();

  const [direction, setDirection] = useState<PositionDirection>(
    PositionDirection.Long
  );
  const [sizeInput, setSizeInput] = useState("");
  const [txSuccess, setTxSuccess] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const walletAddress = wallet?.account.address;
  const availableCollateral = collateral ?? 0n;
  const hasCollateral = availableCollateral > 0n;
  const maxSizeUsdc = Number(availableCollateral) / 10 ** USDC_DECIMALS;

  // Reset form whenever the selected market changes
  useEffect(() => {
    setSizeInput("");
    setTxSuccess(false);
  }, [market?.tokenMint.toString()]);

  /**
   * Submits the open-position transaction.
   */
  const handleOpenPosition = async () => {
    if (!market || !walletAddress || !sizeInput || parseFloat(sizeInput) <= 0)
      return;
    setTxSuccess(false);
    const amountLamports = Math.floor(
      parseFloat(sizeInput) * 10 ** USDC_DECIMALS
    );
    const sig = await openPosition(market.tokenMint, direction, amountLamports);
    if (sig) {
      setTxSuccess(true);
      setSizeInput("");
      setTimeout(() => refreshCollateral(), 1000);
    }
  };

  if (!walletAddress) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-16 text-center gap-2">
        <p className="text-sm text-muted">Connect your wallet to trade.</p>
      </div>
    );
  }

  if (collateralLoading) {
    return (
      <div className="space-y-3 pt-2">
        <div className="h-9 animate-pulse rounded-xl bg-cream/50" />
        <div className="h-20 animate-pulse rounded-xl bg-cream/50" />
        <div className="h-12 animate-pulse rounded-xl bg-cream/50" />
      </div>
    );
  }

  const symbol = market ? getSymbol(market.name) : "";
  const colorClass = market ? iconColorClass(market.name) : "";
  const parsedSize = parseFloat(sizeInput) || 0;
  const sizeValid = parsedSize > 0 && parsedSize <= maxSizeUsdc;

  // No collateral deposited yet
  if (!hasCollateral) {
    return (
      <>
        <div className="space-y-4">
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
            <button
              onClick={() => setDepositOpen(true)}
              className="w-full rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
            >
              Deposit Collateral
            </button>
          </div>
        </div>

        {depositOpen && (
          <DepositDialog
            onClose={() => setDepositOpen(false)}
            onSuccess={() => {
              setDepositOpen(false);
              setTimeout(() => refreshCollateral(), 1000);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Market + available collateral header */}
        <div className="flex items-center justify-between">
          {market && (
            <MarketHeader
              symbol={symbol}
              colorClass={colorClass}
              name={market.name}
            />
          )}
          <div className="text-right">
            <p className="text-xs text-muted">Available</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatUsdc(availableCollateral)}{" "}
              <span className="text-xs font-normal text-muted">USDC</span>
            </p>
          </div>
        </div>

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

        {/* Position size input */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              Size (USDC)
            </label>
            <button
              onClick={() => setSizeInput(maxSizeUsdc.toFixed(2))}
              className="text-xs font-medium text-muted transition hover:text-foreground"
            >
              Max: {formatUsdc(availableCollateral)}
            </button>
          </div>
          <div className="relative">
            <input
              type="number"
              value={sizeInput}
              onChange={(e) => setSizeInput(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              max={maxSizeUsdc}
              disabled={isOpening}
              className="w-full rounded-xl border border-border-low bg-card px-4 py-3 pr-16 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">
              USDC
            </span>
          </div>
          {parsedSize > maxSizeUsdc && maxSizeUsdc > 0 && (
            <p className="text-xs text-red-500">Exceeds available collateral</p>
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
              {parsedSize > 0 ? `${sizeInput} USDC` : "—"}
            </span>
          </SummaryRow>
          <SummaryRow label="Available after">
            <span className="font-mono tabular-nums">
              {parsedSize > 0
                ? `${Math.max(0, maxSizeUsdc - parsedSize).toFixed(2)} USDC`
                : `${formatUsdc(availableCollateral)} USDC`}
            </span>
          </SummaryRow>
          <SummaryRow label="Locked">
            <span className="font-mono tabular-nums">
              {formatUsdc(lockedCollateral)} USDC
            </span>
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

        {/* Deposit more link */}
        <button
          onClick={() => setDepositOpen(true)}
          className="w-full rounded-xl border border-border-low bg-card px-4 py-2.5 text-xs font-medium text-muted transition hover:-translate-y-0.5 hover:text-foreground hover:shadow-sm"
        >
          + Deposit more collateral
        </button>

        {txSuccess && (
          <div className="rounded-lg border border-green-500/20 bg-green-50/50 p-3 text-sm text-green-600">
            Position opened successfully!
          </div>
        )}

        {openError && (
          <div className="rounded-lg border border-red-500/20 bg-red-50/50 p-3 text-sm text-red-600">
            {openError.message}
          </div>
        )}
      </div>

      {depositOpen && (
        <DepositDialog
          onClose={() => setDepositOpen(false)}
          onSuccess={() => {
            setDepositOpen(false);
            setTimeout(() => refreshCollateral(), 1000);
          }}
        />
      )}
    </>
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

/**
 * Modal dialog for depositing USDC collateral.
 * @param onClose - Called when the dialog should be dismissed.
 * @param onSuccess - Called after a successful deposit transaction.
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

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-muted">
            Amount (USDC)
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              disabled={isLoading}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              className="w-full rounded-xl border border-border-low bg-cream/30 px-4 py-3 pr-16 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted">
              
            </span>
          </div>
        </div>

        <button
          onClick={handleDeposit}
          disabled={
            isLoading || !amount || parseFloat(amount) <= 0 || !userTokenAccount
          }
          className="w-full rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading
            ? "Depositing…"
            : !userTokenAccount
              ? "Loading…"
              : "Deposit"}
        </button>

        {error && <p className="text-xs text-red-500">{error.message}</p>}
      </div>
    </div>
  );
}
