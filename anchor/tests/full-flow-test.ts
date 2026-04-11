import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { createAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { assert } from "chai";
import { Perps } from "../target/types/perps";

/** End-to-end flow: init, market creation, collateral, positions, funding, liquidation. */
describe("Full Flow Test", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  const program = anchor.workspace.Perps as Program<Perps>;

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
    usdcMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6 // USDC has 6 decimals
    );

    userTokenAccount = await createAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey
    );

    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      userTokenAccount,
      wallet.publicKey,
      10_000_000_000 // 10,000 USDC
    );

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
  });

  describe("Initialize the program", () => {
    it("creates Markets, Oracle and Vault PDAs", async () => {
      await program.methods
        .initialize()
        .accounts({
          authority: wallet.publicKey,
          usdcMint: usdcMint,
        })
        .rpc();

      const marketsAccount = await program.account.markets.fetch(marketsPda);
      assert.equal(marketsAccount.perps.length, 0, "Markets should start with 0 markets");

      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      assert.equal(oracleAccount.prices.length, 0, "Oracle should start with 0 prices");

      const vaultInfo = await connection.getAccountInfo(vaultPda);
      assert.isNotNull(vaultInfo, "Vault account should exist");
    });

    it("pre-funds the vault (LP pool) with 5000 USDC", async () => {
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
      assert.equal(
        vaultAccount.amount.toString(),
        "5000000000",
        "Vault should have 5000 USDC"
      );
    });
  });

  describe("Create a SOL perpetual market", () => {
    it("creates a SOL-PERP market with initial price", async () => {
      await program.methods
        .initializeMarketWithOracle(
          SOL_MINT,
          MARKET_NAME,
          INITIAL_PRICE,
          MAX_LEVERAGE,
          MAINTENANCE_MARGIN_RATIO
        )
        .accounts({
          authority: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
        })
        .rpc();

      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find((m) => m.name === MARKET_NAME);
      assert.isDefined(market, "SOL-PERP market should exist");
      assert.equal(
        market.tokenMint.toString(),
        SOL_MINT.toString(),
        "Market token should be SOL"
      );

      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      const price = oracleAccount.prices.find(
        (p) => p.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.isDefined(price, "Oracle price for SOL should exist");
    });
  });

  describe("Deposit collateral", () => {
    it("deposits USDC into the user's collateral token account", async () => {
      await program.methods
        .depositCollateral(DEPOSIT_AMOUNT)
        .accounts({
          user: wallet.publicKey,
          config: configPda,
          userTokenAccount: userTokenAccount,
          userCollateralTokenAccount: userCollateralPda,
          usdcMint: usdcMint,
        })
        .rpc();

      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(
        userAccount.authority.toString(),
        wallet.publicKey.toString(),
        "Authority should match wallet"
      );

      // Tokens land in the user's collateral token account, not the vault
      const collateralAccount = await getAccount(connection, userCollateralPda);
      assert.equal(
        collateralAccount.amount.toString(),
        DEPOSIT_AMOUNT.toString(),
        "User collateral token account should hold deposited USDC"
      );
    });
  });

  describe("Open a position", () => {
    it("opens a 5-SOL LONG on SOL-PERP", async () => {
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      const position = await fetchSolPosition();
      assert.isDefined(position, "Position should exist on user_account");
      assert.isDefined(position!.direction.long, "Direction should be LONG");
    });
  });

  describe("Close position", () => {
    // Close Step 6a uses an $80 price to verify loss-realization math.
    // PnL correctness itself is covered by the Rust unit tests in
    // funding_tests.rs (price + funding components) and verified end-to-end
    // here via the actual token transfers in close/update.
    const LOSS_PRICE = new BN(80_000_000); // $80 — 20% below $100 entry
    const CLOSE_PRICE_WIN = new BN(110_000_000); // $110 (6-decimal fixed point)
    // 1 SOL in 6-decimal token quantity
    const POSITION_SIZE_SMALL = new BN(1_000_000);

    it("closes the 5-SOL LONG at a loss ($80) and moves the loss to the vault", async () => {
      // Drive oracle to $80 to create an unrealized loss on the 5-SOL LONG.
      await program.methods
        .updateOracle(SOL_MINT, LOSS_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      const positionBefore = await fetchSolPosition();
      assert.isDefined(positionBefore, "Position should exist before close");
      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);

      // Expected: price_pnl = 5_000_000 × (80_000_000 − 100_000_000) / 1_000_000 = −100_000_000 (−100 USDC)
      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      const oraclePrice = oracleAccount.prices.find(
        (p) => p.tokenMint.toString() === SOL_MINT.toString()
      ).price;
      const expectedPricePnl = positionBefore!.positionSize
        .mul(oraclePrice.sub(positionBefore!.entryPrice))
        .div(new BN(1_000_000));

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

      assert.isUndefined(
        await fetchSolPosition(),
        "Position should be gone from user_account.positions"
      );

      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);
      const lossAmount = expectedPricePnl.abs();

      assert.equal(
        (BigInt(collateralBefore.amount) - collateralAfter.amount).toString(),
        lossAmount.toString(),
        "User collateral token account should decrease by loss amount"
      );
      assert.equal(
        (vaultAfter.amount - BigInt(vaultBefore.amount)).toString(),
        lossAmount.toString(),
        "Vault should increase by loss amount"
      );

      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(
        market.totalLongOi.toString(),
        "0",
        "total_long_oi should be 0 after loss close"
      );
    });

    it("closes a winning 1-SOL LONG ($80 → $110) and moves profit from the vault", async () => {
      // Oracle is still at $80 — open a new 1-SOL LONG at 1x leverage
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE_SMALL)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      // Update oracle to $110 for the win close
      await program.methods
        .updateOracle(SOL_MINT, CLOSE_PRICE_WIN)
        .accounts({ oracle: oraclePda })
        .rpc();

      const positionBefore = await fetchSolPosition();
      assert.isDefined(positionBefore, "Position should exist before close");
      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);

      // Expected: price_pnl = 1_000_000 × (110_000_000 − 80_000_000) / 1_000_000 = +30_000_000 (+30 USDC)
      const expectedPricePnl = positionBefore!.positionSize
        .mul(CLOSE_PRICE_WIN.sub(positionBefore!.entryPrice))
        .div(new BN(1_000_000));

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

      assert.isUndefined(
        await fetchSolPosition(),
        "Position should be gone from user_account.positions"
      );

      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);

      assert.equal(
        (collateralAfter.amount - BigInt(collateralBefore.amount)).toString(),
        expectedPricePnl.toString(),
        "User collateral token account should increase by profit amount"
      );
      assert.equal(
        (BigInt(vaultBefore.amount) - vaultAfter.amount).toString(),
        expectedPricePnl.toString(),
        "Vault should decrease by profit amount"
      );

      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(
        market.totalLongOi.toString(),
        "0",
        "total_long_oi should be 0 after win close"
      );
    });
  });

  describe("Withdraw collateral", () => {
    it("withdraws all available collateral", async () => {
      // With cross-margin, all collateral is available when no positions are open
      const collateralAccount = await getAccount(connection, userCollateralPda);
      const available = collateralAccount.amount;

      const tokenAccountBefore = await getAccount(connection, userTokenAccount);
      const balanceBefore = tokenAccountBefore.amount;

      await program.methods
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

      const tokenAccountAfter = await getAccount(connection, userTokenAccount);
      const received = tokenAccountAfter.amount - balanceBefore;

      assert.equal(
        received.toString(),
        available.toString(),
        "User should receive all available collateral"
      );

      const collateralAfter = await getAccount(connection, userCollateralPda);
      assert.equal(
        collateralAfter.amount.toString(),
        "0",
        "User collateral token account should be empty after full withdrawal"
      );
    });
  });

  describe("Leverage-specific tests", () => {
    it("tracks full notional OI when opening a position", async () => {
      // Top up collateral and reset oracle for a clean $500-notional open.
      await mintTo(
        connection,
        wallet.payer,
        usdcMint,
        userCollateralPda,
        wallet.publicKey,
        2_000_000_000 // 2,000 USDC
      );

      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      // Open 5 SOL LONG ($100 price). Notional = 5 * $100 = $500
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

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
    });

    it("realizes the full loss beyond the former per-position margin cap", async () => {
      // Under the old isolated-collateral model a 5-SOL LONG at $100 would have
      // locked $100 collateral (notional/max_leverage = $500/5) and capped loss
      // at $100 inside settle_pnl. In true cross-margin, the loss is bounded
      // only by the account's total collateral balance, so a $50 price drop
      // ($250 loss) must move the full $250 — not $100.
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
    });

    it("rejects a trade that exceeds the market's max leverage", async () => {
      // Market is configured with max_leverage = 10x (MARGIN_PRECISION / 10
      // = 100_000 initial margin ratio), so the required initial margin for a
      // $500 notional position is $50. With only $40 of equity we must be rejected.
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
    });

    it("rejects a withdrawal that would bypass max_leverage", async () => {
      // Regression for the old enforce_initial_margin=false withdrawal path.
      // Previously a user could open at the initial-margin line and then
      // immediately withdraw collateral down to the maintenance line, shrinking
      // the denominator and silently exceeding max_leverage. Withdrawals are now
      // gated on initial margin, so that shortcut must revert.
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
      assert.isTrue(threw, "Withdrawal that crosses initial margin must be rejected");

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
    });

    it("computes price PnL linearly in size", async () => {
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
      assert.equal(returnPct, 20, "Return on notional should equal the 20% price move");

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
    });
  });

  describe("Update position", () => {
    it("updates a LONG (same direction) and realizes PnL", async () => {
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

      // Move price to $120 — unrealized PnL = 5 * ($120 - $100) = $100
      const UPDATE_PRICE = new BN(120_000_000);
      await program.methods
        .updateOracle(SOL_MINT, UPDATE_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);

      // Update position: same direction, new size 3 SOL
      const NEW_SIZE = new BN(3_000_000); // 3 SOL
      await program.methods
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

      // Verify PnL was realized — profit should have moved from vault to user
      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);

      const userDelta = collateralAfter.amount - collateralBefore.amount;
      const vaultDelta = vaultBefore.amount - vaultAfter.amount;

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
    });

    it("flips direction (LONG → SHORT) and realizes PnL", async () => {
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

      // Move price to $90 — unrealized PnL = 2 * ($90 - $100) = -$20 loss
      const FLIP_PRICE = new BN(90_000_000);
      await program.methods
        .updateOracle(SOL_MINT, FLIP_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);

      // Flip to SHORT, 4 SOL
      const SIZE_4SOL = new BN(4_000_000);
      await program.methods
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

      // Verify loss was realized — $20 should move from user to vault
      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);

      const userDelta = collateralBefore.amount - collateralAfter.amount;
      const vaultDelta = vaultAfter.amount - vaultBefore.amount;

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
    });
  });

  describe("Liquidation", () => {
    let liquidator: anchor.web3.Keypair;
    let liquidatorTokenAccount: PublicKey;

    before(async () => {
      liquidator = anchor.web3.Keypair.generate();

      // Airdrop SOL to liquidator so it can pay tx fees
      const airdropSig = await connection.requestAirdrop(
        liquidator.publicKey,
        1_000_000_000 // 1 SOL
      );
      await connection.confirmTransaction(airdropSig);

      // Create liquidator's USDC ATA — starts empty, receives the liquidation bonus
      liquidatorTokenAccount = await createAccount(
        connection,
        wallet.payer,
        usdcMint,
        liquidator.publicKey
      );
    });

    /**
     * Drains or tops up the user collateral PDA to an exact target balance so
     * liquidation math is deterministic across test runs.
     * @param target Target balance in 6-decimal USDC base units
     */
    async function setUserCollateralTo(target: BN) {
      const curr = await getAccount(connection, userCollateralPda);
      const currBn = new BN(curr.amount.toString());
      if (currBn.gt(target)) {
        const diff = currBn.sub(target);
        await program.methods
          .withdrawCollateral(diff)
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
      } else if (currBn.lt(target)) {
        const diff = target.sub(currBn);
        await mintTo(
          connection,
          wallet.payer,
          usdcMint,
          userCollateralPda,
          wallet.publicKey,
          BigInt(diff.toString())
        );
      }
    }

    it("rejects liquidation when the account is healthy", async () => {
      // Reset oracle to $100 and give user $100 collateral (need to be position-free
      // before withdrawing).
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      await setUserCollateralTo(new BN(100_000_000)); // $100

      // Open a 2 SOL LONG at $100 — notional $200, initial margin $20 (10x max), equity $100 ✓
      await program.methods
        .openPosition(SOL_MINT, { long: {} }, new BN(2_000_000))
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      // Attempt liquidation while healthy — must revert with AccountNotLiquidatable.
      let threw = false;
      try {
        await program.methods
          .liquidate(wallet.publicKey)
          .accounts({
            liquidator: liquidator.publicKey,
            liquidatorTokenAccount,
            markets: marketsPda,
            oracle: oraclePda,
            vault: vaultPda,
          })
          .signers([liquidator])
          .rpc();
      } catch (err: any) {
        threw = true;
        const msg = err?.toString?.() ?? "";
        assert.match(msg, /AccountNotLiquidatable/i, "Error should be AccountNotLiquidatable");
      }
      assert.isTrue(threw, "Liquidation of a healthy account must revert");
    });

    it("liquidates an underwater account and pays the bonus", async () => {
      // Picks up the 2-SOL LONG from the previous test at entry $100 with $100 collateral.
      //
      // Math at oracle = $51:
      //   price_pnl    = 2 * (51 - 100) = -98  → user loss $98
      //   equity       = 100 - 98       = $2
      //   maintenance  = 5% * (2 * 51)  = $5.1
      //   equity ($2) < maintenance ($5.1) → liquidatable ✓ (still solvent)
      //
      //   After settle_pnl: collateral = $100 - $98 = $2
      //   Current notional = 2 * 51     = $102
      //   Bonus target (1%) = $1.02     = 1_020_000 base units
      //   Bonus actual = min($1.02, $2) = $1.02
      //   Collateral after bonus        = $2 - $1.02 = $0.98
      const UNDERWATER_PRICE = new BN(51_000_000);
      await program.methods
        .updateOracle(SOL_MINT, UNDERWATER_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);
      const liquidatorBefore = await getAccount(connection, liquidatorTokenAccount);

      await program.methods
        .liquidate(wallet.publicKey)
        .accounts({
          liquidator: liquidator.publicKey,
          liquidatorTokenAccount,
          userAccount: userAccountPda,
          userCollateralTokenAccount: userCollateralPda,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          vault: vaultPda,
        })
        .signers([liquidator])
        .rpc();

      // Positions must be fully cleared
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(
        userAccount.positions.length,
        0,
        "All positions should be cleared after liquidation"
      );

      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);
      const liquidatorAfter = await getAccount(connection, liquidatorTokenAccount);

      const LOSS = 98_000_000n; // $98 transferred to vault
      const BONUS = 1_020_000n; // $1.02 paid to liquidator

      const userDelta = collateralBefore.amount - collateralAfter.amount;
      const vaultDelta = vaultAfter.amount - vaultBefore.amount;
      const liquidatorDelta = liquidatorAfter.amount - liquidatorBefore.amount;

      assert.equal(
        userDelta.toString(),
        (LOSS + BONUS).toString(),
        "User collateral should drop by loss + bonus"
      );
      assert.equal(
        vaultDelta.toString(),
        LOSS.toString(),
        "Vault should receive the $98 loss"
      );
      assert.equal(
        liquidatorDelta.toString(),
        BONUS.toString(),
        "Liquidator should receive the 1% notional bonus ($1.02)"
      );

      // Market OI for the liquidated position must be fully unwound — the
      // entry notional was $200 long, so total_long_oi should now be 0.
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(
        market.totalLongOi.toString(),
        "0",
        "Long OI should be 0 after liquidation removes the position"
      );
      assert.equal(
        market.totalShortOi.toString(),
        "0",
        "Short OI should still be 0 (only a LONG was open)"
      );
    });

    it("tolerates a bankrupt account (vault absorbs shortfall, no bonus)", async () => {
      // Clean slate: reset oracle, refill collateral, open new 2-SOL LONG at $100.
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      await setUserCollateralTo(new BN(100_000_000)); // $100

      await program.methods
        .openPosition(SOL_MINT, { long: {} }, new BN(2_000_000))
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      // Crash oracle to $30 — theoretical loss = 2 * (30 - 100) = -$140, larger
      // than the $100 collateral, so settle_pnl caps at $100 and the user is
      // wiped out. Bonus target = 1% * (2 * 30) = $0.60 but collateral = $0 after
      // settlement → bonus cap makes it zero.
      const BANKRUPT_PRICE = new BN(30_000_000);
      await program.methods
        .updateOracle(SOL_MINT, BANKRUPT_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);
      const liquidatorBefore = await getAccount(connection, liquidatorTokenAccount);

      await program.methods
        .liquidate(wallet.publicKey)
        .accounts({
          liquidator: liquidator.publicKey,
          liquidatorTokenAccount,
          userAccount: userAccountPda,
          userCollateralTokenAccount: userCollateralPda,
          markets: marketsPda,
          oracle: oraclePda,
          config: configPda,
          vault: vaultPda,
        })
        .signers([liquidator])
        .rpc();

      // Positions cleared
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(userAccount.positions.length, 0, "Positions should be cleared");

      // All of the user's collateral went to the vault, nothing remained for bonus.
      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);
      const liquidatorAfter = await getAccount(connection, liquidatorTokenAccount);

      assert.equal(
        collateralAfter.amount.toString(),
        "0",
        "All user collateral drained by loss settlement"
      );
      assert.equal(
        (vaultAfter.amount - vaultBefore.amount).toString(),
        collateralBefore.amount.toString(),
        "Vault should absorb the capped loss (= pre-liquidation collateral)"
      );
      assert.equal(
        (liquidatorAfter.amount - liquidatorBefore.amount).toString(),
        "0",
        "Liquidator bonus must be zero when no collateral remains"
      );

      // Restore oracle so downstream verification block doesn't see a crash price.
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();
    });

    it("liquidates a SHORT on a timely trigger and pays the full bonus", async () => {
      // Clean slate: oracle back to $100, collateral reset to $100, open a SHORT.
      // Math at oracle = $142 (price moves *against* the short):
      //   price_pnl    = 2 * (100 - 142) = -$84  → short loss $84
      //   equity       = 100 - 84        = $16
      //   current notional = 2 * 142     = $284
      //   maintenance  = 5% * 284        = $14.20
      //   bonus reserve = 1% * 284       = $2.84
      //   trigger threshold = 14.20 + 2.84 = $17.04
      //   equity ($16) < threshold ($17.04) → liquidatable ✓
      //
      // This is a *timely* liquidation — equity ($16) still exceeds the bonus
      // reserve ($2.84), so the full bonus is paid without getting clipped by
      // the collateral cap. This is the happy path the new trigger guarantees.
      //
      //   After settle_pnl: collateral = $100 - $84 = $16
      //   Bonus actual = min($2.84, $16) = $2.84 (full)
      //   User keeps                   $16 - $2.84 = $13.16
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      await setUserCollateralTo(new BN(100_000_000)); // $100

      await program.methods
        .openPosition(SOL_MINT, { short: {} }, new BN(2_000_000))
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      // Confirm short OI was booked
      {
        const m = await program.account.markets.fetch(marketsPda);
        const mk = m.perps.find(
          (p) => p.tokenMint.toString() === SOL_MINT.toString()
        );
        assert.equal(
          mk.totalShortOi.toString(),
          "200000000",
          "Short OI should be $200 after open"
        );
      }

      const UNDERWATER_SHORT_PRICE = new BN(142_000_000);
      await program.methods
        .updateOracle(SOL_MINT, UNDERWATER_SHORT_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();

      const collateralBefore = await getAccount(connection, userCollateralPda);
      const vaultBefore = await getAccount(connection, vaultPda);
      const liquidatorBefore = await getAccount(connection, liquidatorTokenAccount);

      await program.methods
        .liquidate(wallet.publicKey)
        .accounts({
          liquidator: liquidator.publicKey,
          liquidatorTokenAccount,
          markets: marketsPda,
          oracle: oraclePda,
          vault: vaultPda,
        })
        .signers([liquidator])
        .rpc();

      // Positions cleared
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(userAccount.positions.length, 0, "Positions should be cleared");

      const collateralAfter = await getAccount(connection, userCollateralPda);
      const vaultAfter = await getAccount(connection, vaultPda);
      const liquidatorAfter = await getAccount(connection, liquidatorTokenAccount);

      const SHORT_LOSS = 84_000_000n; // $84 to vault
      const SHORT_BONUS = 2_840_000n; // $2.84 full bonus

      const userDelta = collateralBefore.amount - collateralAfter.amount;
      const vaultDelta = vaultAfter.amount - vaultBefore.amount;
      const liquidatorDelta = liquidatorAfter.amount - liquidatorBefore.amount;

      assert.equal(
        userDelta.toString(),
        (SHORT_LOSS + SHORT_BONUS).toString(),
        "User should lose loss + full bonus"
      );
      assert.equal(
        vaultDelta.toString(),
        SHORT_LOSS.toString(),
        "Vault should absorb the $84 short loss"
      );
      assert.equal(
        liquidatorDelta.toString(),
        SHORT_BONUS.toString(),
        "Liquidator should receive the full $2.84 bonus (not clipped)"
      );

      // User should still have $13.16 in collateral — proves the bonus reserve
      // does not drain the account all the way to zero on a timely trigger.
      assert.equal(
        collateralAfter.amount.toString(),
        "13160000",
        "User should retain $13.16 after a timely liquidation"
      );

      // Short OI fully unwound
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const market = marketsAccount.perps.find(
        (m) => m.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(
        market.totalShortOi.toString(),
        "0",
        "Short OI should return to 0 after SHORT liquidation"
      );
      assert.equal(market.totalLongOi.toString(), "0", "Long OI should remain 0");

      // Restore oracle so the next test runs against $100 notional assumptions.
      await program.methods
        .updateOracle(SOL_MINT, INITIAL_PRICE)
        .accounts({ oracle: oraclePda })
        .rpc();
    });

    it("rejects liquidation of an account with no open positions", async () => {
      // After the previous test the user has $13.16 collateral and no positions. The
      // NoPositionsToLiquidate guard must fire before any health math runs —
      // even though an empty account is technically not below maintenance,
      // the empty-position check is separate and comes first.
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(
        userAccount.positions.length,
        0,
        "Precondition: user should have no open positions"
      );

      let threw = false;
      try {
        await program.methods
          .liquidate(wallet.publicKey)
          .accounts({
            liquidator: liquidator.publicKey,
            liquidatorTokenAccount,
            markets: marketsPda,
            oracle: oraclePda,
            vault: vaultPda,
          })
          .signers([liquidator])
          .rpc();
      } catch (err: any) {
        threw = true;
        const msg = err?.toString?.() ?? "";
        assert.match(
          msg,
          /NoPositionsToLiquidate/i,
          "Error should be NoPositionsToLiquidate"
        );
      }
      assert.isTrue(
        threw,
        "Liquidation of an empty account must revert with NoPositionsToLiquidate"
      );
    });

    it("allows a fresh position after the market has been fully liquidated", async () => {
      // Both long and short OI should be zero (asserted above). This
      // test proves the market's OI state was not corrupted by liquidations —
      // a fresh position opens, reflects in OI, and closes cleanly.
      await setUserCollateralTo(new BN(200_000_000)); // $200 for some headroom

      await program.methods
        .openPosition(SOL_MINT, { long: {} }, new BN(1_000_000))
        .accounts({
          user: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
          userCollateralTokenAccount: userCollateralPda,
        })
        .rpc();

      const m = await program.account.markets.fetch(marketsPda);
      const mk = m.perps.find(
        (p) => p.tokenMint.toString() === SOL_MINT.toString()
      );
      assert.equal(
        mk.totalLongOi.toString(),
        "100000000",
        "Long OI should reflect the fresh 1-SOL LONG ($100 notional)"
      );

      // Clean up so the final verification block sees a tidy state.
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
    });
  });

  describe("Verification", () => {
    it("verifies the complete state after all operations", async () => {
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const oracleAccount = await program.account.oracle.fetch(oraclePda);
      const userAccount = await program.account.userAccount.fetch(userAccountPda);
      const collateralAccount = await getAccount(connection, userCollateralPda);
      const vaultAccount = await getAccount(connection, vaultPda);

      console.log("Markets:", marketsAccount.perps.length);
      console.log("Oracle prices:", oracleAccount.prices.length);
      console.log("User authority:", userAccount.authority.toBase58());
      console.log("Open positions:", userAccount.positions.length);
      console.log("User collateral:", Number(collateralAccount.amount) / 1_000_000, "USDC");
      console.log("Vault (LP pool):", Number(vaultAccount.amount) / 1_000_000, "USDC");

      const solPos = userAccount.positions.find(
        (p) => p.perpsMarket.toString() === SOL_MINT.toString()
      );
      assert.isUndefined(solPos, "No open SOL position expected after cleanup");
    });
  });
});
