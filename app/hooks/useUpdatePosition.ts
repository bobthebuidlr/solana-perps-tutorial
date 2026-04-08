import { type Address } from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getUpdatePositionInstructionDataEncoder } from "../generated/perps/instructions/updatePosition";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { TOKEN_PROGRAM_ADDRESS } from "../lib/constants";
import { derivePositionPda, deriveUserCollateralPda, deriveVaultPda } from "../lib/pdas";
import { useConfigPda, useMarketsPda, useOraclePda, useUserAccountPda } from "./usePdas";

/**
 * Hook to update an existing perpetual futures position on-chain.
 * Realizes current PnL and resets the position with new parameters.
 * Invalidates positions and collateral queries on success.
 *
 * @returns updatePosition - Sends the update-position instruction.
 * @returns isLoading - True while the transaction is in-flight.
 * @returns error - Last error, or null.
 */
export function useUpdatePosition() {
  const { send } = useSendTransaction();
  const { wallet } = useWalletConnection();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);
  const marketsAddress = useMarketsPda();
  const oracleAddress = useOraclePda();
  const configAddress = useConfigPda();

  /**
   * Sends an updatePosition instruction for the given market and parameters.
   *
   * @param tokenMint - The token mint address of the market.
   * @param direction - New direction (Long or Short, can flip).
   * @param size - New position size in base units (token qty with 6 decimals).
   * @param leverage - New leverage multiplier in 6-decimal (e.g. 5_000_000 = 5x).
   * @returns Transaction signature string, or null on failure.
   */
  const updatePosition = useCallback(
    async (
      tokenMint: Address,
      direction: PositionDirection,
      size: number,
      leverage: number
    ): Promise<string | null> => {
      if (!walletAddress || !wallet || !userAccountAddress || !marketsAddress || !oracleAddress || !configAddress) {
        console.error("❌ UpdatePosition: missing required accounts");
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
            { address: configAddress, role: 0 },              // config (Readonly)
            { address: userCollateralAddress, role: 1 },      // userCollateralTokenAccount (Writable)
            { address: vaultAddress, role: 1 },               // vault (Writable)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 },      // tokenProgram (Readonly)
          ],
          data: getUpdatePositionInstructionDataEncoder().encode({
            tokenMint,
            direction,
            size: BigInt(Math.floor(size)),
            leverage: BigInt(Math.floor(leverage)),
          }),
        };

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true },
        );

        // Invalidate related queries so UI updates everywhere
        await queryClient.invalidateQueries({ queryKey: ["positions"] });
        await queryClient.invalidateQueries({ queryKey: ["collateral"] });

        return signature;
      } catch (err) {
        console.error("❌ UpdatePosition failed:", err);
        const e = err instanceof Error ? err : new Error("Failed to update position");
        setError(e);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [send, walletAddress, wallet, userAccountAddress, marketsAddress, oracleAddress, configAddress, queryClient]
  );

  return { updatePosition, isLoading, error };
}
