import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useQuery } from "@tanstack/react-query";
import { fetchUserAccount } from "../generated/perps/accounts/userAccount";
import { deriveUserCollateralPda } from "../lib/pdas";
import { useUserAccountPda } from "./usePdas";

/**
 * Fetches the connected wallet's available and locked collateral.
 * Available collateral = collateral token account balance - locked collateral.
 * Uses React Query for caching, deduplication, and 5-second auto-refresh.
 *
 * @returns collateral - Available collateral (token balance - locked), or null while loading.
 * @returns lockedCollateral - Locked collateral amount, or null while loading.
 * @returns isLoading - True while the initial fetch is in-flight.
 * @returns error - Last fetch error, or null.
 */
export function useCollateral() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);

  const { data, isLoading, error } = useQuery({
    queryKey: ["collateral", walletAddress ?? "disconnected"],
    queryFn: async () => {
      if (!walletAddress || !userAccountAddress || !client?.runtime?.rpc) {
        return { collateral: 0n, lockedCollateral: 0n };
      }

      try {
        // Fetch locked_collateral from user account
        const userAccount = await fetchUserAccount(
          client.runtime.rpc,
          userAccountAddress
        );
        const locked = userAccount.data.lockedCollateral;

        // Fetch actual token balance from the user's collateral token account
        const collateralPda = await deriveUserCollateralPda(walletAddress);
        const tokenBalanceResult = await client.runtime.rpc
          .getTokenAccountBalance(collateralPda)
          .send();
        const tokenBalance = BigInt(tokenBalanceResult.value.amount);

        console.log("collateral token account: ", collateralPda);

        // Available = token balance - locked
        const available = tokenBalance > locked ? tokenBalance - locked : 0n;

        return { collateral: available, lockedCollateral: locked };
      } catch (err) {
        // If account doesn't exist yet, set to zero rather than error
        if (
          err instanceof Error &&
          err.message.includes("Account does not exist")
        ) {
          return { collateral: 0n, lockedCollateral: 0n };
        }
        throw err;
      }
    },
    enabled: !!walletAddress && !!userAccountAddress && !!client?.runtime?.rpc,
    refetchInterval: 5000,
  });

  return {
    collateral: data?.collateral ?? null,
    lockedCollateral: data?.lockedCollateral ?? null,
    isLoading,
    error: error as Error | null,
  };
}
