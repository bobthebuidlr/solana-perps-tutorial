import { type Address } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getOpenPositionInstructionDataEncoder } from "../generated/perps/instructions/openPosition";
import { PositionDirection } from "../generated/perps/types/positionDirection";
import { SYSTEM_PROGRAM_ADDRESS } from "../lib/constants";
import { derivePositionPda } from "../lib/pdas";
import { useMarketsPda, useOraclePda, useUserAccountPda } from "./usePdas";

/**
 * Hook to open a perpetual futures position on-chain.
 *
 * @returns openPosition - Sends the open-position instruction.
 * @returns isLoading - True while the transaction is in-flight.
 * @returns error - Last error, or null.
 */
export function useOpenPosition() {
  const { send } = useSendTransaction();
  const { wallet } = useWalletConnection();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);
  const marketsAddress = useMarketsPda();
  const oracleAddress = useOraclePda();

  /**
   * Sends an openPosition instruction for the given market and parameters.
   *
   * @param tokenMint - The token mint address of the market.
   * @param direction - Long or Short.
   * @param amount - Position size in base units (USDC with 6 decimals).
   * @returns Transaction signature string, or null on failure.
   */
  const openPosition = useCallback(
    async (
      tokenMint: Address,
      direction: PositionDirection,
      amount: number
    ): Promise<string | null> => {
      if (!walletAddress || !wallet || !userAccountAddress || !marketsAddress || !oracleAddress) {
        console.error("❌ OpenPosition: missing required accounts");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Derive position PDA (unique per user + tokenMint)
        const positionAddress = await derivePositionPda(walletAddress, tokenMint);

        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddress, role: 3 },              // user (WritableSigner)
            { address: userAccountAddress, role: 1 },         // userAccount (Writable)
            { address: positionAddress, role: 1 },            // position (Writable)
            { address: marketsAddress, role: 1 },             // markets (Writable)
            { address: oracleAddress, role: 0 },              // oracle (Readonly)
            { address: SYSTEM_PROGRAM_ADDRESS, role: 0 },     // systemProgram (Readonly)
          ],
          data: getOpenPositionInstructionDataEncoder().encode({
            tokenMint,
            direction,
            amount: BigInt(Math.floor(amount)),
          }),
        };

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true },
        );
        return signature;
      } catch (err) {
        console.error("❌ OpenPosition failed:", err);
        const e = err instanceof Error ? err : new Error("Failed to open position");
        setError(e);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [send, walletAddress, wallet, userAccountAddress, marketsAddress, oracleAddress]
  );

  return { openPosition, isLoading, error };
}
