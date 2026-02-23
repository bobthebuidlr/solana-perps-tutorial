import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import { fetchUserAccount } from "../generated/perps/accounts/userAccount";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps/programs/perps";

/**
 * Custom hook to fetch user's collateral balance from their user account.
 *
 * @returns {Object} Object containing collateral data, loading state, error state, and refresh function
 * @returns {bigint | null} collateral - User's available collateral or null if not loaded
 * @returns {bigint | null} lockedCollateral - User's locked collateral or null if not loaded
 * @returns {boolean} isLoading - True while fetching collateral data
 * @returns {Error | null} error - Error object if fetch failed, null otherwise
 * @returns {() => Promise<void>} refresh - Function to manually refresh collateral data
 */
export function useCollateral() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();

  const [collateral, setCollateral] = useState<bigint | null>(null);
  const [lockedCollateral, setLockedCollateral] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [userAccountAddress, setUserAccountAddress] = useState<Address | null>(
    null
  );

  const walletAddress = wallet?.account.address;

  // Derive User Account PDA when wallet is connected
  useEffect(() => {
    async function deriveUserAccountAddress() {
      if (!walletAddress) {
        setUserAccountAddress(null);
        setCollateral(null);
        setLockedCollateral(null);
        setIsLoading(false);
        return;
      }

      try {
        const [pda] = await getProgramDerivedAddress({
          programAddress: PERPS_PROGRAM_ADDRESS,
          seeds: [
            getBytesEncoder().encode(new Uint8Array([117, 115, 101, 114])), // "user"
            getAddressEncoder().encode(walletAddress),
          ],
        });
        console.log("User Account PDA:", pda);
        setUserAccountAddress(pda);
      } catch (err) {
        console.error("Failed to derive User Account PDA:", err);
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to derive User Account PDA")
        );
        setIsLoading(false);
      }
    }

    deriveUserAccountAddress();
  }, [walletAddress]);

  // Fetch collateral data
  const fetchCollateralData = useCallback(async () => {
    if (!userAccountAddress || !client?.runtime?.rpc) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const userAccount = await fetchUserAccount(
        client.runtime.rpc,
        userAccountAddress
      );
      setCollateral(userAccount.data.collateral);
      setLockedCollateral(userAccount.data.lockedCollateral);
    } catch (err) {
      console.error("Failed to fetch user collateral:", err);
      // If account doesn't exist yet, set to zero rather than error
      if (
        err instanceof Error &&
        err.message.includes("Account does not exist")
      ) {
        setCollateral(BigInt(0));
        setLockedCollateral(BigInt(0));
      } else {
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to fetch user collateral")
        );
        setCollateral(null);
        setLockedCollateral(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [userAccountAddress, client]);

  // Auto-fetch when address is ready
  useEffect(() => {
    if (userAccountAddress && client?.runtime?.rpc) {
      fetchCollateralData();
    }
  }, [userAccountAddress, client, fetchCollateralData]);

  return {
    collateral,
    lockedCollateral,
    isLoading,
    error,
    refresh: fetchCollateralData,
  };
}
