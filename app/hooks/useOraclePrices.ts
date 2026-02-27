import { getBytesEncoder, getProgramDerivedAddress } from "@solana/kit";
import { useSolanaClient } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import { fetchOracle } from "../generated/perps/accounts/oracle";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps/programs/perps";
import { type OraclePrice } from "../generated/perps/types/oraclePrice";

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
  const [prices, setPrices] = useState<OraclePrice[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPrices = useCallback(async () => {
    if (!client?.runtime?.rpc) return;

    setIsLoading(true);
    setError(null);

    try {
      const [oracleAddress] = await getProgramDerivedAddress({
        programAddress: PERPS_PROGRAM_ADDRESS,
        seeds: [
          getBytesEncoder().encode(
            // "oracle"
            new Uint8Array([111, 114, 97, 99, 108, 101])
          ),
        ],
      });

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
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  return { prices, isLoading, error, refresh: fetchPrices };
}
