import { type Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getClosePositionInstructionDataEncoder } from "../generated/perps/instructions/closePosition";
import { TOKEN_PROGRAM_ADDRESS } from "../lib/constants";
import { derivePositionPda, deriveUserCollateralPda, deriveVaultPda } from "../lib/pdas";
import { useMarketsPda, useOraclePda, useUserAccountPda } from "./usePdas";

/**
 * Hook to close an open perpetual futures position on-chain.
 * Invalidates positions and collateral queries on success.
 *
 * @returns closePosition - Sends the close-position instruction for a given token mint.
 * @returns isLoading - True while the transaction is in-flight.
 * @returns error - Last error, or null.
 */
export function useClosePosition() {
  const { send } = useSendTransaction();
  const { wallet } = useWalletConnection();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);
  const marketsAddress = useMarketsPda();
  const oracleAddress = useOraclePda();

  /**
   * Sends a closePosition instruction for the given market.
   *
   * @param tokenMint - The token mint address of the market to close.
   * @returns Transaction signature string, or null on failure.
   */
  const closePosition = useCallback(
    async (tokenMint: Address): Promise<string | null> => {
      if (!walletAddress || !wallet || !userAccountAddress || !marketsAddress || !oracleAddress) {
        console.error("❌ ClosePosition: missing required accounts");
        return null;
      }
      setIsLoading(true);
      setError(null);
      try {
        const positionAddress = await derivePositionPda(walletAddress, tokenMint);
        const userCollateralAddress = await deriveUserCollateralPda(walletAddress);
        const vaultAddress = await deriveVaultPda();

        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddress, role: 3 },              // user (WritableSigner)
            { address: userAccountAddress, role: 1 },         // userAccount (Writable)
            { address: positionAddress, role: 1 },            // position (Writable)
            { address: marketsAddress, role: 1 },             // markets (Writable)
            { address: oracleAddress, role: 0 },              // oracle (Readonly)
            { address: userCollateralAddress, role: 1 },      // userCollateralTokenAccount (Writable)
            { address: vaultAddress, role: 1 },               // vault (Writable)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 },      // tokenProgram (Readonly)
          ],
          data: getClosePositionInstructionDataEncoder().encode({ tokenMint }),
        };

        const signature = await send({ instructions: [instruction] }, { skipPreflight: true });

        // Invalidate related queries so UI updates everywhere
        await queryClient.invalidateQueries({ queryKey: ["positions"] });
        await queryClient.invalidateQueries({ queryKey: ["collateral"] });

        return signature;
      } catch (err) {
        console.error("❌ ClosePosition failed:", err);
        const e = err instanceof Error ? err : new Error("Failed to close position");
        setError(e);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [send, walletAddress, wallet, userAccountAddress, marketsAddress, oracleAddress, queryClient]
  );

  return { closePosition, isLoading, error };
}
