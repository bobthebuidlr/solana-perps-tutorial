import { useQuery } from "@tanstack/react-query";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import {
  fetchAllMaybePosition,
  type Position,
} from "../generated/perps/accounts/position";
import { derivePositionPda } from "../lib/pdas";
import { useMarkets } from "./useMarkets";

/**
 * Fetches all open Position accounts owned by the connected wallet.
 * Derives position PDAs from known markets and batch-fetches to find
 * which positions exist. Uses React Query for caching and 5-second auto-refresh.
 *
 * @returns positions - Array of decoded Position data; empty when none exist.
 * @returns isLoading - True while the RPC calls are in-flight.
 * @returns error - Last fetch error, or null.
 */
export function usePositions() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();
  const { markets } = useMarkets();

  const walletAddress = wallet?.account.address;

  const { data, isLoading, error } = useQuery({
    queryKey: ["positions", walletAddress ?? "disconnected"],
    queryFn: async (): Promise<Position[]> => {
      if (!walletAddress || !client?.runtime?.rpc || !markets || markets.length === 0) {
        return [];
      }

      // Derive position PDA for each known market
      const positionAddresses = await Promise.all(
        markets.map((m) => derivePositionPda(walletAddress, m.tokenMint))
      );

      // Batch-fetch all derived position PDAs in a single RPC call
      const maybePositions = await fetchAllMaybePosition(
        client.runtime.rpc,
        positionAddresses
      );

      return maybePositions
        .filter((p): p is Extract<typeof p, { exists: true }> => p.exists)
        .map((p) => p.data);
    },
    enabled: !!walletAddress && !!client?.runtime?.rpc && !!markets && markets.length > 0,
    refetchInterval: 5000,
  });

  return {
    positions: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}
