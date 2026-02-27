import {
  getBytesEncoder,
  getProgramDerivedAddress,
  getAddressEncoder,
  type Address,
} from "@solana/kit";
import { useSendTransaction, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps";
import { getDepositCollateralInstructionDataEncoder } from "../generated/perps/instructions/depositCollateral";

const TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111" as Address;

/**
 * Custom hook to deposit collateral into the user's perps account.
 *
 * @returns {Object} Object containing deposit function, loading state, and error state
 * @returns {(amount: number, userTokenAccount: Address) => Promise<string | null>} deposit - Function to deposit collateral
 * @returns {boolean} isLoading - True while deposit transaction is processing
 * @returns {Error | null} error - Error object if deposit failed, null otherwise
 */
export function useDeposit() {
  const { send } = useSendTransaction();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { wallet } = useWalletConnection();

  const walletAddress = wallet?.account.address;

  const deposit = useCallback(
    async (amount: number, userTokenAccount: Address) => {
      if (!walletAddress || !wallet) {
        console.error("❌ Deposit Error: No wallet connected");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Derive userAccount PDA
        const [userAccountAddress] = await getProgramDerivedAddress({
          programAddress: PERPS_PROGRAM_ADDRESS,
          seeds: [
            getBytesEncoder().encode(new Uint8Array([117, 115, 101, 114])), // "user"
            getAddressEncoder().encode(walletAddress),
          ],
        });

        // Derive vault PDA
        const [vaultAddress] = await getProgramDerivedAddress({
          programAddress: PERPS_PROGRAM_ADDRESS,
          seeds: [
            getBytesEncoder().encode(new Uint8Array([118, 97, 117, 108, 116])), // "vault"
          ],
        });

        console.log("🔍 Deposit Debug Info:", {
          user: walletAddress,
          userAccount: userAccountAddress,
          userTokenAccount,
          vault: vaultAddress,
          amount,
        });

        // Manually construct instruction with all 6 required accounts
        // This matches the Rust program's DepositCollateral struct
        const instruction = {
          programAddress: PERPS_PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddress, role: 3 },         // user (WritableSigner)
            { address: userAccountAddress, role: 1 },    // userAccount (Writable, PDA with init_if_needed)
            { address: userTokenAccount, role: 1 },      // userTokenAccount (Writable)
            { address: vaultAddress, role: 1 },          // vault (Writable)
            { address: TOKEN_PROGRAM_ADDRESS, role: 0 }, // tokenProgram (Readonly)
            { address: SYSTEM_PROGRAM_ADDRESS, role: 0 },// systemProgram (Readonly, needed for init_if_needed)
          ],
          data: getDepositCollateralInstructionDataEncoder().encode({
            amount: BigInt(Math.floor(amount)),
          }),
        };

        console.log("📋 Instruction has", instruction.accounts.length, "accounts");
        console.log("📋 Account details:");
        instruction.accounts.forEach((acc, idx) => {
          const names = ["user", "userAccount", "userTokenAccount", "vault", "tokenProgram", "systemProgram"];
          console.log(`  [${idx}] ${names[idx]}: ${acc.address} (role: ${acc.role})`);
        });

        const signature = await send(
          { instructions: [instruction] },
          { skipPreflight: true },
        );

        console.log("✅ Deposit successful! Signature:", signature);
        return signature;
      } catch (err) {
        console.error("❌ Deposit failed with error:", err);
        if (err instanceof Error) {
          console.error("Error message:", err.message);
          console.error("Error stack:", err.stack);
        }
        setError(err instanceof Error ? err : new Error("Deposit failed"));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [send, walletAddress, wallet]
  );

  return {
    deposit,
    isLoading,
    error,
  };
}
