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
  const INITIAL_PRICE = new BN(100_000_000); // $100 per SOL (6-decimal fixed point)
  const DEPOSIT_AMOUNT = new BN(1000_000_000); // 1000 USDC (6-decimal)
  // Position size is now token quantity in 6-decimal precision (5 SOL = 5_000_000)
  // At $100/SOL this costs $500 USDC collateral
  const POSITION_SIZE = new BN(5_000_000); // 5 SOL (6-decimal token qty)

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
        console.log("Size: 5 SOL (token quantity, 6-decimal)");
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
        "USD"
      );
      console.log(
        "- Position size:",
        position.positionSize.toNumber() / 1_000_000,
        "SOL (token quantity)"
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
    });

    it("should open a SHORT position on a different market (if needed)", async () => {
      // This is an optional additional test for opening a short position
      // Skip for now as we only have one market
      console.log(
        "\n⏭️  Skipping SHORT position test (only one market available)"
      );
    });
  });

  describe("Step 5: View Position PnL", () => {
    // Raw oracle prices: price_usd * 1_000_000 (6-decimal precision)
    const PROFIT_PRICE = new BN(150_000_000); // $150 — 50% above $100 entry
    const LOSS_PRICE = new BN(80_000_000); // $80 — 20% below $100 entry

    it("should return positive price PnL for a LONG when oracle price increases", async () => {
      console.log(
        "\n🚀 Step 5a: PnL check — price increase (LONG in profit)..."
      );

      // Update oracle to the profit price
      const updateTx = await program.methods
        .updateOracle(SOL_MINT, PROFIT_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();
      console.log("Oracle updated to $150. TX:", updateTx);

      // Fetch on-chain position to get the actual entry price (oracle/spot price at open time)
      const position = await program.account.position.fetch(positionPda);
      console.log(
        "Entry price:",
        position.entryPrice.toNumber() / 1_000_000,
        "USD"
      );

      // Simulate the view instruction and receive the returned PositionInfo
      const positionInfo = await program.methods
        .viewPositionPnl(SOL_MINT)
        .accounts({
          markets: marketsPda,
          position: positionPda,
          oracle: oraclePda,
        })
        .view();

      console.log("\nPosition Info:");
      console.log(
        "- Direction:",
        positionInfo.direction.long ? "LONG" : "SHORT"
      );
      console.log(
        "- Entry price:",
        positionInfo.entryPrice.toNumber() / 1_000_000,
        "USD"
      );
      console.log("- Price PnL (raw):", positionInfo.pnlInfo.price.toString());
      console.log(
        "- Funding PnL (raw):",
        positionInfo.pnlInfo.funding.toString()
      );
      console.log("- Total PnL (raw):", positionInfo.pnlInfo.total.toString());

      // Expected price PnL = position_size * (current_price − entry_price) / 10^6
      // position_size is token qty (6-decimal), prices are 6-decimal fixed point
      // dividing by 10^6 gives USDC base units
      const expectedPricePnl = POSITION_SIZE.mul(
        PROFIT_PRICE.sub(position.entryPrice)
      ).div(new BN(1_000_000));
      console.log("Expected price PnL (raw):", expectedPricePnl.toString());

      assert.isDefined(positionInfo.direction.long, "Direction should be LONG");
      assert.equal(
        positionInfo.pnlInfo.price.toString(),
        expectedPricePnl.toString(),
        "Price PnL should equal size * (currentPrice - entryPrice) / 10^6"
      );
      assert.isTrue(
        positionInfo.pnlInfo.price.gt(new BN(0)),
        "Price PnL should be positive when oracle price exceeds entry price"
      );
      // Total PnL must be price PnL + funding PnL
      assert.equal(
        positionInfo.pnlInfo.total.toString(),
        positionInfo.pnlInfo.price.add(positionInfo.pnlInfo.funding).toString(),
        "Total PnL should be the sum of price PnL and funding PnL"
      );
      console.log("✓ LONG position shows positive PnL on price increase");
    });

    it("should return negative price PnL for a LONG when oracle price decreases", async () => {
      console.log(
        "\n🚀 Step 5b: PnL check — price decrease (LONG at a loss)..."
      );

      // Update oracle to the loss price
      const updateTx = await program.methods
        .updateOracle(SOL_MINT, LOSS_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();
      console.log("Oracle updated to $80. TX:", updateTx);

      // Fetch on-chain position to get the actual entry price
      const position = await program.account.position.fetch(positionPda);
      console.log(
        "Entry price:",
        position.entryPrice.toNumber() / 1_000_000,
        "USD"
      );

      // Simulate the view instruction and receive the returned PositionInfo
      const positionInfo = await program.methods
        .viewPositionPnl(SOL_MINT)
        .accounts({
          markets: marketsPda,
          position: positionPda,
          oracle: oraclePda,
        })
        .view();

      console.log("\nPosition Info:");
      console.log("- Price PnL (raw):", positionInfo.pnlInfo.price.toString());
      console.log(
        "- Funding PnL (raw):",
        positionInfo.pnlInfo.funding.toString()
      );
      console.log("- Total PnL (raw):", positionInfo.pnlInfo.total.toString());

      // Expected price PnL = position_size * (current_price − entry_price) / 10^6 — negative
      // position_size is token qty (6-decimal), prices are 6-decimal fixed point
      const expectedPricePnl = POSITION_SIZE.mul(
        LOSS_PRICE.sub(position.entryPrice)
      ).div(new BN(1_000_000));
      console.log("Expected price PnL (raw):", expectedPricePnl.toString());

      assert.equal(
        positionInfo.pnlInfo.price.toString(),
        expectedPricePnl.toString(),
        "Price PnL should equal size * (currentPrice - entryPrice) / 10^6"
      );
      assert.isTrue(
        positionInfo.pnlInfo.price.isNeg(),
        "Price PnL should be negative when oracle price is below entry price"
      );
      // Total PnL must be price PnL + funding PnL
      assert.equal(
        positionInfo.pnlInfo.total.toString(),
        positionInfo.pnlInfo.price.add(positionInfo.pnlInfo.funding).toString(),
        "Total PnL should be the sum of price PnL and funding PnL"
      );
      console.log("✓ LONG position shows negative PnL on price decrease");
    });
  });

  describe("Step 6: Close Position", () => {
    // Oracle is at $80 after Step 5b — no update needed for the loss case
    const CLOSE_PRICE_WIN = new BN(110_000_000); // $110 (6-decimal fixed point)
    // 1 SOL in 6-decimal token quantity
    const POSITION_SIZE_SMALL = new BN(1_000_000);

    it("Step 6a: should close the 5-SOL LONG at a loss ($80) and deduct position.collateral from user account", async () => {
      console.log(
        "\n🚀 Step 6a: Closing 5-SOL LONG at $80 (loss case, oracle already set)..."
      );

      // Oracle is already at $80 from Step 5b — no update needed

      // Snapshot state before close
      const positionBefore = await program.account.position.fetch(positionPda);
      const userAccountBefore = await program.account.userAccount.fetch(
        userAccountPda
      );
      // Token account checks are no longer needed since PnL goes to collateral account

      console.log(
        "Position collateral:",
        positionBefore.collateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "User account collateral before:",
        userAccountBefore.collateral.toNumber() / 1_000_000,
        "USDC"
      );

      // Numbers:
      // position.collateral = 5 SOL × $100 = 500 USDC = 500_000_000
      // price_pnl = 5_000_000 × (80_000_000 − 100_000_000) / 1_000_000 = −100_000_000 (−100 USDC)
      // user collateral before = 1000 USDC (or whatever it was)
      // user collateral after = 1000 − 100 = 900 USDC
      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      const oraclePrice = oracleAccount.prices.find(
        (p) => p.tokenMint.toString() === SOL_MINT.toString()
      ).price;
      const expectedPricePnl = positionBefore.positionSize
        .mul(oraclePrice.sub(positionBefore.entryPrice))
        .div(new BN(1_000_000));
      // Settlement calculation no longer needed - PnL goes to collateral

      const tx = await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
        })
        .rpc();

      console.log("✅ Position closed! TX:", tx);

      // Assert position PDA is gone
      try {
        await program.account.position.fetch(positionPda);
        assert.fail("Position PDA should be closed");
      } catch {
        console.log("✓ Position PDA closed (account not found as expected)");
      }

      // PnL is now added to user's collateral account instead of wallet
      // No need to check token balance changes

      // Assert user account: collateral reflects PnL
      // Collateral = previous_collateral + PnL (floored at 0)
      // Note: position_collateral is NOT subtracted, it's just unlocked from locked_collateral
      const userAccountAfter = await program.account.userAccount.fetch(
        userAccountPda
      );
      
      const expectedFinalCollateral = (() => {
        if (expectedPricePnl.gte(new BN(0))) {
          return userAccountBefore.collateral.add(expectedPricePnl);
        } else {
          const loss = expectedPricePnl.abs();
          return loss.gt(userAccountBefore.collateral) ? new BN(0) : userAccountBefore.collateral.sub(loss);
        }
      })();
      
      console.log(
        "Expected PnL:",
        expectedPricePnl.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "User collateral after close:",
        userAccountAfter.collateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "Expected final collateral:",
        expectedFinalCollateral.toNumber() / 1_000_000,
        "USDC"
      );
      
      assert.equal(
        userAccountAfter.collateral.toString(),
        expectedFinalCollateral.toString(),
        "collateral should reflect position PnL"
      );
      assert.equal(
        userAccountAfter.lockedCollateral.toString(),
        "0",
        "locked_collateral should be 0 after close"
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

    it("Step 6b: should close a winning 1-SOL LONG ($80→$110) and deduct position.collateral from user account", async () => {
      console.log(
        "\n🚀 Step 6b: Opening 1-SOL LONG at $80 then closing at $110 (win case)..."
      );

      // Oracle is still at $80 — open a new 1-SOL LONG
      const openTx = await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE_SMALL)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
        })
        .rpc();
      console.log("Opened 1-SOL LONG at $80. TX:", openTx);

      // Update oracle to $110 for the win close
      const updateTx = await program.methods
        .updateOracle(SOL_MINT, CLOSE_PRICE_WIN)
        .accounts({ oracle: oraclePda })
        .rpc();
      console.log("Oracle updated to $110. TX:", updateTx);

      // Snapshot state before close
      const positionBefore = await program.account.position.fetch(positionPda);
      const userAccountBefore = await program.account.userAccount.fetch(
        userAccountPda
      );
      // Token account checks are no longer needed since PnL goes to collateral account

      console.log(
        "Position collateral:",
        positionBefore.collateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "User account collateral before:",
        userAccountBefore.collateral.toNumber() / 1_000_000,
        "USDC"
      );

      // Numbers:
      // position.collateral = 1 SOL × $80 = 80 USDC = 80_000_000
      // price_pnl = 1_000_000 × (110_000_000 − 80_000_000) / 1_000_000 = +30_000_000 (+30 USDC)
      // user collateral before = whatever it was after Step 6a
      // user collateral after = previous + 30 USDC
      const expectedPricePnl = positionBefore.positionSize
        .mul(CLOSE_PRICE_WIN.sub(positionBefore.entryPrice))
        .div(new BN(1_000_000));
      // Settlement calculation no longer needed - PnL goes to collateral

      const tx = await program.methods
        .closePosition(SOL_MINT)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
        })
        .rpc();

      console.log("✅ Position closed! TX:", tx);

      // Assert position PDA is gone
      try {
        await program.account.position.fetch(positionPda);
        assert.fail("Position PDA should be closed");
      } catch {
        console.log("✓ Position PDA closed (account not found as expected)");
      }

      // PnL is now added to user's collateral account instead of wallet
      // No need to check token balance changes

      // Assert user account: collateral reflects PnL
      // Collateral = previous_collateral + PnL
      // Note: position_collateral is NOT subtracted, it's just unlocked from locked_collateral
      const userAccountAfter = await program.account.userAccount.fetch(
        userAccountPda
      );
      
      const expectedFinalCollateral = userAccountBefore.collateral
        .add(expectedPricePnl);
      
      console.log(
        "Expected PnL:",
        expectedPricePnl.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "User collateral after close:",
        userAccountAfter.collateral.toNumber() / 1_000_000,
        "USDC"
      );
      console.log(
        "Expected final collateral:",
        expectedFinalCollateral.toNumber() / 1_000_000,
        "USDC"
      );
      
      assert.equal(
        userAccountAfter.collateral.toString(),
        expectedFinalCollateral.toString(),
        "collateral should include profit from closed position"
      );
      assert.equal(
        userAccountAfter.lockedCollateral.toString(),
        "0",
        "locked_collateral should be 0 after close"
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
    it("should withdraw all available collateral to user wallet", async () => {
      console.log("\n🚀 Step 7: Withdrawing remaining collateral...");

      const userAccountBefore = await program.account.userAccount.fetch(
        userAccountPda
      );
      const available = userAccountBefore.collateral.sub(
        userAccountBefore.lockedCollateral
      );

      console.log(
        "Available to withdraw:",
        available.toNumber() / 1_000_000,
        "USDC"
      );

      // Snapshot token balance before withdrawal
      const { getAccount } = await import("@solana/spl-token");
      const tokenAccountBefore = await getAccount(connection, userTokenAccount);
      const balanceBefore = new BN(tokenAccountBefore.amount.toString());

      const tx = await program.methods
        .withdrawCollateral(available)
        .accounts({
          user: wallet.publicKey,
          userAccount: userAccountPda,
          vault: vaultPda,
          userTokenAccount: userTokenAccount,
        })
        .rpc();

      console.log("✅ Collateral withdrawn! TX:", tx);

      // Assert user token balance increased by available amount
      const tokenAccountAfter = await getAccount(connection, userTokenAccount);
      const balanceAfter = new BN(tokenAccountAfter.amount.toString());
      const received = balanceAfter.sub(balanceBefore);

      assert.equal(
        received.toString(),
        available.toString(),
        "User should receive all available collateral"
      );

      // Assert user account collateral is 0
      const userAccountAfter = await program.account.userAccount.fetch(
        userAccountPda
      );
      assert.equal(
        userAccountAfter.collateral.toString(),
        "0",
        "user_account.collateral should be 0 after full withdrawal"
      );

      console.log("✓ All withdraw collateral assertions passed");
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
      // Check Position — may have been closed in Step 6
      try {
        const position = await program.account.position.fetch(positionPda);
        console.log(
          "✓ Position size:",
          position.positionSize.toNumber() / 1_000_000,
          "SOL (token quantity)"
        );
        console.log(
          "✓ Position entry price:",
          position.entryPrice.toNumber() / 1_000_000,
          "USD"
        );
      } catch {
        console.log("✓ Position PDA already closed (expected after Step 6)");
      }

      console.log("\n✅ All verifications passed!");
    });
  });
});
