import { USDC_DECIMALS } from "./constants";

/**
 * Formats a raw bigint USDC amount into a two-decimal display string.
 * @param amount - Raw amount in base units (10^6 per USDC), or null.
 * @returns Human-readable string like "123.45".
 */
export function formatUsdc(amount: bigint | null): string {
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
export function getSymbol(name: string): string {
  return (name.split("-")[0] ?? name).slice(0, 4).toUpperCase();
}

/**
 * Returns a deterministic Tailwind color pair for a market icon avatar.
 * @param name - Market name used to hash into the palette.
 * @returns Tailwind class string for background and text color.
 */
export function iconColorClass(name: string): string {
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
export function fmt(val: bigint): string {
  const n = Number(val);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString();
}

/**
 * Formats a raw OI bigint (6-decimal precision) as a dollar string with compact suffix.
 * @param val - Raw OI value in base units (10^6 = $1.00).
 * @returns Formatted string, e.g. "$1.23M" or "$456.00K".
 */
export function formatOi(val: bigint): string {
  const n = Number(val) / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Calculates the current hourly funding rate from OI imbalance (mirrors on-chain logic).
 * @param totalLongOi - Total long open interest (raw u64).
 * @param totalShortOi - Total short open interest (raw u64).
 * @returns Funding rate as a per-hour percentage string, e.g. "+0.05%/hr" or "-0.03%/hr".
 */
export function formatFundingRate(totalLongOi: bigint, totalShortOi: bigint): string {
  const total = totalLongOi + totalShortOi;
  if (total === 0n) return "0.00%/hr";
  const imbalance = totalLongOi > totalShortOi
    ? totalLongOi - totalShortOi
    : totalShortOi - totalLongOi;
  const MAX_FUNDING_RATE = 1_000n;
  const FUNDING_RATE_BASE = 1_000_000n;
  const rate = (imbalance * MAX_FUNDING_RATE) / total;
  const pct = Number(rate) / Number(FUNDING_RATE_BASE) * 100;
  const sign = totalLongOi >= totalShortOi ? "+" : "-";
  return `${sign}${pct.toFixed(4)}%/hr`;
}
