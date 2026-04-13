/**
 * Oracle price update script for the Perps Program
 *
 * Updates the oracle price for a specific market by calling the updateOracle
 * instruction. Accepts a market symbol (SOL, BTC) or raw token mint address,
 * and a new price in USD.
 *
 * @usage npm run update-oracle -- <MARKET> <PRICE_USD>
 * @example npm run update-oracle -- SOL 150
 * @example npm run update-oracle -- BTC 95000
 * @example npm run update-oracle -- So11111111111111111111111111111111111111112 142.5
 */

import * as anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Perps } from "../target/types/perps";

// Price decimals used by the program (prices are stored as USD * 10^6)
const PRICE_DECIMALS = 1_000_000;

// Known markets — mirrors the config in create-markets.ts
const KNOWN_MARKETS: Record<string, { mint: string; name: string }> = {
  SOL: {
    mint: "So11111111111111111111111111111111111111112",
    name: "SOL-PERP",
  },
  BTC: {
    mint: "BTCNmZvXfaRA1b1j1FVFnLX8sqzVq7BPtLNqvdxJperp",
    name: "BTC-PERP",
  },
};

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
    console.log("Setting up provider manually (not in anchor test context)");
    const connection = loadConnection();
    const wallet = loadDefaultWallet();
    return new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
      commitment: "confirmed",
    });
  }
}

/**
 * Resolve a market argument (symbol or raw mint address) to a PublicKey.
 *
 * @param {string} arg - Market symbol (e.g. "SOL") or base58 mint address
 * @returns {{ mint: PublicKey; label: string }} Resolved mint and display label
 */
function resolveMarket(arg: string): { mint: PublicKey; label: string } {
  const upper = arg.toUpperCase();

  if (KNOWN_MARKETS[upper]) {
    const { mint, name } = KNOWN_MARKETS[upper];
    return { mint: new PublicKey(mint), label: name };
  }

  // Fall back to treating the arg as a raw base58 address
  try {
    const mint = new PublicKey(arg);
    return { mint, label: arg };
  } catch {
    throw new Error(
      `Unknown market "${arg}". Use SOL, BTC, or a valid base58 mint address.`
    );
  }
}

/**
 * Format a raw u64 price (6 decimals) as a USD string for display.
 *
 * @param {anchor.BN} rawPrice - Price in program u64 format
 * @returns {string} Formatted USD string
 */
function formatPrice(rawPrice: anchor.BN): string {
  const priceNum = rawPrice.toNumber() / PRICE_DECIMALS;
  return priceNum.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

/**
 * Main oracle update function.
 */
async function main() {
  // Parse CLI args: npm run update-oracle -- <MARKET> <PRICE_USD>
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: npm run update-oracle -- <MARKET> <PRICE_USD>");
    console.error("  MARKET    SOL, BTC, or a base58 token mint address");
    console.error("  PRICE_USD New price in USD (e.g. 150 or 142.5)");
    process.exit(1);
  }

  const [marketArg, priceArg] = args;
  const priceUsd = parseFloat(priceArg);

  if (isNaN(priceUsd) || priceUsd <= 0) {
    console.error(`Invalid price "${priceArg}". Must be a positive number.`);
    process.exit(1);
  }

  // Convert USD → raw u64 price (6 decimals)
  const rawPrice = new anchor.BN(Math.round(priceUsd * PRICE_DECIMALS));

  const { mint, label } = resolveMarket(marketArg);

  console.log("🔮 Updating Oracle Price\n");

  // Setup provider and program
  const provider = setupProvider();
  anchor.setProvider(provider);

  const IDL_PATH = join(__dirname, "../target/idl/perps.json");
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl, provider) as anchor.Program<Perps>;

  const wallet = provider.wallet as anchor.Wallet;
  console.log("Wallet:  ", wallet.publicKey.toString());
  console.log("Market:  ", label);
  console.log("Mint:    ", mint.toString());

  // Derive oracle PDA
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle")],
    program.programId
  );

  // Fetch and display current price before the update
  try {
    const oracleAccount = await program.account.oracle.fetch(oraclePda);
    const existing = oracleAccount.prices.find((p) =>
      p.tokenMint.equals(mint)
    );

    if (existing) {
      console.log("Current: ", formatPrice(existing.price));
    } else {
      console.log(
        "Current:  (no entry found — token mint may not have a market yet)"
      );
    }
  } catch {
    console.error(
      "\n❌ Oracle account not found. Has the program been initialized?"
    );
    console.error("   Run: npm run init-program");
    process.exit(1);
  }

  console.log("New:     ", formatPrice(rawPrice));
  console.log();

  // Send the updateOracle instruction
  try {
    const tx = await program.methods
      .updateOracle(mint, rawPrice)
      .accounts({ oracle: oraclePda })
      .rpc();

    console.log("✅ Oracle updated!");
    console.log("   TX:", tx);

    // Verify the on-chain value after the update
    const oracleAccount = await program.account.oracle.fetch(oraclePda);
    const updated = oracleAccount.prices.find((p) => p.tokenMint.equals(mint));

    if (updated) {
      console.log("   Confirmed on-chain:", formatPrice(updated.price));
    }
  } catch (error) {
    console.error("\n❌ Update failed:");
    if (error instanceof Error) {
      console.error(error.message);

      if (error.message.includes("OraclePriceNotFound")) {
        console.error(
          "\n💡 No oracle entry exists for this token mint yet."
        );
        console.error(
          "   Create the market first: npm run create-markets"
        );
      } else if (error.message.includes("insufficient funds")) {
        console.error("\n💡 Wallet needs more SOL. Run: solana airdrop 2");
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n✨ Done");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed");
    console.error(error);
    process.exit(1);
  });
