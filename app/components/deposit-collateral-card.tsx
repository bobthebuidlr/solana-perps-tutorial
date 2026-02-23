"use client";

import { useEffect, useState } from "react";
import { useCollateral } from "../hooks/useCollateral";
import { useDeposit } from "../hooks/useDeposit";
import { useTokenAccount } from "../hooks/useTokenAccount";

import {
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";

// USDC decimals (standard is 6)
const USDC_DECIMALS = 6;

// USDC mint address for localnet (from usdc-mint.json)
// For mainnet, use: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
const USDC_MINT_ADDRESS =
  "3xcGW4uvAGbfiPUieTJLg4fMbL3SposFqRJp5WgTzooL" as Address; // Localnet USDC

// Format bigint amount with decimals
function formatAmount(amount: bigint | null, decimals: number): string {
  if (amount === null) return "0.00";
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0");
  return `${whole}.${fractionStr.slice(0, 2)}`;
}

export function DepositCollateralCard() {
  const { collateral, lockedCollateral, isLoading, error, refresh } =
    useCollateral();
  const {
    deposit,
    isLoading: isDepositing,
    error: depositError,
  } = useDeposit();
  const { wallet } = useWalletConnection();
  const userTokenAccount = useTokenAccount(USDC_MINT_ADDRESS);
  const [amount, setAmount] = useState("");
  const [txSuccess, setTxSuccess] = useState(false);
  const [vaultAddress, setVaultAddress] = useState<Address | null>(null);

  const walletAddress = wallet?.account.address;

  // Derive vault PDA on mount
  useEffect(() => {
    async function deriveVault() {
      try {
        const [vaultPda] = await getProgramDerivedAddress({
          programAddress: PERPS_PROGRAM_ADDRESS,
          seeds: [
            getBytesEncoder().encode(new Uint8Array([118, 97, 117, 108, 116])),
          ], // "vault"
        });
        setVaultAddress(vaultPda);
        console.log("Vault PDA:", vaultPda);
      } catch (err) {
        console.error("Failed to derive vault PDA:", err);
      }
    }
    deriveVault();
  }, []);

  const handleDeposit = async () => {
    if (
      !walletAddress ||
      !amount ||
      parseFloat(amount) <= 0 ||
      !userTokenAccount ||
      !vaultAddress
    ) {
      return;
    }

    try {
      setTxSuccess(false);

      // Convert amount to lamports (USDC has 6 decimals)
      const amountLamports = Math.floor(
        parseFloat(amount) * 10 ** USDC_DECIMALS
      );

      const signature = await deposit(amountLamports, userTokenAccount);

      if (signature) {
        setTxSuccess(true);
        setAmount("");
        // Refresh collateral after successful deposit
        setTimeout(() => refresh(), 1000);
      }
    } catch (err) {
      console.error("Deposit error:", err);
    }
  };

  if (!walletAddress) {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="space-y-1">
          <p className="text-lg font-semibold">Deposit Collateral</p>
          <p className="text-sm text-muted">
            Connect your wallet to deposit collateral.
          </p>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
        <div className="space-y-1">
          <p className="text-lg font-semibold">Deposit Collateral</p>
          <p className="text-sm text-muted">
            Loading your collateral balance...
          </p>
        </div>
        <div className="rounded-lg bg-cream/50 p-4 text-center text-sm text-muted">
          Loading...
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6 shadow-[0_20px_80px_-50px_rgba(0,0,0,0.35)]">
      <div className="space-y-1">
        <p className="text-lg font-semibold">Deposit Collateral</p>
        <p className="text-sm text-muted">
          Manage your USDC collateral for trading perpetual futures.
        </p>
      </div>

      {/* Current Balances */}
      <div className="rounded-xl border border-border-low bg-cream/30 p-4">
        <p className="text-xs uppercase tracking-wide text-muted mb-3">
          Current Balances
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted">Available Collateral</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatAmount(collateral, USDC_DECIMALS)}
              <span className="text-sm font-normal text-muted ml-1">USDC</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Locked Collateral</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {formatAmount(lockedCollateral, USDC_DECIMALS)}
              <span className="text-sm font-normal text-muted ml-1">USDC</span>
            </p>
          </div>
        </div>
      </div>

      {/* Deposit Form */}
      <div className="rounded-xl border border-border-low bg-card p-4 space-y-4">
        <div>
          <label
            htmlFor="amount"
            className="text-xs uppercase tracking-wide text-muted block mb-2"
          >
            Deposit Amount (USDC)
          </label>
          <input
            id="amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            disabled={isDepositing}
            className="w-full rounded-lg border border-border-low bg-cream/30 px-4 py-3 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
          />
        </div>

        <button
          onClick={handleDeposit}
          disabled={
            isDepositing ||
            !amount ||
            parseFloat(amount) <= 0 ||
            !userTokenAccount ||
            !vaultAddress
          }
          className="w-full rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDepositing
            ? "Depositing..."
            : !userTokenAccount || !vaultAddress
              ? "Loading accounts..."
              : "Deposit Collateral"}
        </button>
      </div>

      {/* Success Message */}
      {txSuccess && (
        <div className="rounded-lg border border-green-500/20 bg-green-50/50 p-4 text-sm text-green-600">
          Deposit successful! Your collateral has been updated.
        </div>
      )}

      {/* Error Messages */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-50/50 p-4 text-sm">
          <p className="text-red-600 mb-2">
            Error loading collateral: {error.message}
          </p>
          <button
            onClick={refresh}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            Retry
          </button>
        </div>
      )}

      {depositError && (
        <div className="rounded-lg border border-red-500/20 bg-red-50/50 p-4 text-sm text-red-600">
          Deposit failed: {depositError.message}
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={refresh}
        className="w-full rounded-lg border border-border-low bg-card px-4 py-2.5 text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-sm"
      >
        Refresh Balance
      </button>
    </section>
  );
}
