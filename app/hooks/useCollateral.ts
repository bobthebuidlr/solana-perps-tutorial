import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useQuery } from "@tanstack/react-query";
import { deriveUserCollateralPda } from "../lib/pdas";

/**
 * Fetches the connected wallet's collateral token balance.
 * In cross-margin mode, all collateral is available — margin is computed dynamically.
 * Uses React Query for caching, deduplication, and 5-second auto-refresh.
 *
 * @returns balance - Total collateral balance in the account, or null while loading.
 * @returns isLoading - True while the initial fetch is in-flight.
 * @returns error - Last fetch error, or null.
 */
export function useCollateral() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();

  const walletAddress = wallet?.account.address;

  const { data, isLoading, error } = useQuery({
    queryKey: ["collateral", walletAddress ?? "disconnected"],
    queryFn: async () => {
      if (!walletAddress || !client?.runtime?.rpc) {
        return { balance: 0n };
      }

      try {
        const collateralPda = await deriveUserCollateralPda(walletAddress);
        const tokenBalanceResult = await client.runtime.rpc
          .getTokenAccountBalance(collateralPda)
          .send();
        const tokenBalance = BigInt(tokenBalanceResult.value.amount);

        return { balance: tokenBalance };
      } catch (err) {
        // If account doesn't exist yet, set to zero rather than error
        if (
          err instanceof Error &&
          err.message.includes("Account does not exist")
        ) {
          return { balance: 0n };
        }
        throw err;
      }
    },
    enabled: !!walletAddress && !!client?.runtime?.rpc,
    refetchInterval: 5000,
  });

  return {
    balance: data?.balance ?? null,
    isLoading,
    error: error as Error | null,
  };
}
