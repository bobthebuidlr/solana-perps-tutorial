import { useQuery } from "@tanstack/react-query";
import { useSolanaClient } from "@solana/react-hooks";
import { fetchMarkets } from "../generated/perps";
import { type PerpsMarket } from "../generated/perps/types";
import { useMarketsPda } from "./usePdas";

/**
 * Fetches all available perps markets from the Solana program.
 * Uses React Query for caching and deduplication.
 *
 * @returns markets - Array of all available markets or null if not loaded.
 * @returns isLoading - True while fetching markets data.
 * @returns error - Error object if fetch failed, null otherwise.
 */
export function useMarkets() {
  const client = useSolanaClient();
  const marketsAddress = useMarketsPda();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["markets"],
    queryFn: async (): Promise<PerpsMarket[]> => {
      if (!marketsAddress || !client?.runtime?.rpc) {
        return [];
      }
      try {
        const marketsAccount = await fetchMarkets(
          client.runtime.rpc,
          marketsAddress
        );
        return marketsAccount.data.perps;
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("not found at address")
        ) {
          return [];
        }
        throw err;
      }
    },
    enabled: !!marketsAddress && !!client?.runtime?.rpc,
    refetchInterval: 5000,
  });

  return {
    markets: data ?? null,
    isLoading,
    error: error as Error | null,
    refresh: refetch,
  };
}
