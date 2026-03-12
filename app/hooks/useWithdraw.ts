import { type Address } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getWithdrawCollateralInstructionDataEncoder } from "../generated/perps/instructions/withdrawCollateral";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "../lib/constants";
import { deriveVaultPda } from "../lib/pdas";
import { useUserAccountPda } from "./usePdas";

/**
 * Custom hook to withdraw collateral from the user's perps account.
 *
 * @returns {Object} Object containing withdraw function, loading state, and error state
 * @returns {(amount: number, userTokenAccount: Address) => Promise<string | null>} withdraw - Function to withdraw collateral
 * @returns {boolean} isLoading - True while withdraw transaction is processing
 * @returns {Error | null} error - Error object if withdraw failed, null otherwise
 */
export function useWithdraw() {
  const { send } = useSendTransaction();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { wallet } = useWalletConnection();

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);

  const withdraw = useCallback(
    async (amount: number, userTokenAccount: Address) => {
      if (!walletAddress || !wallet || !userAccountAddress) {
        console.error("❌ Withdraw Error: No wallet connected");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Derive vault PDA
        const vaultAddress = await deriveVaultPda();

        // Manually construct instruction with all 6 required accounts
        // This matches the Rust program's WithdrawCollateral struct
        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddress, role: 3 },              // user (WritableSigner)
            { address: userAccountAddress, role: 1 },         // userAccount (Writable)
            { address: userTokenAccount, role: 1 },           // userTokenAccount (Writable)
            { address: vaultAddress, role: 1 },               // vault (Writable)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 },      // tokenProgram (Readonly)
            { address: SYSTEM_PROGRAM_ADDRESS, role: 0 },     // systemProgram (Readonly)
          ],
          data: getWithdrawCollateralInstructionDataEncoder().encode({
            amount: BigInt(Math.floor(amount)),
          }),
        };

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true },
        );

        return signature;
      } catch (err) {
        console.error("❌ Withdraw failed with error:", err);
        setError(err instanceof Error ? err : new Error("Withdraw failed"));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [send, walletAddress, wallet, userAccountAddress]
  );

  return {
    withdraw,
    isLoading,
    error,
  };
}