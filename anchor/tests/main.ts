import * as anchor from "@anchor-lang/core";
import { createAccount, createMint, mintTo } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { assert, expect } from "chai";
import { Perps } from "../target/types/perps";

describe("Full flow", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  const program = anchor.workspace.Perps as anchor.Program<Perps>;

  const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const MARKET_NAME = "SOL-PERP";
  const INITIAL_PRICE = new anchor.BN(100_000_000); // $100 per SOL
  const DEPOSIT_AMOUNT = new anchor.BN(1000_000_000); // 1000 USDC
  const POSITION_SIZE = new anchor.BN(500_000_000); // 500 USDC position

  let usdcMint: PublicKey;
  let vaultPda: PublicKey;
  let marketsPda: PublicKey;
  let oraclePda: PublicKey;
  let userAccountPda: PublicKey;
  let userTokenAccount: PublicKey;
  let positionPda: PublicKey;

  before(async () => {
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId,
    );
    [marketsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("markets")],
      program.programId,
    );

    [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      program.programId,
    );
    [userAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user"), wallet.publicKey.toBuffer()],
      program.programId,
    );
    [positionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        wallet.publicKey.toBuffer(),
        SOL_MINT.toBuffer(),
      ],
      program.programId,
    );
    usdcMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6, // USDC has 6 decimals);
    );

    userTokenAccount = await createAccount(
      connection,
      wallet.payer,
      usdcMint,
      wallet.publicKey,
    );

    await mintTo(
      connection,
      wallet.payer,
      usdcMint,
      userTokenAccount,
      wallet.publicKey,
      DEPOSIT_AMOUNT.toNumber(),
    );
  });

  it("should initialize the program", async () => {
    const tx = await program.methods
      .initialize()
      .accounts({
        authority: wallet.publicKey,
        usdcMint: usdcMint,
      })
      .rpc();

    console.log("Transaction signature:", tx);
  });

  it("should create a new market and oracle", async () => {
    const tx = await program.methods
      .initializeMarketWithOracle(SOL_MINT, MARKET_NAME, INITIAL_PRICE)
      .accounts({
        authority: wallet.publicKey,
        markets: marketsPda,
        oracle: oraclePda,
      })
      .rpc();

    const marketsAccount = await program.account.markets.fetch(marketsPda);

    assert.equal(marketsAccount.perps.length, 1);
    console.log("Transaction signature:", tx);
  });

  it("should deposit collateral", async () => {
    const tx = await program.methods
      .depositCollateral(DEPOSIT_AMOUNT)
      .accounts({
        vault: vaultPda,
        userTokenAccount: userTokenAccount,
      })
      .rpc();

    const userAccount = await program.account.userAccount.fetch(userAccountPda);

    console.log("User account:", userAccount);

    expect(userAccount.collateral.toString()).to.equal(
      DEPOSIT_AMOUNT.toString(),
    );

    console.log("Transaction signature:", tx);
  });

  it("should open a position", async () => {
    const tx = await program.methods
      .openPosition(SOL_MINT, { long: {} }, POSITION_SIZE)
      .accounts({
        markets: marketsPda,
        oracle: oraclePda,
      })
      .rpc();

    const position = await program.account.position.fetch(positionPda);
    expect(position.positionSize.toString()).to.equal(POSITION_SIZE.toString());

    const markets = await program.account.markets.fetch(marketsPda);
    expect(markets.perps[0].totalLongOi.toString()).to.equal(
      POSITION_SIZE.toString(),
    );

    console.log("Transaction signature:", tx);
  });

  it("should ");
});
