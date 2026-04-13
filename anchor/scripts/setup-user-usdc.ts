/**
 * Setup USDC for user wallet
 *
 * This script:
 * 1. Creates the user's Associated Token Account (ATA) for USDC
 * 2. Mints USDC tokens to the user's wallet for testing
 *
 * @usage npm run setup-usdc
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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
 * Load USDC mint keypair
 */
function loadUsdcMint(): Keypair {
  const possiblePaths = [
    join(__dirname, "../../usdc-mint.json"),
    "./usdc-mint.json",
  ];

  const usdcMintPath = possiblePaths.find((path) => fs.existsSync(path));

  if (!usdcMintPath) {
    throw new Error("usdc-mint.json not found in project root");
  }

  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(usdcMintPath, "utf-8")))
  );
}

/**
 * Main setup function
 */
async function main() {
  console.log("💰 Setting up USDC for user wallet...\n");

  // Setup connection
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";
  const connection = new Connection(rpcUrl, "confirmed");

  // Load wallet and USDC mint
  const wallet = loadDefaultWallet();
  const usdcMintKeypair = loadUsdcMint();
  const usdcMint = usdcMintKeypair.publicKey;

  console.log("Wallet:", wallet.publicKey.toString());
  console.log("USDC Mint:", usdcMint.toString());
  console.log("RPC URL:", rpcUrl);

  // Get the Associated Token Address for the user's wallet
  const userAta = await getAssociatedTokenAddress(
    usdcMint,
    wallet.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("\nUser's ATA:", userAta.toString());

  // Check if ATA already exists
  const ataInfo = await connection.getAccountInfo(userAta);

  if (ataInfo) {
    console.log("✅ Associated Token Account already exists");

    // Check current balance
    const balance = await connection.getTokenAccountBalance(userAta);
    console.log("Current USDC balance:", balance.value.uiAmount, "USDC");

    // Ask if user wants to mint more
    const mintAmount = 1000 * 1_000_000; // 1000 USDC (6 decimals)
    console.log("\nMinting additional", mintAmount / 1_000_000, "USDC...");

    const mintTx = new Transaction().add(
      createMintToInstruction(
        usdcMint,
        userAta,
        wallet.publicKey,
        mintAmount,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const mintSig = await connection.sendTransaction(mintTx, [wallet]);
    await connection.confirmTransaction(mintSig, "confirmed");

    console.log("✅ Minted USDC to your wallet");
    console.log("Transaction signature:", mintSig);

    // Show new balance
    const newBalance = await connection.getTokenAccountBalance(userAta);
    console.log("New USDC balance:", newBalance.value.uiAmount, "USDC");
  } else {
    console.log("Creating Associated Token Account and minting USDC...");

    const mintAmount = 1000 * 1_000_000; // 1000 USDC (6 decimals)

    const transaction = new Transaction()
      .add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey, // payer
          userAta, // ata
          wallet.publicKey, // owner
          usdcMint, // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      .add(
        createMintToInstruction(
          usdcMint,
          userAta,
          wallet.publicKey,
          mintAmount,
          [],
          TOKEN_PROGRAM_ID
        )
      );

    const sig = await connection.sendTransaction(transaction, [wallet]);
    await connection.confirmTransaction(sig, "confirmed");

    console.log("✅ Created ATA and minted", mintAmount / 1_000_000, "USDC");
    console.log("Transaction signature:", sig);

    // Verify balance
    const balance = await connection.getTokenAccountBalance(userAta);
    console.log("USDC balance:", balance.value.uiAmount, "USDC");
  }

  console.log("\n🎉 Setup complete!");
  console.log("\n📝 Summary:");
  console.log("  Wallet:", wallet.publicKey.toString());
  console.log("  USDC ATA:", userAta.toString());
  console.log(
    "  You can now deposit collateral using the deposit-collateral-card"
  );
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
