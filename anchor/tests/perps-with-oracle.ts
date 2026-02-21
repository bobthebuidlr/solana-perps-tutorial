import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import { Perps } from "../target/types/perps";
import { assert } from "chai";

/**
 * Basic tests for the Perps program
 * For full flow testing, see full-flow-test.ts
 */
describe("perps-with-oracle", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  const program = anchor.workspace.Perps as Program<Perps>;

  let usdcMint: PublicKey;
  let marketsPda: PublicKey;
  let oraclePda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Create USDC mint for testing
    usdcMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );

    // Derive PDAs
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
  });

  it("should have initialized program accounts", async () => {
    // Check if accounts exist from previous test run
    try {
      const marketsAccount = await program.account.markets.fetch(marketsPda);
      const oracleAccount = await program.account.oracle.fetch(oraclePda);

      console.log("Program already initialized");
      console.log("Markets count:", marketsAccount.perps.length);
      console.log("Oracle prices count:", oracleAccount.prices.length);

      assert.isNotNull(marketsAccount);
      assert.isNotNull(oracleAccount);
    } catch (error) {
      // If accounts don't exist, this test suite can't run
      // They should be initialized by full-flow-test.ts first
      throw new Error(
        "Program not initialized. Run full-flow-test.ts first or initialize manually."
      );
    }
  });

  it("should have at least one market with oracle price", async () => {
    const solMint = new PublicKey(
      "So11111111111111111111111111111111111111112"
    );
    const marketName = "SOL-PERP";
    const initialPrice = new BN(100_000_000);

    // Verify market exists (may have been created by full-flow-test.ts)
    const marketsAccount = await program.account.markets.fetch(marketsPda);
    assert.isTrue(
      marketsAccount.perps.length >= 1,
      "Should have at least one market"
    );

    // Find the SOL-PERP market
    const solMarket = marketsAccount.perps.find((m) => m.name === marketName);
    if (solMarket) {
      console.log("SOL-PERP market exists:", solMarket.name);
      assert.equal(solMarket.name, marketName);
    } else {
      console.log("Creating new SOL-PERP market...");
      const tx = await program.methods
        .initializeMarketWithOracle(solMint, marketName, initialPrice)
        .accounts({
          authority: wallet.publicKey,
          markets: marketsPda,
          oracle: oraclePda,
        })
        .rpc();
      console.log("Initialize market transaction signature:", tx);
    }

    // Verify oracle price was set
    const oracleAccount = await program.account.oracle.fetch(oraclePda);
    assert.isTrue(
      oracleAccount.prices.length >= 1,
      "Should have at least one price"
    );
    console.log("Oracle prices count:", oracleAccount.prices.length);
  });
});
