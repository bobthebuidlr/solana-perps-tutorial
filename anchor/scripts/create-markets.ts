/**
 * Market creation script for the Perps Program
 *
 * This script creates perpetual futures markets (SOL-PERP and BTC-PERP) by calling
 * the initializeMarketWithOracle instruction. Markets don't require actual token
 * mints - just unique identifiers for price tracking.
 *
 * @usage npm run create-markets
 */

import * as anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";

import { join } from "path";
import { Perps } from "../target/types/perps";

// Market configuration
const MARKETS_CONFIG = [
  {
    token: new PublicKey("So11111111111111111111111111111111111111112"), // Native SOL mint
    name: "SOL-PERP",
    price: new anchor.BN(100_000_000), // $100 in u64 format (6 decimals)
  },
  {
    token: new PublicKey("BTCNmZvXfaRA1b1j1FVFnLX8sqzVq7BPtLNqvdxJperp"), // Placeholder BTC identifier
    name: "BTC-PERP",
    price: new anchor.BN(70_000_000_000), // $50,000 in u64 format (6 decimals)
  },
];

/**
 * Load the default Solana wallet from the filesystem
 */
function loadDefaultWallet(): Keypair {
  const walletPath =
    process.env.ANCHOR_WALLET || join(homedir(), ".config/solana/id.json");
  const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(walletData));
}

/**
 * Load connection from environment or default to localhost
 */
function loadConnection(): Connection {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";
  return new Connection(rpcUrl, "confirmed");
}

/**
 * Setup Anchor provider - works both in test context and standalone
 */
function setupProvider(): anchor.AnchorProvider {
  try {
    // Try to use Anchor's env provider first (works in anchor test context)
    return anchor.AnchorProvider.env();
  } catch (error) {
    // Fall back to manual setup (works as standalone script)
    console.log("Setting up provider manually (not in anchor test context)");
    const connection = loadConnection();
    const wallet = loadDefaultWallet();
    return new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
      commitment: "confirmed",
    });
  }
}

/**
 * Check if a market with the given name already exists
 * @param program Anchor program instance
 * @param marketsPda Markets PDA address
 * @param marketName Name of the market to check
 * @returns true if market exists, false otherwise
 */
async function checkMarketExists(
  program: anchor.Program<Perps>,
  marketsPda: PublicKey,
  marketName: string
): Promise<boolean> {
  const marketsAccount = await program.account.markets.fetch(marketsPda);
  return marketsAccount.perps.some((market) => market.name === marketName);
}

/**
 * Add a new perpetual market with oracle price
 * @param program Anchor program instance
 * @param wallet Wallet keypair
 * @param marketsPda Markets PDA
 * @param oraclePda Oracle PDA
 * @param token Token mint public key (identifier)
 * @param name Market name
 * @param price Initial price in u64 format
 * @returns Transaction signature
 */
async function addMarket(
  program: anchor.Program<Perps>,
  wallet: anchor.Wallet,
  marketsPda: PublicKey,
  oraclePda: PublicKey,
  token: PublicKey,
  name: string,
  price: anchor.BN
): Promise<string> {
  const tx = await program.methods
    .initializeMarketWithOracle(token, name, price)
    .accounts({
      authority: wallet.publicKey,
      markets: marketsPda,
      oracle: oraclePda,
    })
    .rpc();

  return tx;
}

/**
 * Format price for display (6 decimals)
 * @param price Price in u64 format
 * @returns Formatted price string
 */
function formatPrice(price: anchor.BN): string {
  const priceNum = price.toNumber() / 1_000_000;
  return priceNum.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/**
 * Main market creation function
 */
async function main() {
  console.log("🚀 Creating Perps Markets...\n");

  // Setup Anchor provider and program
  const provider = setupProvider();
  anchor.setProvider(provider);

  // Load the program
  const IDL_PATH = join(__dirname, "../target/idl/perps.json");
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf-8"));
  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(idl, provider) as anchor.Program<Perps>;

  const wallet = provider.wallet as anchor.Wallet;

  console.log("Program ID:", programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());

  // Derive PDAs
  const [marketsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("markets")],
    program.programId
  );

  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle")],
    program.programId
  );

  // Verify program is initialized
  let initialMarketCount: number;
  try {
    const marketsAccount = await program.account.markets.fetch(marketsPda);
    initialMarketCount = marketsAccount.perps.length;
    console.log("\n✓ Program initialized");
    console.log("Current markets:", initialMarketCount);

    // Check for max markets
    if (initialMarketCount >= 10) {
      console.error("\n❌ Maximum markets reached (10/10)");
      console.error("Cannot add more markets");
      return;
    }
  } catch (error) {
    console.error("\n❌ Program not initialized!");
    console.error("Please run: npm run init-program");
    throw error;
  }

  // Process each market
  console.log("\n" + "=".repeat(50));
  let marketsAdded = 0;
  let marketsSkipped = 0;

  for (const marketConfig of MARKETS_CONFIG) {
    console.log(`\nProcessing ${marketConfig.name}...`);

    try {
      // Check if market already exists
      const exists = await checkMarketExists(
        program,
        marketsPda,
        marketConfig.name
      );

      if (exists) {
        console.log(`⚠️  ${marketConfig.name} already exists, skipping...`);
        marketsSkipped++;
        continue;
      }

      // Add the market
      const tx = await addMarket(
        program,
        wallet,
        marketsPda,
        oraclePda,
        marketConfig.token,
        marketConfig.name,
        marketConfig.price
      );

      console.log(`✅ ${marketConfig.name} created!`);
      console.log(`   Token: ${marketConfig.token.toString()}`);
      console.log(`   Price: ${formatPrice(marketConfig.price)}`);
      console.log(`   TX: ${tx}`);
      marketsAdded++;
    } catch (error) {
      console.error(`\n❌ Error creating ${marketConfig.name}:`);

      if (error instanceof Error) {
        console.error(error.message);

        // Provide helpful error messages
        if (error.message.includes("insufficient funds")) {
          console.error(
            "\n💡 Make sure your wallet has enough SOL for rent and transaction fees"
          );
          console.error("   Run: solana airdrop 2");
        } else if (error.message.includes("429")) {
          console.error(
            "\n💡 Rate limited. Try again in a moment or use a different RPC endpoint"
          );
        } else if (error.message.includes("MarketsFull")) {
          console.error("\n💡 Maximum markets limit (10) reached");
        }
      } else {
        console.error(error);
      }

      throw error;
    }
  }

  // Display summary
  console.log("\n" + "=".repeat(50));
  console.log("📊 Summary:");
  console.log(`   Markets added: ${marketsAdded}`);
  console.log(`   Markets skipped: ${marketsSkipped}`);
  console.log(`   Total markets: ${initialMarketCount + marketsAdded}`);

  if (marketsAdded > 0) {
    // Verify final state
    const marketsAccount = await program.account.markets.fetch(marketsPda);
    const oracleAccount = await program.account.oracle.fetch(oraclePda);

    console.log("\n✓ Verification:");
    console.log(`   Markets account: ${marketsAccount.perps.length} markets`);
    console.log(`   Oracle account: ${oracleAccount.prices.length} prices`);

    console.log("\n✅ Market creation complete!");
  } else {
    console.log("\n✅ All markets already exist!");
  }
}

// Run the script
main()
  .then(() => {
    console.log("\n✨ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed");
    console.error(error);
    process.exit(1);
  });
