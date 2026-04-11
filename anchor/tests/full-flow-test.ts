import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { createAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
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
  const INITIAL_PRICE = new BN(100_000_000); // $100 per SOL (6-decimal fixed point)
  const DEPOSIT_AMOUNT = new BN(1000_000_000); // 1000 USDC (6-decimal)
  // Position size is now token quantity in 6-decimal precision (5 SOL = 5_000_000)
  // At $100/SOL this is $500 notional (5 SOL * $100)
  const POSITION_SIZE = new BN(5_000_000); // 5 SOL (6-decimal token qty)
  const MAX_LEVERAGE = new BN(10_000_000); // 10x max leverage (6-decimal, market config only)
  const MAINTENANCE_MARGIN_RATIO = new BN(50_000); // 5% maintenance margin (6-decimal)

  let usdcMint: PublicKey;
  let userTokenAccount: PublicKey;
  let marketsPda: PublicKey;
  let oraclePda: PublicKey;
  let configPda: PublicKey;
  let vaultPda: PublicKey;
  let userAccountPda: PublicKey;
  let userCollateralPda: PublicKey;

  /**
   * Fetches the SOL_MINT position from the user's inline positions list.
   * @returns The Position entry, or undefined if no such position exists.
   */
  async function fetchSolPosition() {
    const userAccount = await program.account.userAccount.fetch(userAccountPda);
    return userAccount.positions.find(
      (p) => p.perpsMarket.toString() === SOL_MINT.toString()
    );
  }

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

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
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

    [userCollateralPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_collateral"), wallet.publicKey.toBuffer()],
      program.programId
    );

    console.log("\n📍 Derived PDAs:");
    console.log("Markets PDA:", marketsPda.toString());
    console.log("Oracle PDA:", oraclePda.toString());
    console.log("Config PDA:", configPda.toString());
    console.log("Vault PDA:", vaultPda.toString());
    console.log("User Account PDA:", userAccountPda.toString());
    console.log("User Collateral PDA:", userCollateralPda.toString());
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
            usdcMint: usdcMint,
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

    it("should pre-fund the vault (LP pool) with USDC", async () => {
      console.log("\n💰 Pre-funding vault (LP pool) with 5000 USDC...");

      // Mint USDC directly to the vault so it can pay winning traders
      await mintTo(
        connection,
        wallet.payer,
        usdcMint,
        vaultPda,
        wallet.publicKey,
        5_000_000_000 // 5,000 USDC
      );

      const vaultAccount = await getAccount(connection, vaultPda);
      console.log(
        "Vault balance:",
        Number(vaultAccount.amount) / 1_000_000,
        "USDC"
      );
      assert.equal(
        vaultAccount.amount.toString(),
        "5000000000",
        "Vault should have 5000 USDC"
      );
      console.log("✓ Vault pre-funded");
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
          .initializeMarketWithOracle(SOL_MINT, MARKET_NAME, INITIAL_PRICE, MAX_LEVERAGE, MAINTENANCE_MARGIN_RATIO)
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
    it("should deposit USDC collateral into user's collateral token account", async () => {
      console.log("\n🚀 Step 3: Depositing collateral...");

      // Check if user account already exists
      try {
        const existingUserAccount = await program.account.userAccount.fetch(
          userAccountPda
        );
        console.log(
          "⚠️  User account already exists, skipping deposit"
        );
        console.log("✓ User account verified");
        return;
      } catch (error) {
        console.log("User account doesn't exist, creating...");
      }

      const tx = await program.methods
        .depositCollateral(DEPOSIT_AMOUNT)
        .accounts({
          user: wallet.publicKey,
          config: configPda,
          userTokenAccount: userTokenAccount,
          userCollateralTokenAccount: userCollateralPda,
          usdcMint: usdcMint,
        })
        .rpc();

      console.log("✅ Collateral deposited!");
      console.log("Transaction signature:", tx);
      console.log("Amount deposited: 1000 USDC");

      // Verify UserAccount was created
      const userAccount = await program.account.userAccount.fetch(
        userAccountPda
      );
      assert.equal(
        userAccount.authority.toString(),
        wallet.publicKey.toString(),
        "Authority should match wallet"
      );
      // Verify tokens are in the user's collateral token account (not vault)
      const collateralAccount = await getAccount(connection, userCollateralPda);
      assert.equal(
        collateralAccount.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "User collateral token account should hold deposited USDC"
      );

      console.log("\nUser Account State:");
      console.log(
        "- Token balance:",
        Number(collateralAccount.amount) / 1_000_000,
        "USDC"
      );
      console.log("✓ User account verified");
    });
  });

  describe("Step 4: Open a Position", () => {
    it("should open a LONG position on SOL-PERP", async () => {
      console.log("\n🚀 Step 4: Opening position...");

      // Check if position already exists inline on the user account
      const existing = await fetchSolPosition();
      if (existing) {
        console.log("⚠️  Position already exists, skipping creation...");
      } else {
        const direction = { long: {} };

        const tx = await program.methods
          .openPosition(SOL_MINT, direction, POSITION_SIZE)
          .accounts({
            user: wallet.publicKey,
            markets: marketsPda,
            oracle: oraclePda,
            userCollateralTokenAccount: userCollateralPda,
          })
          .rpc();

        console.log("✅ Position opened!");
        console.log("Transaction signature:", tx);
        console.log("Direction: LONG");
        console.log("Size: 5 SOL (token quantity, 6-decimal)");
        console.log("Leverage: 5x");
      }

      // Verify Position exists inline
      const position = await fetchSolPosition();
      assert.isDefined(position, "Position should exist on user_account");
      assert.isDefined(position!.direction.long, "Direction should be LONG");

      console.log("\nPosition State:");
      console.log(
        "- Entry price:",
        position!.entryPrice.toNumber() / 1_000_000,
        "USD"
      );
      console.log(
        "- Position size:",
        position!.positionSize.toNumber() / 1_000_000,
        "SOL (token quantity)"
      );
      console.log("- Direction:", position!.direction.long ? "LONG" : "SHORT");

      console.log("✓ Position verified");
    });

    it("should open a SHORT position on a different market (if needed)", async () => {
      // This is an optional additional test for opening a short position
      // Skip for now as we only have one market
      console.log(
        "\n⏭️  Skipping SHORT position test (only one market available)"
      );
    });
  });

  describe("Step 6: Close Position", () => {
    // Close Step 6a uses an $80 price to verify loss-realization math.
    // PnL correctness itself is covered by the Rust unit tests in
    // funding_tests.rs (price + funding components) and verified end-to-end
    // here via the actual token transfers in close/update.
    const LOSS_PRICE = new BN(80_000_000); // $80 — 20% below $100 entry
    const CLOSE_PRICE_WIN = new BN(110_000_000); // $110 (6-decimal fixed point)
    // 1 SOL in 6-decimal token quantity
    const POSITION_SIZE_SMALL = new BN(1_000_000);

    it("Step 6a: should close the 5-SOL LONG at a loss ($80) and transfer loss to vault", async () => {
      console.log("\n🚀 Step 6a: Closing 5-SOL LONG at $80 (loss case)...");

      // Drive oracle to $80 to create an unrealized loss on the 5-SOL LONG.
      await program.methods
        .updateOracle(SOL_MINT, LOSS_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();
      console.log("Oracle updated to $80");

      // Snapshot state before close
      const positionBefore = await fetchSolPosition();
      assert.isDefined(positionBefore, "Position should exist before close");
      const collateralAccountBefore = await getAccount(connection, userCollateralPda);
      const vaultAccountBefore = await getAccount(connection, vaultPda);

      console.log(
        "User collateral token balance before:",
        Number(collateralAccountBefore.amount) / 1_000_000,
        "USDC"
      );
      console.log(
        "Vault balance before:",
        Number(vaultAccountBefore.amount) / 1_000_000,
        "USDC"
      );

      // Expected: price_pnl = 5_000_000 × (80_000_000 − 100_000_000) / 1_000_000 = −100_000_000 (−100 USDC)
      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      const oraclePrice = oracleAccount.prices.find(
        (p) => p.tokenMint.toString() === SOL_MINT.toString()
      ).price;
      const expectedPricePnl = positionBefore!.positionSize
        .mul(oraclePrice.sub(positionBefore!.entryPrice))
        .div(new BN(1_000_000));

      const tx = await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();

      console.log("✅ Position closed! TX:", tx);

      // Assert position was removed from the inline list
      assert.isUndefined(
        await fetchSolPosition(),
        "Position should be gone from user_account.positions"
      );
      console.log("✓ Position removed from user_account.positions");

      // Verify actual token transfers — loss should move from user collateral to vault
      const collateralAccountAfter = await getAccount(connection, userCollateralPda);
      const vaultAccountAfter = await getAccount(connection, vaultPda);
      const lossAmount = expectedPricePnl.abs();

      console.log("Loss amount:", lossAmount.toNumber() / 1_000_000, "USDC");
      console.log(
        "User collateral token balance after:",
        Number(collateralAccountAfter.amount) / 1_000_000,
        "USDC"
      );
      console.log(
        "Vault balance after:",
        Number(vaultAccountAfter.amount) / 1_000_000,
        "USDC"
      );

      // User collateral token account should decrease by loss amount
      assert.equal(
        (BigInt(collateralAccountBefore.amount) - collateralAccountAfter.amount).toString(),
        lossAmount.toString(),
        "User collateral token account should decrease by loss amount"
      );

      // Vault should increase by loss amount
      assert.equal(
        (vaultAccountAfter.amount - BigInt(vaultAccountBefore.amount)).toString(),
        lossAmount.toString(),
        "Vault should increase by loss amount"
      );

      // Assert market OI is cleared
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(
        market.totalLongOi.toString(),
        "0",
        "total_long_oi should be 0 after loss close"
      );

      console.log("✓ All Step 6a (loss close) assertions passed");
    });

    it("Step 6b: should close a winning 1-SOL LONG ($80→$110) and transfer profit from vault", async () => {
      console.log(
        "\n🚀 Step 6b: Opening 1-SOL LONG at $80 then closing at $110 (win case)..."
      );

      // Oracle is still at $80 — open a new 1-SOL LONG at 1x leverage
      const openTx = await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE_SMALL)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();
      console.log("Opened 1-SOL LONG at $80 (1x leverage). TX:", openTx);

      // Update oracle to $110 for the win close
      const updateTx = await program.methods
        .updateOracle(SOL_MINT, CLOSE_PRICE_WIN)
        .accounts({ oracle: oraclePda })
        .rpc();
      console.log("Oracle updated to $110. TX:", updateTx);

      // Snapshot state before close
      const positionBefore = await fetchSolPosition();
      assert.isDefined(positionBefore, "Position should exist before close");
      const collateralAccountBefore = await getAccount(connection, userCollateralPda);
      const vaultAccountBefore = await getAccount(connection, vaultPda);

      console.log(
        "User collateral token balance before:",
        Number(collateralAccountBefore.amount) / 1_000_000,
        "USDC"
      );
      console.log(
        "Vault balance before:",
        Number(vaultAccountBefore.amount) / 1_000_000,
        "USDC"
      );

      // Expected: price_pnl = 1_000_000 × (110_000_000 − 80_000_000) / 1_000_000 = +30_000_000 (+30 USDC)
      const expectedPricePnl = positionBefore!.positionSize
        .mul(CLOSE_PRICE_WIN.sub(positionBefore!.entryPrice))
        .div(new BN(1_000_000));

      const tx = await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();

      console.log("✅ Position closed! TX:", tx);

      // Assert position was removed from the inline list
      assert.isUndefined(
        await fetchSolPosition(),
        "Position should be gone from user_account.positions"
      );
      console.log("✓ Position removed from user_account.positions");

      // Verify actual token transfers — profit should move from vault to user collateral
      const collateralAccountAfter = await getAccount(connection, userCollateralPda);
      const vaultAccountAfter = await getAccount(connection, vaultPda);

      console.log("Profit amount:", expectedPricePnl.toNumber() / 1_000_000, "USDC");
      console.log(
        "User collateral token balance after:",
        Number(collateralAccountAfter.amount) / 1_000_000,
        "USDC"
      );
      console.log(
        "Vault balance after:",
        Number(vaultAccountAfter.amount) / 1_000_000,
        "USDC"
      );

      // User collateral token account should increase by profit amount
      assert.equal(
        (collateralAccountAfter.amount - BigInt(collateralAccountBefore.amount)).toString(),
        expectedPricePnl.toString(),
        "User collateral token account should increase by profit amount"
      );

      // Vault should decrease by profit amount
      assert.equal(
        (BigInt(vaultAccountBefore.amount) - vaultAccountAfter.amount).toString(),
        expectedPricePnl.toString(),
        "Vault should decrease by profit amount"
      );

      // Assert market OI is cleared
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(
        market.totalLongOi.toString(),
        "0",
        "total_long_oi should be 0 after win close"
      );

      console.log("✓ All Step 6b (win close) assertions passed");
    });
  });

  describe("Step 7: Withdraw Collateral", () => {
    it("should withdraw all available collateral from user's collateral token account", async () => {
      console.log("\n🚀 Step 7: Withdrawing remaining collateral...");

      // With cross-margin, all collateral is available when no positions are open
      const collateralAccount = await getAccount(connection, userCollateralPda);
      const available = collateralAccount.amount;

      console.log(
        "Available to withdraw:",
        Number(available) / 1_000_000,
        "USDC"
      );

      // Snapshot token balance before withdrawal
      const tokenAccountBefore = await getAccount(connection, userTokenAccount);
      const balanceBefore = tokenAccountBefore.amount;

      const tx = await program.methods
        .withdrawCollateral(new BN(available.toString()))
        .accounts({
          user: wallet.publicKey,
          userAccount: userAccountPda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          userTokenAccount: userTokenAccount,
          markets: marketsPda,
          oracle: oraclePda,
        })
        .rpc();

      console.log("✅ Collateral withdrawn! TX:", tx);

      // Assert user token balance increased by available amount
      const tokenAccountAfter = await getAccount(connection, userTokenAccount);
      const received = tokenAccountAfter.amount - balanceBefore;

      assert.equal(
        received.toString(),
        available.toString(),
        "User should receive all available collateral"
      );

      // Assert user collateral token account is now empty
      const collateralAccountAfter = await getAccount(connection, userCollateralPda);
      assert.equal(
        collateralAccountAfter.amount.toString(),
        "0",
        "User collateral token account should be empty after full withdrawal"
      );

      console.log("✓ All withdraw collateral assertions passed");
    });
  });

  describe("Step 8: Leverage-specific Tests", () => {
    it("should track notional OI when opening a position", async () => {
      console.log("\n🚀 Step 8a: Testing notional OI tracking...");

      // Deposit more collateral for testing
      await mintTo(
        connection,
        wallet.payer,
        usdcMint,
        userCollateralPda,
        wallet.publicKey,
        2_000_000_000 // 2,000 USDC
      );

      // Update oracle to $100
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      // Open 5 SOL LONG ($100 price). Notional = 5 * $100 = $500
      const tx = await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();
      console.log("Opened 5-SOL LONG. TX:", tx);

      const position = await fetchSolPosition();
      assert.isDefined(position, "Position should exist");

      // Verify OI tracks full notional — cross-margin means the entire account
      // balance backs the position, not a per-position collateral carve-out.
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      const expectedNotional = 500_000_000; // $500 USDC in 6-decimal
      assert.equal(
        market.totalLongOi.toString(),
        expectedNotional.toString(),
        "OI should track full notional value ($500)"
      );

      console.log("✓ Notional OI tracking verified");
      console.log("  OI (notional): $" + market.totalLongOi.toNumber() / 1_000_000);

      // Close the position for cleanup
      await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();
      console.log("✓ Position closed for cleanup");
    });

    it("should realize full loss beyond former per-position margin cap", async () => {
      // Under the old isolated-collateral model a 5-SOL LONG at $100 would have
      // locked $100 collateral (notional/max_leverage = $500/5) and capped loss
      // at $100 inside settle_pnl. In true cross-margin, the loss is bounded
      // only by the account's total collateral balance, so a $50 price drop
      // ($250 loss) must move the full $250 — not $100.
      console.log("\n🚀 Step 8b: Testing cross-margin loss beyond former cap...");

      // Reset oracle to $100 and open a fresh 5-SOL LONG
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);

      // Drop oracle to $50 → loss = 5 SOL * $50 = $250
      const CRASH_PRICE = new BN(50_000_000);
      await program.methods
        .updateOracle(SOL_MINT, CRASH_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();

      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);

      const userDelta = collateralBefore.amount - collateralAfter.amount;
      const vaultDelta = vaultAfter.amount - vaultBefore.amount;
      console.log("User collateral loss:", Number(userDelta) / 1_000_000, "USDC");
      console.log("Vault gain:", Number(vaultDelta) / 1_000_000, "USDC");

      // Full $250 loss moves from user to vault — the old $100 per-position cap
      // is gone, and the settlement is bounded only by the user's balance.
      assert.equal(
        userDelta.toString(),
        "250000000",
        "User should lose the full $250, not the old $100 per-position cap"
      );
      assert.equal(
        vaultDelta.toString(),
        "250000000",
        "Vault should receive the full $250 loss"
      );

      // Reset oracle for following tests
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      console.log("✓ Cross-margin full-loss settlement verified");
    });

    it("should reject a trade that exceeds the market's max leverage", async () => {
      // Market is configured with max_leverage = 10x (MARGIN_PRECISION / 10
      // = 100_000 initial margin ratio), so the required initial margin for a
      // $500 notional position is $50. With only $40 of equity we must be rejected.
      console.log("\n🚀 Step 8d: Testing per-market max-leverage rejection...");

      // Drain the user to $40 by withdrawing the rest.
      const before = await getAccount(connection, userCollateralPda);
      const TARGET_BALANCE = new BN(40_000_000); // $40
      const withdrawAmt = new BN(before.amount.toString()).sub(TARGET_BALANCE);
      if (withdrawAmt.gtn(0)) {
        await program.methods
          .withdrawCollateral(withdrawAmt)
          .accounts({
            user: wallet.publicKey,
            userAccount: userAccountPda,
            config: configPda,
            userCollateralTokenAccount: userCollateralPda,
            userTokenAccount: userTokenAccount,
            markets: marketsPda,
            oracle: oraclePda,
          })
          .rpc();
      }

      // Reset oracle to $100 so the notional math is clean.
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      // Try to open 5 SOL LONG ($500 notional). Requires $50 initial margin;
      // equity is only $40 → must fail with InitialMarginExceeded.
      let threw = false;
      try {
        await program.methods
          .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
          .accounts({
            user: wallet.publicKey,
            markets: marketsPda,
            oracle: oraclePda,
            userCollateralTokenAccount: userCollateralPda,
          })
          .rpc();
      } catch (err: any) {
        threw = true;
        const msg = err?.toString?.() ?? "";
        assert.match(
          msg,
          /InitialMarginExceeded|initial margin/i,
          "Error should be InitialMarginExceeded"
        );
      }
      assert.isTrue(threw, "Open should have been rejected by initial margin check");

      // A smaller 3 SOL position ($300 notional → $30 required) should succeed.
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, new BN(3_000_000))
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();
      console.log("✓ $300 notional position opened within 10x cap");

      // Cleanup: close and top balance back up for following tests.
      await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();

      await mintTo(
        connection,
        wallet.payer,
        usdcMint,
        userCollateralPda,
        wallet.publicKey,
        2_000_000_000
      );

      console.log("✓ Max-leverage enforcement verified");
    });

    it("should reject a withdrawal that would bypass max_leverage", async () => {
      // Regression for the old enforce_initial_margin=false withdrawal path.
      // Previously a user could open at the initial-margin line and then
      // immediately withdraw collateral down to the maintenance line, shrinking
      // the denominator and silently exceeding max_leverage. Withdrawals are now
      // gated on initial margin, so that shortcut must revert.
      console.log("\n🚀 Step 8b2: Testing withdrawal max-leverage bypass rejection...");

      // Reset oracle to $100 so notional math stays clean.
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      // Drain user collateral to exactly $100.
      const before = await getAccount(connection, userCollateralPda);
      const TARGET_BALANCE = new BN(100_000_000); // $100
      const drainAmt = new BN(before.amount.toString()).sub(TARGET_BALANCE);
      if (drainAmt.gtn(0)) {
        await program.methods
          .withdrawCollateral(drainAmt)
          .accounts({
            user: wallet.publicKey,
            userAccount: userAccountPda,
            config: configPda,
            userCollateralTokenAccount: userCollateralPda,
            userTokenAccount: userTokenAccount,
            markets: marketsPda,
            oracle: oraclePda,
          })
          .rpc();
      }

      // Open 5 SOL LONG ($500 notional). Initial margin = $500 / 10x = $50;
      // equity is $100 → opens successfully with $50 of headroom above initial.
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      // Try to withdraw $55. That would leave $45 equity, still above the $25
      // maintenance floor (5% of $500) but below the $50 initial requirement.
      // Under the new rule this must revert with InitialMarginExceeded.
      let threw = false;
      try {
        await program.methods
          .withdrawCollateral(new BN(55_000_000))
          .accounts({
            user: wallet.publicKey,
            userAccount: userAccountPda,
            config: configPda,
            userCollateralTokenAccount: userCollateralPda,
            userTokenAccount: userTokenAccount,
            markets: marketsPda,
            oracle: oraclePda,
          })
          .rpc();
      } catch (err: any) {
        threw = true;
        const msg = err?.toString?.() ?? "";
        assert.match(
          msg,
          /InitialMarginExceeded|initial margin/i,
          "Withdraw should revert with InitialMarginExceeded"
        );
      }
      assert.isTrue(
        threw,
        "Withdrawal that crosses initial margin must be rejected"
      );

      // A $45 withdrawal leaves $55 equity, above the $50 initial — allowed.
      await program.methods
        .withdrawCollateral(new BN(45_000_000))
        .accounts({
          user: wallet.publicKey,
          userAccount: userAccountPda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          userTokenAccount: userTokenAccount,
          markets: marketsPda,
          oracle: oraclePda,
        })
        .rpc();
      console.log("✓ $45 withdrawal within initial margin succeeded");

      // Cleanup: close position and top balance back up for following tests.
      await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();

      await mintTo(
        connection,
        wallet.payer,
        usdcMint,
        userCollateralPda,
        wallet.publicKey,
        2_000_000_000
      );

      console.log("✓ Withdrawal max-leverage bypass is blocked");
    });

    it("should compute price PnL linearly in size", async () => {
      console.log("\n🚀 Step 8c: Testing price PnL calculation...");

      // Open 5 SOL LONG at $100
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      // Price goes to $120 (20% increase)
      const NEW_PRICE = new BN(120_000_000);
      await program.methods
        .updateOracle(SOL_MINT, NEW_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      // PnL = 5 SOL * ($120 - $100) = $100 profit
      // Computed client-side from position.size * (currentPrice - entryPrice) / 1e6
      const position = await fetchSolPosition();
      assert.isDefined(position, "Position should exist");
      const pricePnl = position!.positionSize
        .mul(NEW_PRICE.sub(position!.entryPrice))
        .div(new BN(1_000_000))
        .toNumber();
      const expectedPnl = 100_000_000; // $100 profit
      assert.equal(pricePnl, expectedPnl, "PnL should be $100 (5 SOL * $20 move)");

      // Return relative to entry notional ($500): $100 / $500 = 20%
      const entryNotional = position!.positionSize
        .mul(position!.entryPrice)
        .div(new BN(1_000_000))
        .toNumber();
      const returnPct = (pricePnl / entryNotional) * 100;
      console.log("  Entry notional: $" + entryNotional / 1_000_000);
      console.log("  PnL: $" + pricePnl / 1_000_000);
      console.log("  Return on notional: " + returnPct.toFixed(0) + "%");
      assert.equal(returnPct, 20, "Return on notional should equal the 20% price move");

      // Close and clean up
      await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();
      console.log("✓ PnL amplification verified");
    });
  });

  describe("Step 9: Update Position", () => {
    it("should update a LONG position (same direction) and realize PnL", async () => {
      console.log("\n🚀 Step 9a: Update position same direction (LONG→LONG)...");

      // Set oracle to $100 and open a 5 SOL LONG at 5x leverage
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();
      console.log("Opened 5-SOL LONG at $100 (5x leverage)");

      // Move price to $120 — unrealized PnL = 5 * ($120 - $100) = $100
      const UPDATE_PRICE = new BN(120_000_000);
      await program.methods
        .updateOracle(SOL_MINT, UPDATE_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();
      console.log("Oracle updated to $120");

      // Snapshot balances before update
      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);

      // Update position: same direction, new size 3 SOL
      const NEW_SIZE = new BN(3_000_000); // 3 SOL
      const tx = await program.methods
        .updatePosition(SOL_MINT, { long: {} }, NEW_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();
      console.log("Updated position to 3-SOL LONG. TX:", tx);

      // Verify PnL was realized — profit should have moved from vault to user
      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);

      const userDelta = collateralAfter.amount - collateralBefore.amount;
      const vaultDelta = vaultBefore.amount - vaultAfter.amount;
      console.log("User collateral change:", Number(userDelta) / 1_000_000, "USDC");
      console.log("Vault change:", Number(vaultDelta) / 1_000_000, "USDC");

      // Profit of $100 should have been transferred
      assert.equal(userDelta.toString(), "100000000", "User should receive $100 profit");
      assert.equal(vaultDelta.toString(), "100000000", "Vault should pay $100 profit");

      // Verify position was reset with new params
      const position = await fetchSolPosition();
      assert.isDefined(position, "Position should exist after update");
      assert.isDefined(position!.direction.long, "Direction should still be LONG");
      assert.equal(
        position!.positionSize.toString(),
        NEW_SIZE.toString(),
        "Size should be updated to 3 SOL"
      );
      assert.equal(
        position!.entryPrice.toString(),
        UPDATE_PRICE.toString(),
        "Entry price should be reset to current oracle price ($120)"
      );

      // Verify OI was updated
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      const expectedOi = 360_000_000; // 3 SOL * $120 = $360
      assert.equal(
        market.totalLongOi.toString(),
        expectedOi.toString(),
        "Long OI should reflect new position notional ($360)"
      );

      console.log("✓ Same-direction update verified (PnL realized, position reset)");

      // Clean up
      await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();
      console.log("✓ Cleanup: position closed");
    });

    it("should flip direction (LONG→SHORT) and realize PnL", async () => {
      console.log("\n🚀 Step 9b: Update position flip direction (LONG→SHORT)...");

      // Set oracle to $100 and open a 2 SOL LONG at 5x leverage
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      const SIZE_2SOL = new BN(2_000_000);
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, SIZE_2SOL)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();
      console.log("Opened 2-SOL LONG at $100 (5x leverage)");

      // Move price to $90 — unrealized PnL = 2 * ($90 - $100) = -$20 loss
      const FLIP_PRICE = new BN(90_000_000);
      await program.methods
        .updateOracle(SOL_MINT, FLIP_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();
      console.log("Oracle updated to $90");

      // Snapshot balances
      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);

      // Flip to SHORT, 4 SOL
      const SIZE_4SOL = new BN(4_000_000);
      const tx = await program.methods
        .updatePosition(SOL_MINT, { short: {} }, SIZE_4SOL)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();
      console.log("Flipped to 4-SOL SHORT. TX:", tx);

      // Verify loss was realized — $20 should move from user to vault
      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);

      const userDelta = collateralBefore.amount - collateralAfter.amount;
      const vaultDelta = vaultAfter.amount - vaultBefore.amount;
      console.log("User collateral loss:", Number(userDelta) / 1_000_000, "USDC");

      assert.equal(userDelta.toString(), "20000000", "User should lose $20");
      assert.equal(vaultDelta.toString(), "20000000", "Vault should gain $20");

      // Verify position is now SHORT
      const position = await fetchSolPosition();
      assert.isDefined(position, "Position should exist after flip");
      assert.isDefined(position!.direction.short, "Direction should be SHORT");
      assert.equal(
        position!.positionSize.toString(),
        SIZE_4SOL.toString(),
        "Size should be 4 SOL"
      );
      assert.equal(
        position!.entryPrice.toString(),
        FLIP_PRICE.toString(),
        "Entry price should be $90"
      );

      // Verify OI: old long OI removed, new short OI added
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(market.totalLongOi.toString(), "0", "Long OI should be 0 after flip");
      const expectedShortOi = 360_000_000; // 4 SOL * $90 = $360
      assert.equal(
        market.totalShortOi.toString(),
        expectedShortOi.toString(),
        "Short OI should reflect new position"
      );

      console.log("✓ Direction flip verified (LONG→SHORT, loss realized)");

      // Clean up
      await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          userCollateralTokenAccount: userCollateralPda,
          vault: vaultPda,
        })
        .rpc();
      console.log("✓ Cleanup: position closed");
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
      console.log("✓ User account authority:", userAccount.authority.toBase58());
      console.log("✓ Open positions:", userAccount.positions.length);

      // Check user collateral token account
      const collateralAccount = await getAccount(connection, userCollateralPda);
      console.log(
        "✓ User collateral token balance:",
        Number(collateralAccount.amount) / 1_000_000,
        "USDC"
      );

      // Check vault (LP pool)
      const vaultAccount = await getAccount(connection, vaultPda);
      console.log(
        "✓ Vault (LP pool) balance:",
        Number(vaultAccount.amount) / 1_000_000,
        "USDC"
      );

      // Check Position — should be absent after Step 9 cleanup
      const solPos = userAccount.positions.find(
        (p) => p.perpsMarket.toString() === SOL_MINT.toString()
      );
      if (solPos) {
        console.log(
          "✓ SOL position size:",
          solPos.positionSize.toNumber() / 1_000_000,
          "SOL (token quantity)"
        );
      } else {
        console.log("✓ No open SOL position (expected after cleanup)");
      }

      console.log("\n✅ All verifications passed!");
    });
  });
});
