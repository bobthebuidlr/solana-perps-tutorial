/**
 * Mock Oracle Price Stream for local development.
 *
 * Continuously drives realistic price movements across all markets using
 * Geometric Brownian Motion (GBM). Sends an updateOracle tx every 5 seconds
 * and prints a live console dashboard.
 *
 * @usage npm run mock-oracle
 */

import * as anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Perps } from "../target/types/perps";

// How often to tick (milliseconds)
const INTERVAL_MS = 5_000;

// dt expressed as a fraction of a year
const DT = INTERVAL_MS / (365.25 * 24 * 3600 * 1000);

// Price decimals used by the program (prices stored as USD * 10^6)
const PRICE_DECIMALS = 1_000_000;

// Markets to simulate — mirrors KNOWN_MARKETS in update-oracle.ts
const MARKETS: Array<{
  symbol: string;
  name: string;
  mint: string;
  /** Annualized volatility (e.g. 0.80 = 80%) */
  vol: number;
  /** Hard price floor in USD to prevent nonsensical values */
  floor: number;
}> = [
  {
    symbol: "SOL",
    name: "SOL-PERP",
    mint: "So11111111111111111111111111111111111111112",
    vol: 8.4,
    floor: 1,
  },
  {
    symbol: "BTC",
    name: "BTC-PERP",
    mint: "BTCNmZvXfaRA1b1j1FVFnLX8sqzVq7BPtLNqvdxJperp",
    vol: 5.6,
    floor: 100,
  },
];

/**
 * Load the default Solana wallet from the filesystem.
 *
 * @returns {Keypair} Loaded keypair
 */
function loadDefaultWallet(): Keypair {
  const walletPath =
    process.env.ANCHOR_WALLET || join(homedir(), ".config/solana/id.json");
  const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(walletData));
}

/**
 * Load the RPC connection from environment or default to localhost.
 *
 * @returns {Connection} Solana connection instance
 */
function loadConnection(): Connection {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";
  return new Connection(rpcUrl, "confirmed");
}

/**
 * Setup Anchor provider — works both in test context and as a standalone script.
 *
 * @returns {anchor.AnchorProvider} Configured provider
 */
function setupProvider(): anchor.AnchorProvider {
  try {
    return anchor.AnchorProvider.env();
  } catch {
    const connection = loadConnection();
    const wallet = loadDefaultWallet();
    return new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
      commitment: "confirmed",
    });
  }
}

/**
 * Generate a standard normal sample via the Box-Muller transform.
 *
 * @returns {number} Sample from N(0, 1)
 */
