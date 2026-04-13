import { useQuery } from "@tanstack/react-query";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { fetchMaybeUserAccount } from "../generated/perps/accounts/userAccount";
import { type Position } from "../generated/perps/types/position";
import { useUserAccountPda } from "./usePdas";

/**
 * Fetches all open positions for the connected wallet by reading them
 * inline from the user's UserAccount. Uses React Query for caching and
 * 5-second auto-refresh.
 *
 * @returns positions - Array of Position structs; empty when none exist.
 * @returns isLoading - True while the RPC call is in-flight.
 * @returns error - Last fetch error, or null.
 */
export function usePositions() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();
  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);

  const { data, isLoading, error } = useQuery({
    queryKey: ["positions", walletAddress ?? "disconnected"],
    queryFn: async (): Promise<Position[]> => {
      if (!walletAddress || !client?.runtime?.rpc || !userAccountAddress) {
        return [];
      }

      const maybeAccount = await fetchMaybeUserAccount(
        client.runtime.rpc,
        userAccountAddress
      );

      if (!maybeAccount.exists) {
        return [];
      }

      return [...maybeAccount.data.positions];
    },
    enabled:
      !!walletAddress && !!client?.runtime?.rpc && !!userAccountAddress,
    refetchInterval: 5000,
  });

  return {
    positions: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}
