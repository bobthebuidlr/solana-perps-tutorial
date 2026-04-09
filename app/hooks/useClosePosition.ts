import { type Address } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getClosePositionInstructionDataEncoder } from "../generated/perps/instructions/closePosition";
import { TOKEN_PROGRAM_ADDRESS } from "../lib/constants";
import {
  derivePositionPda,
  deriveUserCollateralPda,
  deriveVaultPda,
} from "../lib/pdas";
import {
  useConfigPda,
  useMarketsPda,
  useOraclePda,
  useUserAccountPda,
} from "./usePdas";

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
  const configAddress = useConfigPda();

  /**
   * Sends a closePosition instruction for the given market.
   *
   * @param tokenMint - The token mint address of the market to close.
   * @returns Transaction signature string, or null on failure.
   */
  const closePosition = useCallback(
    async (tokenMint: Address): Promise<string | null> => {
      setError(null);

      const missing = [
        !walletAddress && "wallet",
        !userAccountAddress && "userAccount",
        !marketsAddress && "markets",
        !oracleAddress && "oracle",
        !configAddress && "config",
      ].filter(Boolean);

      if (missing.length > 0 || !walletAddress || !wallet) {
        const msg = `ClosePosition: missing accounts: ${missing.join(", ")}`;
        console.error(msg);
        setError(new Error(msg));
        return null;
      }
      // Re-assign to const for TypeScript narrowing
      const user = walletAddress;
      const userAccount = userAccountAddress!;
      const markets = marketsAddress!;
      const oracle = oracleAddress!;
      const config = configAddress!;

      setIsLoading(true);
      try {
        const positionAddress = await derivePositionPda(user, tokenMint);
        const userCollateralAddress = await deriveUserCollateralPda(user);
        const vaultAddress = await deriveVaultPda();

        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: user, role: 3 }, // user (WritableSigner)
            { address: userAccount, role: 1 }, // userAccount (Writable)
            { address: positionAddress, role: 1 }, // position (Writable)
            { address: markets, role: 1 }, // markets (Writable)
            { address: oracle, role: 0 }, // oracle (Readonly)
            { address: config, role: 0 }, // config (Readonly)
            { address: userCollateralAddress, role: 1 }, // userCollateralTokenAccount (Writable)
            { address: vaultAddress, role: 1 }, // vault (Writable)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 }, // tokenProgram (Readonly)
          ],
          data: getClosePositionInstructionDataEncoder().encode({ tokenMint }),
        };

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true }
        );

        if (!signature) {
          throw new Error("Transaction was not confirmed");
        }

        // Invalidate related queries so UI updates everywhere
        await queryClient.invalidateQueries({ queryKey: ["positions"] });
        await queryClient.invalidateQueries({ queryKey: ["collateral"] });

        return signature;
      } catch (err: unknown) {
        console.error("ClosePosition failed:", err);
        // Extract nested Solana error details from transactionPlanResult
        let message = "Failed to close position";
        if (err && typeof err === "object") {
          const ctx = (err as Record<string, unknown>).context as
            | Record<string, unknown>
            | undefined;
          const planResult =
            ctx?.transactionPlanResult ??
            (err as Record<string, unknown>).transactionPlanResult;
          if (planResult) {
            console.error(
              "Transaction plan result:",
              JSON.stringify(planResult, null, 2)
            );
            message = JSON.stringify(planResult);
          }
          const cause = (err as Record<string, unknown>).cause;
          if (cause && typeof cause === "object" && "message" in cause) {
            message = (cause as Error).message;
          }
        }
        if (err instanceof Error && err.message !== message) {
          message = `${err.message} | ${message}`;
        }
        setError(new Error(message));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [
      send,
      walletAddress,
      wallet,
      userAccountAddress,
      marketsAddress,
      oracleAddress,
      configAddress,
      queryClient,
    ]
  );

  return { closePosition, isLoading, error };
}
