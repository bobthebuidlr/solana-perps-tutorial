import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import {
  fetchAllMaybePosition,
  type Position,
} from "../generated/perps/accounts/position";
import { fetchMaybeUserAccount } from "../generated/perps/accounts/userAccount";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps/programs/perps";

/**
 * Fetches all open Position accounts owned by the connected wallet.
 * Reads the positions array from the user's UserAccount PDA and
 * batch-fetches each Position account in one RPC call.
 *
 * @returns positions - Array of decoded Position data; empty when none exist.
 * @returns isLoading - True while the RPC calls are in-flight.
 * @returns error - Last fetch error, or null.
 * @returns refresh - Manually re-fetches positions.
 */
export function usePositions() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;

  const fetchPositions = useCallback(async () => {
    if (!walletAddress || !client?.runtime?.rpc) {
      setPositions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Derive user account PDA
      const [userAccountAddress] = await getProgramDerivedAddress({
        programAddress: PERPS_PROGRAM_ADDRESS,
        seeds: [
          getBytesEncoder().encode(new Uint8Array([117, 115, 101, 114])), // "user"
          getAddressEncoder().encode(walletAddress),
        ],
      });

      // User account may not exist yet (wallet has never deposited)
      const maybeUserAccount = await fetchMaybeUserAccount(
        client.runtime.rpc,
        userAccountAddress
      );

      if (!maybeUserAccount.exists || maybeUserAccount.data.positions.length === 0) {
        setPositions([]);
        return;
      }

      // Batch-fetch every position account in a single RPC call
      const maybePositions = await fetchAllMaybePosition(
        client.runtime.rpc,
        maybeUserAccount.data.positions
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
      setIsLoading(false);
    }
  }, [walletAddress, client]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  return { positions, isLoading, error, refresh: fetchPositions };
}
