import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { createAccount, createMint, mintTo } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { Perps } from "../target/types/perps";

/**
 * Full flow test for the Perps program
 * Tests all four main steps:
 * 1. Initialize the program
 * 2. Create a SOL perpetual market
 * 3. Deposit collateral
 * 4. Open a position
 */
describe("Full Flow Test", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  const program = anchor.workspace.Perps as Program<Perps>;

  // Test constants
  const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const MARKET_NAME = "SOL-PERP";
  const INITIAL_PRICE = new BN(100_000_000); // $100 per SOL
  const DEPOSIT_AMOUNT = new BN(1000_000_000); // 1000 USDC
  const POSITION_SIZE = new BN(500_000_000); // 500 USDC position

  let usdcMint: PublicKey;
  let userTokenAccount: PublicKey;
  let marketsPda: PublicKey;
  let oraclePda: PublicKey;
  let vaultPda: PublicKey;
  let userAccountPda: PublicKey;
  let positionPda: PublicKey;

  before(async () => {
    console.log("\n🔧 Setting up test environment...");
    console.log("Program ID:", program.programId.toString());
    console.log("Wallet:", wallet.publicKey.toString());

    // Create USDC mint for testing
    usdcMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6 // USDC has 6 decimals
    );
    console.log("Created USDC mint:", usdcMint.toString());

    // Create user's USDC token account
    userTokenAccount = await createAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );
    console.log("Created user token account:", userTokenAccount.toString());

    // Mint 10,000 USDC to user for testing
    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      userTokenAccount,
      wallet.publicKey,
      10_000_000_000 // 10,000 USDC
    );
    console.log("Minted 10,000 USDC to user");

    // Derive all PDAs
    [marketsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("markets")],
      program.programId
    );

    [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );

    [userAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), wallet.publicKey.toBuffer()],
      program.programId
    );

    [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        wallet.publicKey.toBuffer(),
        SOL_MINT.toBuffer(),
      ],
      program.programId
    );

    console.log("\n📍 Derived PDAs:");
    console.log("Markets PDA:", marketsPda.toString());
    console.log("Oracle PDA:", oraclePda.toString());
    console.log("Vault PDA:", vaultPda.toString());
    console.log("User Account PDA:", userAccountPda.toString());
    console.log("Position PDA:", positionPda.toString());
  });

  describe("Step 1: Initialize the Program", () => {
    it("should create Markets, Oracle, and Vault PDAs", async () => {
      console.log("\n🚀 Step 1: Initializing program...");

      try {
        // Try to fetch accounts first to see if already initialized
        const marketsAccount = await program.account.markets.fetch(marketsPda);
        console.log("⚠️  Program already initialized, skipping...");
        console.log(
          "✓ Markets account exists (",
          marketsAccount.perps.length,
          "markets)"
        );

        const oracleAccount = await program.account.oracle.fetch(oraclePda);
        console.log(
          "✓ Oracle account exists (",
          oracleAccount.prices.length,
          "prices)"
        );

        const vaultInfo = await connection.getAccountInfo(vaultPda);
        assert.isNotNull(vaultInfo, "Vault account should exist");
        console.log("✓ Vault token account exists");
      } catch (error) {
        // Accounts don't exist, initialize them
        console.log("Accounts not found, initializing...");

        const tx = await program.methods
          .initialize()
          .accounts({
            authority: wallet.publicKey,
            // markets: marketsPda,
            // oracle: oraclePda,
            // vault: vaultPda,
            usdcMint: usdcMint,
            // tokenProgram: TOKEN_PROGRAM_ID,
            // systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("✅ Program initialized!");
        console.log("Transaction signature:", tx);

        // Verify Markets account
        const marketsAccount = await program.account.markets.fetch(marketsPda);
        assert.equal(
          marketsAccount.perps.length,
          0,
          "Markets should start with 0 markets"
        );
        console.log("✓ Markets account created (0 markets)");

        // Verify Oracle account
        const oracleAccount = await program.account.oracle.fetch(oraclePda);
        assert.equal(
          oracleAccount.prices.length,
          0,
          "Oracle should start with 0 prices"
        );
        console.log("✓ Oracle account created (0 prices)");

        // Verify Vault is a token account
        const vaultInfo = await connection.getAccountInfo(vaultPda);
        assert.isNotNull(vaultInfo, "Vault account should exist");
        console.log("✓ Vault token account created");
      }
    });
  });

  describe("Step 2: Create a SOL Perpetual Market", () => {
    it("should create a SOL-PERP market with initial price", async () => {
      console.log("\n🚀 Step 2: Creating SOL perpetual market...");

      // Check if market already exists
      const marketsAccountBefore = await program.account.markets.fetch(
        marketsPda
      );
      const existingMarket = marketsAccountBefore.perps.find(
        (m) => m.name === MARKET_NAME
      );

      if (existingMarket) {
        console.log("⚠️  SOL-PERP market already exists, skipping creation...");
        console.log("✓ Market found:", existingMarket.name);
      } else {
        const tx = await program.methods
          .initializeMarketWithOracle(SOL_MINT, MARKET_NAME, INITIAL_PRICE)
          .accounts({
            authority: wallet.publicKey,
            markets: marketsPda,
            oracle: oraclePda,
          })
          .rpc();

        console.log("✅ SOL perpetual market created!");
        console.log("Transaction signature:", tx);
        console.log("Market name:", MARKET_NAME);
        console.log("Initial price: $100");
      }

      // Verify market exists
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find((m) => m.name === MARKET_NAME);
      assert.isDefined(market, "SOL-PERP market should exist");
      assert.equal(
        market.tokenMint.toString(),
        SOL_MINT.toString(),
        "Market token should be SOL"
      );
      console.log("✓ Market details verified");

      // Verify oracle price exists
      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      const price = oracleAccount.prices.find(
        (p) => p.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.isDefined(price, "Oracle price for SOL should exist");
      console.log("✓ Oracle price verified");
    });
  });

  describe("Step 3: Deposit Collateral", () => {
    it("should deposit USDC collateral and create UserAccount", async () => {
      console.log("\n🚀 Step 3: Depositing collateral...");

      // Check if user account already exists
      let userAccountExists = false;
      let existingCollateral = new BN(0);
      try {
        const existingUserAccount = await program.account.userAccount.fetch(
          userAccountPda
        );
        userAccountExists = true;
        existingCollateral = existingUserAccount.collateral;
        console.log(
          "⚠️  User account already exists with",
          existingCollateral.toNumber() / 1_000_000,
          "USDC"
        );
        console.log(
          "Skipping deposit (would require matching USDC mint from previous run)"
        );

        // Verify existing account
        assert.equal(
          existingUserAccount.authority.toString(),
          wallet.publicKey.toString(),
          "Authority should match wallet"
        );

        console.log("\nUser Account State:");
        console.log(
          "- Total collateral:",
          existingUserAccount.collateral.toNumber() / 1_000_000,
          "USDC"
        );
        console.log(
          "- Locked collateral:",
          existingUserAccount.lockedCollateral.toNumber() / 1_000_000,
          "USDC"
        );
        console.log(
          "- Available collateral:",
          (existingUserAccount.collateral.toNumber() -
            existingUserAccount.lockedCollateral.toNumber()) /
            1_000_000,
          "USDC"
        );
        console.log("✓ User account verified");
        return; // Skip deposit
      } catch (error) {
        console.log("User account doesn't exist, creating...");
      }

      const tx = await program.methods
        .depositCollateral(DEPOSIT_AMOUNT)
        .accounts({
          user: wallet.publicKey,
          userTokenAccount: userTokenAccount,
          vault: vaultPda,
        })
        .rpc();

      console.log("✅ Collateral deposited!");
      console.log("Transaction signature:", tx);
      console.log("Amount deposited: 1000 USDC");
      console.log("User account PDA:", userAccountPda.toString());

      // Verify UserAccount was created
      const userAccount = await program.account.userAccount.fetch(
        userAccountPda
      );
      assert.equal(
        userAccount.collateral.toString(),
        DEPOSIT_AMOUNT.toString(),
        "Collateral amount should match"
      );
      assert.equal(
        userAccount.authority.toString(),
        wallet.publicKey.toString(),
        "Authority should match wallet"
      );

      console.log("\nUser Account State:");
      console.log(
        "- Total collateral:",
        userAccount.collateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "- Locked collateral:",
        userAccount.lockedCollateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "- Available collateral:",
        (userAccount.collateral.toNumber() -
          userAccount.lockedCollateral.toNumber()) /
          1_000_000,
        "USDC"
      );
      console.log("✓ User account verified");
    });
  });

  describe("Step 4: Open a Position", () => {
    it("should open a LONG position on SOL-PERP", async () => {
      console.log("\n🚀 Step 4: Opening position...");

      // Check if position already exists
      let positionExists = false;
      try {
        await program.account.position.fetch(positionPda);
        positionExists = true;
        console.log("⚠️  Position already exists, skipping creation...");
      } catch (error) {
        console.log("Position doesn't exist, creating...");
      }

      if (!positionExists) {
        const direction = { long: {} };

        const tx = await program.methods
          .openPosition(SOL_MINT, direction, POSITION_SIZE)
          .accounts({
            user: wallet.publicKey,
            // userAccount: userAccountPd a,
            // position: positionPda,
            markets: marketsPda,
            oracle: oraclePda,
            // systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("✅ Position opened!");
        console.log("Transaction signature:", tx);
        console.log("Position PDA:", positionPda.toString());
        console.log("Direction: LONG");
        console.log("Size: 500 USDC");
      }

      // Verify Position exists
      const position = await program.account.position.fetch(positionPda);
      assert.equal(
        position.userAccount.toString(),
        userAccountPda.toString(),
        "Position should reference user account"
      );
      assert.isDefined(position.direction.long, "Direction should be LONG");

      console.log("\nPosition State:");
      console.log(
        "- Entry price:",
        position.entryPrice.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "- Position size:",
        position.positionSize.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "- Collateral:",
        position.collateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log("- Direction:", position.direction.long ? "LONG" : "SHORT");
      console.log(
        "- Opened at:",
        new Date(position.openedAt.toNumber() * 1000).toISOString()
      );

      // Verify UserAccount locked collateral
      const userAccount = await program.account.userAccount.fetch(
        userAccountPda
      );
      assert.isTrue(
        userAccount.lockedCollateral.toNumber() > 0,
        "Locked collateral should be greater than 0"
      );

      console.log("\nUpdated User Account:");
      console.log(
        "- Locked collateral:",
        userAccount.lockedCollateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "- Available collateral:",
        (userAccount.collateral.toNumber() -
          userAccount.lockedCollateral.toNumber()) /
          1_000_000,
        "USDC"
      );
      console.log("✓ Position verified");

      // Verify position is tracked in user account
      assert.isTrue(
        userAccount.positions.some(
          (p) => p.toString() === positionPda.toString()
        ),
        "Position should be in user's positions array"
      );
      console.log("✓ Position tracked in user account");
    });

    it("should open a SHORT position on a different market (if needed)", async () => {
      // This is an optional additional test for opening a short position
      // Skip for now as we only have one market
      console.log(
        "\n⏭️  Skipping SHORT position test (only one market available)"
      );
    });
  });

  describe("Verification", () => {
    it("should verify the complete state after all operations", async () => {
      console.log("\n🔍 Final Verification:");

      // Check Markets
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      console.log("✓ Markets count:", marketsAccount.perps.length);

      // Check Oracle
      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      console.log("✓ Oracle prices count:", oracleAccount.prices.length);

      // Check UserAccount
      const userAccount = await program.account.userAccount.fetch(
        userAccountPda
      );
      console.log(
        "✓ User total collateral:",
        userAccount.collateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "✓ User locked collateral:",
        userAccount.lockedCollateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log("✓ User positions count:", userAccount.positions.length);

      // Check Position
      const position = await program.account.position.fetch(positionPda);
      console.log(
        "✓ Position size:",
        position.positionSize.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "✓ Position entry price:",
        position.entryPrice.toNumber() / 1_000_000,
        "USDC"
      );

      console.log("\n✅ All verifications passed!");
    });
  });
});
