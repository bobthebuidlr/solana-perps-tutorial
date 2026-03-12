import { useSolanaClient } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import { fetchOracle } from "../generated/perps/accounts/oracle";
import { type OraclePrice } from "../generated/perps/types/oraclePrice";
import { useOraclePda } from "./usePdas";

/**
 * Fetches all current oracle prices from the on-chain Oracle account.
 *
 * @returns prices - All OraclePrice entries, or null while loading.
 * @returns isLoading - True while the RPC call is in-flight.
 * @returns error - Last error encountered, or null.
 * @returns refresh - Manually re-fetches the oracle account.
 */
export function useOraclePrices() {
  const client = useSolanaClient();
  const oracleAddress = useOraclePda();
  const [prices, setPrices] = useState<OraclePrice[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPrices = useCallback(async (silent = false) => {
    if (!oracleAddress || !client?.runtime?.rpc) return;

    if (!silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const oracle = await fetchOracle(client.runtime.rpc, oracleAddress);
      setPrices(oracle.data.prices);
    } catch (err) {
      setError(
        err instanceof Error
          ? err
          : new Error("Failed to fetch oracle prices")
      );
      setPrices(null);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [oracleAddress, client]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  // Auto-refresh oracle prices every 5 seconds
  useEffect(() => {
    if (!oracleAddress) return;
    
    const interval = setInterval(() => {
      fetchPrices(true); // silent refresh
    }, 5000);

    return () => clearInterval(interval);
  }, [oracleAddress, fetchPrices]);

  return { prices, isLoading, error, refresh: () => fetchPrices(false) };
}