function sampleNormal(): number {
  // Avoid log(0) by sampling until u1 > 0
  let u1 = 0;
  while (u1 === 0) u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Apply one GBM step to a price.
 *
 * Formula: price * exp(vol * sqrt(dt) * Z)
 * drift = 0 so there is no systematic up/down trend.
 *
 * @param {number} currentPrice - Current price in USD
 * @param {number} vol - Annualized volatility (e.g. 0.80)
 * @param {number} dt - Time step as fraction of a year
 * @returns {number} New price in USD after applying the GBM step
 */
function gbmStep(currentPrice: number, vol: number, dt: number): number {
  const z = sampleNormal();
  return currentPrice * Math.exp(vol * Math.sqrt(dt) * z);
}

/**
 * Format a USD price for dashboard display (commas, 2 decimal places).
 *
 * @param {number} price - Price in USD
 * @returns {string} Formatted price string (e.g. "$94,210.00")
 */
function formatUsd(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a percentage change for dashboard display.
 *
 * @param {number} pct - Fractional change (e.g. 0.00021)
 * @returns {string} Formatted string with sign (e.g. "+0.021%")
 */
function formatPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${(pct * 100).toFixed(3)}%`;
}

/**
 * Return current HH:MM:SS timestamp string.
 *
 * @returns {string} Timestamp in HH:MM:SS format
 */
function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Main streaming loop — initialises prices from chain then ticks every INTERVAL_MS.
 */
async function main() {
  const provider = setupProvider();
  anchor.setProvider(provider);

  const IDL_PATH = join(__dirname, "../target/idl/perps.json");
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl, provider) as anchor.Program<Perps>;

  // Derive oracle PDA
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle")],
    program.programId
  );

  // --- Seed in-memory prices from on-chain state ---
  const prices: Record<string, number> = {};

  let oracleAccount;
  try {
    oracleAccount = await program.account.oracle.fetch(oraclePda);
  } catch {
    console.error(
      "Oracle account not found. Has the program been initialized?\n  Run: npm run init-program"
    );
    process.exit(1);
  }

  for (const market of MARKETS) {
    const mint = new PublicKey(market.mint);
    const entry = oracleAccount.prices.find((p) => p.tokenMint.equals(mint));

    if (entry && entry.price.toNumber() > 0) {
      prices[market.symbol] = entry.price.toNumber() / PRICE_DECIMALS;
      console.log(
        `Seeded ${market.symbol} from chain: ${formatUsd(
          prices[market.symbol]
        )}`
      );
    } else {
      // Sensible fallback if the market has no price set yet
      const fallback = market.symbol === "BTC" ? 95_000 : 150;
      prices[market.symbol] = fallback;
      console.log(
        `No on-chain price for ${market.symbol}, using fallback: ${formatUsd(
          fallback
        )}`
      );
    }
  }

  console.log("\nStarting mock oracle stream. Press Ctrl+C to stop.\n");

  // --- Clean exit on SIGINT ---
  let running = true;
  process.on("SIGINT", () => {
    running = false;
    console.log("\nStopping mock oracle stream...");
    process.exit(0);
  });

  let tick = 0;

  while (running) {
    tick++;

    // Collect previous prices before this tick so we can compute % changes
    const prevPrices: Record<string, number> = { ...prices };

    // Apply GBM step to each market's in-memory price
    for (const market of MARKETS) {
      const newPrice = gbmStep(prices[market.symbol], market.vol, DT);
      prices[market.symbol] = Math.max(newPrice, market.floor);
    }

    // Send updateOracle txs for all markets
    const results: Array<{
      name: string;
      symbol: string;
      price: number;
      prev: number;
      sig: string | null;
      error: string | null;
    }> = [];

    for (const market of MARKETS) {
      const mint = new PublicKey(market.mint);
      const rawPrice = new anchor.BN(
        Math.round(prices[market.symbol] * PRICE_DECIMALS)
      );

      let sig: string | null = null;
      let error: string | null = null;

      try {
        sig = await program.methods
          .updateOracle(mint, rawPrice)
          .accounts({ oracle: oraclePda })
          .rpc();
      } catch (err) {
        error = err instanceof Error ? err.message.split("\n")[0] : String(err);
      }

      results.push({
        name: market.name,
        symbol: market.symbol,
        price: prices[market.symbol],
        prev: prevPrices[market.symbol],
        sig,
        error,
      });
    }

    // --- Print dashboard ---
    console.log(`[${timestamp()}] Mock Oracle Stream — tick #${tick}`);
    for (const r of results) {
      const pctChange = (r.price - r.prev) / r.prev;
      const priceStr = formatUsd(r.price).padEnd(14);
      const pctStr = formatPct(pctChange).padEnd(10);
      const txStr = r.sig
        ? `tx: ${r.sig.slice(0, 8)}...`
        : `err: ${r.error?.slice(0, 30)}`;

      console.log(`  ${r.name.padEnd(12)} ${priceStr} ${pctStr} ${txStr}`);
    }
    console.log();

    // Wait until next tick (skip wait on last iteration)
    if (running) {
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }
  }
}

main().catch((error) => {
  console.error("Mock oracle stream failed:");
  console.error(error);
  process.exit(1);
});
