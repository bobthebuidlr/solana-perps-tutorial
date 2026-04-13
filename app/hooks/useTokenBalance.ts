import { type Address } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { useSolanaClient } from "@solana/react-hooks";

/**
 * Fetches the SPL token balance for a given token account.
 * Uses React Query for caching and 5-second auto-refresh.
 *
 * @param tokenAccountAddress - The associated token account address to query.
 * @returns balance - Raw token balance in base units, or null if not loaded.
 * @returns isLoading - True while fetching balance data.
 */
export function useTokenBalance(tokenAccountAddress: Address | null) {
  const client = useSolanaClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tokenBalance", tokenAccountAddress ?? "none"],
    queryFn: async (): Promise<bigint | null> => {
      if (!tokenAccountAddress || !client?.runtime?.rpc) {
        return null;
      }
      try {
        const result = await client.runtime.rpc
          .getTokenAccountBalance(tokenAccountAddress)
          .send();
        return BigInt(result.value.amount);
      } catch (err) {
        console.error("Failed to fetch token balance:", err);
        // Account may not exist yet (e.g. no token account created)
        return null;
      }
    },
    enabled: !!tokenAccountAddress && !!client?.runtime?.rpc,
    refetchInterval: 5000,
  });

  return { balance: data ?? null, isLoading };
}
