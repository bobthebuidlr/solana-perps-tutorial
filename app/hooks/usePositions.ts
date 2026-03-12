import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import {
  fetchAllMaybePosition,
  type Position,
} from "../generated/perps/accounts/position";
import { derivePositionPda } from "../lib/pdas";
import { useMarkets } from "./useMarkets";

/**
 * Fetches all open Position accounts owned by the connected wallet.
 * Derives position PDAs from known markets and batch-fetches to find
 * which positions exist.
 *
 * @returns positions - Array of decoded Position data; empty when none exist.
 * @returns isLoading - True while the RPC calls are in-flight.
 * @returns error - Last fetch error, or null.
 * @returns refresh - Manually re-fetches positions.
 */
export function usePositions() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();
  const { markets } = useMarkets();
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;

  const fetchPositions = useCallback(async (silent = false) => {
    if (!walletAddress || !client?.runtime?.rpc || !markets || markets.length === 0) {
      setPositions([]);
      if (!silent) setIsLoading(false);
      return;
    }

    if (!silent) setIsLoading(true);
    setError(null);

    try {
      // Derive position PDA for each known market
      const positionAddresses = await Promise.all(
        markets.map((m) => derivePositionPda(walletAddress, m.tokenMint))
      );

      // Batch-fetch all derived position PDAs in a single RPC call
      const maybePositions = await fetchAllMaybePosition(
        client.runtime.rpc,
        positionAddresses
      );

      setPositions(
        maybePositions
          .filter((p): p is Extract<typeof p, { exists: true }> => p.exists)
          .map((p) => p.data)
      );
    } catch (err) {
      console.error("Failed to fetch positions:", err);
      setError(err instanceof Error ? err : new Error("Failed to fetch positions"));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [walletAddress, markets, client]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  return { positions, isLoading, error, refresh: fetchPositions };
}
