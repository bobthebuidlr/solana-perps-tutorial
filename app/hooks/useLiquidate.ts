import { type Address } from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getLiquidateInstructionDataEncoder } from "../generated/perps/instructions/liquidate";
import { TOKEN_PROGRAM_ADDRESS, USDC_MINT_ADDRESS } from "../lib/constants";
import { deriveUserCollateralPda, deriveVaultPda } from "../lib/pdas";
import {
  getProgramDerivedAddress,
  getAddressEncoder,
  getBytesEncoder,
} from "@solana/kit";
import { useConfigPda, useMarketsPda, useOraclePda } from "./usePdas";
import { useTokenAccount } from "./useTokenAccount";

/**
 * Hook to permissionlessly liquidate an underwater user account.
 * Any signer can call this against any target wallet whose equity has dropped
 * below maintenance margin. On success the liquidator receives a bonus (% of
 * liquidated notional) into their USDC ATA.
 *
 * @returns liquidate - Sends the liquidate instruction for a given target wallet.
 * @returns isLoading - True while the transaction is in-flight.
 * @returns error - Last error, or null.
 */
export function useLiquidate() {
  const { send } = useSendTransaction();
  const { wallet } = useWalletConnection();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;
  const liquidatorTokenAccount = useTokenAccount(USDC_MINT_ADDRESS);
  const marketsAddress = useMarketsPda();
  const oracleAddress = useOraclePda();
  const configAddress = useConfigPda();

  /**
   * Sends a liquidate instruction against the given target wallet.
   *
   * @param liquidatee - Target wallet address whose account is liquidatable.
   * @returns Transaction signature string, or null on failure.
   */
  const liquidate = useCallback(
    async (liquidatee: Address): Promise<string | null> => {
      setError(null);

      const missing = [
        !walletAddress && "wallet",
        !liquidatorTokenAccount && "liquidatorTokenAccount",
        !marketsAddress && "markets",
        !oracleAddress && "oracle",
        !configAddress && "config",
      ].filter(Boolean);

      if (
        missing.length > 0 ||
        !walletAddress ||
        !wallet ||
        !liquidatorTokenAccount
      ) {
        const msg = `Liquidate: missing accounts: ${missing.join(", ")}`;
        console.error(msg);
        setError(new Error(msg));
        return null;
      }
      const liquidator = walletAddress;
      const markets = marketsAddress!;
      const oracle = oracleAddress!;
      const config = configAddress!;

      setIsLoading(true);
      try {
        // Target user PDAs — derived from the liquidatee, not the caller.
        const [targetUserAccount] = await getProgramDerivedAddress({
          programAddress: PERPS_PROGRAM_ADDRESS,
          seeds: [
            getBytesEncoder().encode(new Uint8Array([117, 115, 101, 114])), // "user"
            getAddressEncoder().encode(liquidatee),
          ],
        });
        const targetCollateral = await deriveUserCollateralPda(liquidatee);
        const vaultAddress = await deriveVaultPda();

        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: liquidator, role: 3 }, // liquidator (WritableSigner)
            { address: liquidatorTokenAccount, role: 1 }, // liquidatorTokenAccount (Writable)
            { address: targetUserAccount, role: 1 }, // userAccount (Writable)
            { address: targetCollateral, role: 1 }, // userCollateralTokenAccount (Writable)
            { address: markets, role: 1 }, // markets (Writable)
            { address: oracle, role: 0 }, // oracle (Readonly)
            { address: config, role: 0 }, // config (Readonly)
            { address: vaultAddress, role: 1 }, // vault (Writable)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 }, // tokenProgram (Readonly)
          ],
          data: getLiquidateInstructionDataEncoder().encode({ liquidatee }),
        };

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true }
        );

        if (!signature) {
          throw new Error("Transaction was not confirmed");
        }

        await queryClient.invalidateQueries({ queryKey: ["positions"] });
        await queryClient.invalidateQueries({ queryKey: ["collateral"] });
        await queryClient.invalidateQueries({ queryKey: ["accountHealth"] });

        return signature;
      } catch (err: unknown) {
        console.error("Liquidate failed:", err);
        let message = "Failed to liquidate";
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
      liquidatorTokenAccount,
      marketsAddress,
      oracleAddress,
      configAddress,
      queryClient,
    ]
  );

  return { liquidate, isLoading, error };
}
