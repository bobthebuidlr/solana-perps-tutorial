import {
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { useSolanaClient } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import { fetchMarkets } from "../generated/perps";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps/programs/perps";
import { type PerpsMarket } from "../generated/perps/types";

/**
 * Custom hook to fetch all available perps markets from the Solana program.
 *
 * @returns {Object} Object containing markets data, loading state, error state, and refresh function
 * @returns {PerpsMarket[] | null} markets - Array of all available markets or null if not loaded
 * @returns {boolean} isLoading - True while fetching markets data
 * @returns {Error | null} error - Error object if fetch failed, null otherwise
 * @returns {() => Promise<void>} refresh - Function to manually refresh markets data
 */
export function useMarkets() {
  const client = useSolanaClient();
  const [markets, setMarkets] = useState<PerpsMarket[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [marketsAddress, setMarketsAddress] = useState<Address | null>(null);

  // Derive Markets PDA once on mount
  useEffect(() => {
    async function deriveMarketsAddress() {
      try {
        const [pda] = await getProgramDerivedAddress({
          programAddress: PERPS_PROGRAM_ADDRESS,
          seeds: [
            getBytesEncoder().encode(
              new Uint8Array([109, 97, 114, 107, 101, 116, 115])
            ), // "markets"
          ],
        });
        console.log("Markets PDA:", pda);
        console.log("Perps program: ", PERPS_PROGRAM_ADDRESS);
        setMarketsAddress(pda);
      } catch (err) {
        console.error("Failed to derive Markets PDA:", err);
        setError(
          err instanceof Error ? err : new Error("Failed to derive Markets PDA")
        );
        setIsLoading(false);
      }
    }

    deriveMarketsAddress();
  }, []);

  // Fetch markets data
  const fetchMarketsData = useCallback(async () => {
    if (!marketsAddress || !client?.runtime?.rpc) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const marketsAccount = await fetchMarkets(
        client.runtime.rpc,
        marketsAddress
      );
      setMarkets(marketsAccount.data.perps);
    } catch (err) {
      console.error("Failed to fetch markets:", err);
      setError(
        err instanceof Error ? err : new Error("Failed to fetch markets")
      );
      setMarkets(null);
    } finally {
      setIsLoading(false);
    }
  }, [marketsAddress, client]);

  // Auto-fetch when address is ready
  useEffect(() => {
    if (marketsAddress && client?.runtime?.rpc) {
      fetchMarketsData();
    }
  }, [marketsAddress, client, fetchMarketsData]);

  return {
    markets,
    isLoading,
    error,
    refresh: fetchMarketsData,
  };
}
