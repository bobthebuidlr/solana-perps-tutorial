import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { useEffect, useState } from "react";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps/programs/perps";

/**
 * Derives and caches the protocol config PDA on mount.
 * @returns Config PDA address, or null while deriving.
 */
export function useConfigPda(): Address | null {
  const [pda, setPda] = useState<Address | null>(null);

  useEffect(() => {
    getProgramDerivedAddress({
      programAddress: PERPS_PROGRAM_ADDRESS,
      seeds: [
        getBytesEncoder().encode(
          new Uint8Array([99, 111, 110, 102, 105, 103]) // "config"
        ),
      ],
    }).then(([derived]) => setPda(derived));
  }, []);

  return pda;
}

/**
 * Derives and caches the markets PDA on mount.
 * @returns Markets PDA address, or null while deriving.
 */
export function useMarketsPda(): Address | null {
  const [pda, setPda] = useState<Address | null>(null);

  useEffect(() => {
    getProgramDerivedAddress({
      programAddress: PERPS_PROGRAM_ADDRESS,
      seeds: [
        getBytesEncoder().encode(
          new Uint8Array([109, 97, 114, 107, 101, 116, 115]) // "markets"
        ),
      ],
    }).then(([derived]) => setPda(derived));
  }, []);

  return pda;
}

/**
 * Derives and caches the oracle PDA on mount.
 * @returns Oracle PDA address, or null while deriving.
 */
export function useOraclePda(): Address | null {
  const [pda, setPda] = useState<Address | null>(null);

  useEffect(() => {
    getProgramDerivedAddress({
      programAddress: PERPS_PROGRAM_ADDRESS,
      seeds: [
        getBytesEncoder().encode(
          new Uint8Array([111, 114, 97, 99, 108, 101]) // "oracle"
        ),
      ],
    }).then(([derived]) => setPda(derived));
  }, []);

  return pda;
}

/**
 * Derives and caches the per-user collateral token account PDA.
 * @param walletAddress - Connected wallet address, or undefined if not connected.
 * @returns User collateral PDA address, or null if wallet is not connected or PDA is still deriving.
 */
export function useUserCollateralPda(walletAddress?: Address): Address | null {
  const [pda, setPda] = useState<Address | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setPda(null);
      return;
    }

    getProgramDerivedAddress({
      programAddress: PERPS_PROGRAM_ADDRESS,
      seeds: [
        // "user_collateral"
        getBytesEncoder().encode(
          new Uint8Array([117, 115, 101, 114, 95, 99, 111, 108, 108, 97, 116, 101, 114, 97, 108])
        ),
        getAddressEncoder().encode(walletAddress),
      ],
    }).then(([derived]) => setPda(derived));
  }, [walletAddress]);

  return pda;
}

/**
 * Derives and caches the user account PDA for the given wallet address.
 * @param walletAddress - Connected wallet address, or undefined if not connected.
 * @returns User account PDA address, or null if wallet is not connected or PDA is still deriving.
 */
export function useUserAccountPda(walletAddress?: Address): Address | null {
  const [pda, setPda] = useState<Address | null>(null);

  console.log("user account pda", pda);

  useEffect(() => {
    if (!walletAddress) {
      setPda(null);
      return;
    }

    getProgramDerivedAddress({
      programAddress: PERPS_PROGRAM_ADDRESS,
      seeds: [
        getBytesEncoder().encode(new Uint8Array([117, 115, 101, 114])), // "user"
        getAddressEncoder().encode(walletAddress),
      ],
    }).then(([derived]) => setPda(derived));
  }, [walletAddress]);

  return pda;
}
