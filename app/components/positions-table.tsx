"use client";

import { type Address } from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { type Position } from "../generated/perps/accounts/position";
import { type PerpsMarket } from "../generated/perps/types/perpsMarket";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { useMarkets } from "../hooks/useMarkets";
import { useOraclePrices } from "../hooks/useOraclePrices";
import { usePositionPnl } from "../hooks/usePositionPnl";
import { usePositions } from "../hooks/usePositions";

const USDC_DECIMALS = 6;
const TOKEN_DECIMALS = 6; // position_size stored with 6-decimal precision

/**
 * Formats a raw u64 USDC amount into a two-decimal display string.
 * @param amount - Base units (10^6 = 1 USDC).
 * @returns e.g. "500.00"
 */
function formatUsdc(amount: bigint): string {
  const n = Number(amount) / 10 ** USDC_DECIMALS;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a raw u64 token quantity (6-decimal precision) into a display string.
 * @param amount - Token quantity in base units (10^6 = 1 token).
 * @returns e.g. "1.000000" or "0.500000"
 */
function formatTokenQty(amount: bigint): string {
  const n = Number(amount) / 10 ** TOKEN_DECIMALS;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/**
 * Formats a raw u64 price (6-decimal fixed point) as a dollar string.
 * @param price - Price in base units (10^6 = $1.00).
 * @returns e.g. "$100.00"
 */
function formatPrice(price: bigint): string {
  const n = Number(price) / 10 ** USDC_DECIMALS;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Formats a signed i64 USDC amount with an explicit +/- prefix.
 * @param amount - Signed base units (i64); positive = profit, negative = loss.
 * @returns e.g. "+12.34" or "-5.00"
 */
function formatPnl(amount: bigint): string {
  const n = Number(amount) / 10 ** USDC_DECIMALS;
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n >= 0 ? "+" : "-"}${abs}`;
}

/**
 * Returns Tailwind text-color class for a signed PnL amount.
 * @param amount - Signed i64 PnL in base units.
 * @returns Tailwind class string for green (profit) or red (loss).
 */
function pnlColorClass(amount: bigint): string {
  return amount >= 0n ? "text-green-600" : "text-red-500";
}

/**
 * Returns a human-readable relative age string for a Unix timestamp.
 * @param openedAt - Unix timestamp in seconds (i64).
 * @returns e.g. "5m ago", "2h ago", "3d ago"
 */
function formatAge(openedAt: bigint): string {
  const secs = Math.floor(Date.now() / 1000) - Number(openedAt);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * Extracts the base ticker from a market name (e.g. "SOL-PERP" → "SOL").
 * @param name - Raw market name string.
 * @returns Uppercase ticker, max 4 chars.
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
 * Table of all open perpetual futures positions for the connected wallet.
 * Displays entry price, size, collateral, price PnL, funding PnL, age, and a
 * placeholder close action. PnL values are fetched via the viewPositionPnl
 * on-chain view instruction per row.
 */
export function PositionsTable() {
  const { wallet } = useWalletConnection();
  const { positions, isLoading, error, refresh } = usePositions();
  const { markets } = useMarkets();
  const { prices: oraclePrices } = useOraclePrices();

  /**
   * Looks up a PerpsMarket by its token mint address.
   * @param perpsMarket - Token mint address stored on the Position account.
   * @returns The matching PerpsMarket, or undefined if not found.
   */
  function lookupMarket(perpsMarket: string): PerpsMarket | undefined {
    return markets?.find((m) => m.tokenMint.toString() === perpsMarket);
  }

  /**
   * Looks up the current oracle price for a token mint address.
   * @param tokenMint - Token mint address to look up.
   * @returns Current oracle price in base units (u64), or null if not found.
   */
  function lookupCurrentPrice(tokenMint: string): bigint | null {
    return (
      oraclePrices?.find((p) => p.tokenMint.toString() === tokenMint)?.price ??
      null
    );
  }

  // ── States ──────────────────────────────────────────────────────────────────

  if (!wallet?.account.address) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border-low bg-card shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-low px-6 py-4">
        <div>
          <p className="text-sm font-semibold">Open Positions</p>
          {!isLoading && (
            <p className="mt-0.5 text-xs text-muted">
              {positions.length === 0
                ? "No active positions"
                : `${positions.length} active ${positions.length === 1 ? "position" : "positions"}`}
            </p>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="rounded-lg border border-border-low bg-card px-3 py-1.5 text-xs font-medium text-muted transition hover:-translate-y-0.5 hover:text-foreground hover:shadow-sm disabled:opacity-50"
        >
          {isLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2 p-6">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl bg-cream/50"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="px-6 py-4">
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
      )}

      {/* Empty */}
      {!isLoading && !error && positions.length === 0 && (
        <div className="px-6 py-10 text-center text-sm text-muted">
          No open positions yet. Open one from the markets panel above.
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && positions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-low">
                {[
                  { label: "Market", align: "left" },
                  { label: "Size", align: "right" },
                  { label: "Entry Price", align: "right" },
                  { label: "Mark Price", align: "right" },
                  { label: "Price PnL", align: "right" },
                  { label: "Funding", align: "right" },
                  { label: "Collateral", align: "right" },
                  { label: "Opened", align: "right" },
                  { label: "", align: "right" },
                ].map((col) => (
                  <th
                    key={col.label}
                    className={`px-4 pb-3 pt-4 text-xs font-medium uppercase tracking-wide text-muted first:pl-6 last:pr-6 ${
                      col.align === "left" ? "text-left" : "text-right"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-low">
              {positions.map((position, i) => (
                <PositionRow
                  key={i}
                  position={position}
                  market={lookupMarket(position.perpsMarket.toString())}
                  currentPrice={lookupCurrentPrice(
                    position.perpsMarket.toString()
                  )}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Single row in the positions table.
 * @param position - Decoded Position account data.
 * @param market - Matching PerpsMarket for name/icon lookup, or undefined.
 * @param currentPrice - Current oracle price in base units (u64), or null.
 */
function PositionRow({
  position,
  market,
  currentPrice,
}: {
  position: Position;
  market: PerpsMarket | undefined;
  currentPrice: bigint | null;
}) {
  const { pnl, isLoading: isPnlLoading } = usePositionPnl(
    position.perpsMarket as Address
  );
  const isLong = position.direction === PositionDirection.Long;
  const name =
    market?.name ?? `${position.perpsMarket.toString().slice(0, 6)}…`;
  const symbol = market ? getSymbol(market.name) : "?";
  const colorClass = market
    ? iconColorClass(market.name)
    : "bg-gray-500/15 text-gray-500";

  return (
    <tr className="transition-colors hover:bg-cream/40">
      {/* Market + direction */}
      <td className="py-3.5 pl-6 pr-4">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${colorClass}`}
          >
            {symbol.slice(0, 3)}
          </span>
          <div>
            <p className="font-semibold leading-tight">{name}</p>
            <span
              className={`mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                isLong
                  ? "bg-green-500/10 text-green-600"
                  : "bg-red-500/10 text-red-500"
              }`}
            >
              {isLong ? "Long" : "Short"}
            </span>
          </div>
        </div>
      </td>

      {/* Size — token quantity */}
      <td className="py-3.5 px-4 text-right">
        <p className="font-mono tabular-nums">
          {formatTokenQty(position.positionSize)}
        </p>
        <p className="text-xs text-muted">{symbol}</p>
      </td>

      {/* Entry price */}
      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
        {formatPrice(position.entryPrice)}
      </td>

      {/* Current oracle (mark) price — shown alongside entry for comparison */}
      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
        {currentPrice !== null ? (
          <span
            className={
              currentPrice > position.entryPrice
                ? "text-green-600"
                : currentPrice < position.entryPrice
                  ? "text-red-500"
                  : ""
            }
          >
            {formatPrice(currentPrice)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Price PnL — profit/loss from price movement */}
      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
        {isPnlLoading ? (
          <span className="inline-block h-4 w-14 animate-pulse rounded bg-cream/50" />
        ) : pnl ? (
          <span className={pnlColorClass(pnl.price)}>
            {formatPnl(pnl.price)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Funding PnL — accrued funding cost/income */}
      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
        {isPnlLoading ? (
          <span className="inline-block h-4 w-14 animate-pulse rounded bg-cream/50" />
        ) : pnl ? (
          <span className={pnlColorClass(pnl.funding)}>
            {formatPnl(pnl.funding)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Collateral */}
      <td className="py-3.5 px-4 text-right">
        <p className="font-mono tabular-nums">
          {formatUsdc(position.collateral)}
        </p>
        <p className="text-xs text-muted">USDC</p>
      </td>

      {/* Opened */}
      <td className="py-3.5 px-4 text-right text-xs text-muted tabular-nums">
        {formatAge(position.openedAt)}
      </td>

      {/* Close — placeholder until closePosition instruction is added */}
      <td className="py-3.5 pl-4 pr-6 text-right">
        <button
          disabled
          title="Close position — coming soon"
          className="rounded-lg border border-border-low bg-card px-3 py-1.5 text-xs font-medium text-muted opacity-50 cursor-not-allowed"
        >
          Close
        </button>
      </td>
    </tr>
  );
}
