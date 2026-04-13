/**
 * Initialization script for the Perps Program
 *
 * This script initializes the perps program by creating three core PDA accounts:
 * 1. Markets - Stores all perpetual futures markets (empty array initially)
 * 2. Oracle - Holds oracle price data
 * 3. Vault - Acts as the USDC collateral vault
 *
 * @usage npm run init-program
 */

import * as anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Perps } from "../target/types/perps";

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
 * Main initialization function
 */
async function main() {
  console.log("🚀 Initializing Perps Program...\n");

  // Setup Anchor provider and program
  const provider = setupProvider();
  anchor.setProvider(provider);

  // Load the program
  const IDL_PATH = join(__dirname, "../target/idl/perps.json");
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf-8"));
  const programId = new PublicKey(idl.address);
  const program = new anchor.Program(idl, provider) as anchor.Program<Perps>;

  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  console.log("Program ID:", programId.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  console.log("RPC URL:", connection.rpcEndpoint);

  // Load USDC mint keypair
  console.log("\nLoading USDC mint from usdc-mint.json...");
  let usdcMint: PublicKey;

  try {
    // Try project root first, then current directory
    const possiblePaths = [
      join(__dirname, "../../usdc-mint.json"),
      "./usdc-mint.json",
    ];

    const usdcMintPath = possiblePaths.find((path) => fs.existsSync(path));

    if (!usdcMintPath) {
      throw new Error("usdc-mint.json not found in project root");
    }

    const usdcMintKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(usdcMintPath, "utf-8")))
    );
    usdcMint = usdcMintKeypair.publicKey;
    console.log("USDC Mint:", usdcMint.toString());
  } catch (error) {
    console.error("❌ Error loading USDC mint keypair from usdc-mint.json");
    console.error("Make sure the file exists in the project root");
    throw error;
  }

  // Derive PDAs
  console.log("\nDeriving PDAs...");
  const [marketsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("markets")],
    program.programId
  );
  console.log("Markets PDA:", marketsPda.toString());

  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle")],
    program.programId
  );
  console.log("Oracle PDA:", oraclePda.toString());

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  console.log("Vault PDA:", vaultPda.toString());

  // Check if already initialized
  try {
    const marketsAccount = await program.account.markets.fetch(marketsPda);
    console.log("\n⚠️  Program already initialized!");
    console.log(
      "Markets account exists with",
      marketsAccount.perps.length,
      "markets"
    );
    console.log("\n✅ You can now use the useMarkets hook.");
    return;
  } catch (error) {
    // Account doesn't exist, continue with initialization
    console.log("\nProgram not yet initialized, proceeding...");
  }

  // Initialize the program
  try {
    console.log("\nCalling initialize instruction...");
    const tx = await program.methods
      .initialize()
      .accounts({
        authority: wallet.publicKey,
        usdcMint: usdcMint,
      })
      .rpc();

    console.log("✅ Program initialized!");
    console.log("Transaction signature:", tx);

    // Verify accounts were created
    console.log("\nVerifying accounts created...");

    const marketsAccount = await program.account.markets.fetch(marketsPda);
    console.log(
      "✅ Markets account created (" + marketsAccount.perps.length + " markets)"
    );

    const oracleAccount = await program.account.oracle.fetch(oraclePda);
    console.log(
      "✅ Oracle account created (" + oracleAccount.prices.length + " prices)"
    );

    const vaultAccount = await connection.getAccountInfo(vaultPda);
    if (vaultAccount) {
      console.log("✅ Vault account created");
    }

    console.log(
      "\n🎉 Initialization complete! You can now use the useMarkets hook."
    );
    console.log("\nNext steps:");
    console.log(
      "1. Add a market using the initializeMarketWithOracle instruction"
    );
    console.log(
      "2. The useMarkets hook will automatically fetch and display markets"
    );
  } catch (error) {
    console.error("\n❌ Error during initialization:");

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
      }
    } else {
      console.error(error);
    }

    throw error;
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
