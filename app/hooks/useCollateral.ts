import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import { fetchUserAccount } from "../generated/perps/accounts/userAccount";
import { useUserAccountPda } from "./usePdas";

export function useCollateral() {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();

  const [collateral, setCollateral] = useState<bigint | null>(null);
  const [lockedCollateral, setLockedCollateral] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;
  const userAccountAddress = useUserAccountPda(walletAddress);

  // Fetch collateral data
  const fetchCollateralData = useCallback(
    async (silent = false) => {
      console.log(
        "user account address",
        !userAccountAddress || !client?.runtime?.rpc
      );
      if (!userAccountAddress || !client?.runtime?.rpc) {
        if (!walletAddress) {
          setCollateral(null);
          setLockedCollateral(null);
          if (!silent) setIsLoading(false);
        }
        return;
      }

      console.log(silent);

      if (!silent) setIsLoading(true);
      setError(null);

      try {
        console.log("fetching user account");
        const userAccount = await fetchUserAccount(
          client.runtime.rpc,
          userAccountAddress
        );

        console.log("user account", userAccount.data);
        // The collateral field is the TOTAL collateral
        // Available = Total - Locked
        const totalCollateral = userAccount.data.collateral;
        const locked = userAccount.data.lockedCollateral;
        const available =
          totalCollateral > locked ? totalCollateral - locked : 0n;

        setCollateral(available); // Set to available, not total
        setLockedCollateral(locked);
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
        if (!silent) setIsLoading(false);
      }
    },
    [userAccountAddress, walletAddress, client]
  );

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
