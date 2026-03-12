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
