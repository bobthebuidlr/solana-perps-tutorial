import { type Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getWithdrawCollateralInstructionDataEncoder } from "../generated/perps/instructions/withdrawCollateral";
import { TOKEN_PROGRAM_ADDRESS } from "../lib/constants";
import { deriveUserCollateralPda } from "../lib/pdas";
import { useConfigPda, useMarketsPda, useOraclePda, useUserAccountPda } from "./usePdas";

/**
 * Hook to withdraw collateral from the user's perps account.
 * Invalidates collateral and token balance queries on success.
 *
 * @returns withdraw - Function to withdraw collateral.
 * @returns isLoading - True while withdraw transaction is processing.
 * @returns error - Error object if withdraw failed, null otherwise.
 */
export function useWithdraw() {
  const { send } = useSendTransaction();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { wallet } = useWalletConnection();

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);
  const configAddress = useConfigPda();
  const marketsAddress = useMarketsPda();
  const oracleAddress = useOraclePda();

  /**
   * Sends a withdraw collateral instruction.
   *
   * @param amount - Amount in base units (USDC with 6 decimals).
   * @param userTokenAccount - User's associated token account address.
   * @returns Transaction signature string, or null on failure.
   */
  const withdraw = useCallback(
    async (amount: number, userTokenAccount: Address) => {
      if (!walletAddress || !wallet || !userAccountAddress || !configAddress || !marketsAddress || !oracleAddress) {
        console.error("❌ Withdraw Error: Missing required accounts");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Derive per-user collateral token account PDA
        const userCollateralAddress = await deriveUserCollateralPda(walletAddress);

        // Manually construct instruction with all required accounts
        // This matches the Rust program's WithdrawCollateral struct
        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddress, role: 3 },              // user (WritableSigner)
            { address: userAccountAddress, role: 1 },         // userAccount (Writable)
            { address: configAddress, role: 0 },              // config (Readonly)
            { address: userCollateralAddress, role: 1 },      // userCollateralTokenAccount (Writable)
            { address: userTokenAccount, role: 1 },           // userTokenAccount (Writable)
            { address: marketsAddress, role: 0 },             // markets (Readonly)
            { address: oracleAddress, role: 0 },              // oracle (Readonly)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 },      // tokenProgram (Readonly)
          ],
          data: getWithdrawCollateralInstructionDataEncoder().encode({
            amount: BigInt(Math.floor(amount)),
          }),
        };

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true }
        );

        // Invalidate related queries so UI updates everywhere
        await queryClient.invalidateQueries({ queryKey: ["collateral"] });
        await queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });

        return signature;
      } catch (err) {
        console.error("❌ Withdraw failed with error:", err);
        setError(err instanceof Error ? err : new Error("Withdraw failed"));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [send, walletAddress, wallet, userAccountAddress, configAddress, marketsAddress, oracleAddress, queryClient]
  );

  return {
    withdraw,
    isLoading,
    error,
  };
}
