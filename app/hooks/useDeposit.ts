import { type Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getDepositCollateralInstructionDataEncoder } from "../generated/perps/instructions/depositCollateral";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS, USDC_MINT_ADDRESS } from "../lib/constants";
import { deriveUserCollateralPda } from "../lib/pdas";
import { useUserAccountPda } from "./usePdas";

/**
 * Hook to deposit collateral into the user's perps account.
 * Invalidates collateral and token balance queries on success.
 *
 * @returns deposit - Function to deposit collateral.
 * @returns isLoading - True while deposit transaction is processing.
 * @returns error - Error object if deposit failed, null otherwise.
 */
export function useDeposit() {
  const { send } = useSendTransaction();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { wallet } = useWalletConnection();

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);

  /**
   * Sends a deposit collateral instruction.
   *
   * @param amount - Amount in base units (USDC with 6 decimals).
   * @param userTokenAccount - User's associated token account address.
   * @returns Transaction signature string, or null on failure.
   */
  const deposit = useCallback(
    async (amount: number, userTokenAccount: Address) => {
      if (!walletAddress || !wallet || !userAccountAddress) {
        console.error("❌ Deposit Error: No wallet connected");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Derive per-user collateral token account PDA
        const userCollateralAddress = await deriveUserCollateralPda(walletAddress);

        // Manually construct instruction with all required accounts
        // This matches the Rust program's DepositCollateral struct
        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddress, role: 3 },                // user (WritableSigner)
            { address: userAccountAddress, role: 1 },           // userAccount (Writable, PDA with init_if_needed)
            { address: userTokenAccount, role: 1 },             // userTokenAccount (Writable)
            { address: userCollateralAddress, role: 1 },        // userCollateralTokenAccount (Writable, PDA with init_if_needed)
            { address: USDC_MINT_ADDRESS, role: 0 },            // usdcMint (Readonly)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 },        // tokenProgram (Readonly)
            { address: SYSTEM_PROGRAM_ADDRESS, role: 0 },       // systemProgram (Readonly, needed for init_if_needed)
          ],
          data: getDepositCollateralInstructionDataEncoder().encode({
            amount: BigInt(Math.floor(amount)),
          }),
        };

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true },
        );

        // Invalidate related queries so UI updates everywhere
        await queryClient.invalidateQueries({ queryKey: ["collateral"] });
        await queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });

        return signature;
      } catch (err) {
        console.error("❌ Deposit failed with error:", err);
        setError(err instanceof Error ? err : new Error("Deposit failed"));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [send, walletAddress, wallet, userAccountAddress, queryClient]
  );

  return {
    deposit,
    isLoading,
    error,
  };
}
