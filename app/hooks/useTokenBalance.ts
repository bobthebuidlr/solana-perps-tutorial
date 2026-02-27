import { type Address } from "@solana/kit";
import { useSolanaClient } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";

/**
 * Custom hook to fetch the SPL token balance for a given token account.
 *
 * @param {Address | null} tokenAccountAddress - The associated token account address to query
 * @returns {Object} Object containing balance data, loading state, and refresh function
 * @returns {bigint | null} balance - Raw token balance in base units, or null if not loaded
 * @returns {boolean} isLoading - True while fetching balance data
 * @returns {() => Promise<void>} refresh - Function to manually refresh the balance
 */
export function useTokenBalance(tokenAccountAddress: Address | null) {
  const client = useSolanaClient();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!tokenAccountAddress || !client?.runtime?.rpc) {
      setBalance(null);
      return;
    }

    setIsLoading(true);
    try {
      const result = await client.runtime.rpc
        .getTokenAccountBalance(tokenAccountAddress)
        .send();
      setBalance(BigInt(result.value.amount));
    } catch (err) {
      console.error("Failed to fetch token balance:", err);
      // Account may not exist yet (e.g. no token account created)
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  }, [tokenAccountAddress, client]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  return { balance, isLoading, refresh: fetchBalance };
}
