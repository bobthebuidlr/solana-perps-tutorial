import { useQuery } from "@tanstack/react-query";
import { useSolanaClient } from "@solana/react-hooks";
import { fetchOracle } from "../generated/perps/accounts/oracle";
import { type OraclePrice } from "../generated/perps/types/oraclePrice";
import { useOraclePda } from "./usePdas";

/**
 * Fetches all current oracle prices from the on-chain Oracle account.
 * Uses React Query for caching and 5-second auto-refresh.
 *
 * @returns prices - All OraclePrice entries, or null while loading.
 * @returns isLoading - True while the RPC call is in-flight.
 * @returns error - Last error encountered, or null.
 */
export function useOraclePrices() {
  const client = useSolanaClient();
  const oracleAddress = useOraclePda();

  const { data, isLoading, error } = useQuery({
    queryKey: ["oraclePrices"],
    queryFn: async (): Promise<OraclePrice[]> => {
      if (!oracleAddress || !client?.runtime?.rpc) {
        return [];
      }
      const oracle = await fetchOracle(client.runtime.rpc, oracleAddress);
      return oracle.data.prices;
    },
    enabled: !!oracleAddress && !!client?.runtime?.rpc,
    refetchInterval: 5000,
  });

  return {
    prices: data ?? null,
    isLoading,
    error: error as Error | null,
  };
}
