import {
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { useWalletConnection } from "@solana/react-hooks";
import { useEffect, useState } from "react";

const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;

/**
 * Custom hook to derive the user's associated token account (ATA) for a given mint.
 *
 * @param {Address} mint - The token mint address
 * @returns {Address | null} The associated token account address or null if wallet not connected
 */
export function useTokenAccount(mint: Address): Address | null {
  const { wallet } = useWalletConnection();
  const [ata, setAta] = useState<Address | null>(null);

  const walletAddress = wallet?.account.address;

  useEffect(() => {
    async function deriveATA() {
      if (!walletAddress || !mint) {
        setAta(null);
        return;
      }

      try {
        const [ataAddress] = await getProgramDerivedAddress({
          programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
          seeds: [
            getAddressEncoder().encode(walletAddress),
            getAddressEncoder().encode(TOKEN_PROGRAM_ID),
            getAddressEncoder().encode(mint),
          ],
        });
        console.log("Derived ATA:", ataAddress);
        setAta(ataAddress);
      } catch (err) {
        console.error("Failed to derive ATA:", err);
        setAta(null);
      }
    }

    deriveATA();
  }, [walletAddress, mint]);

  return ata;
}
