import {
  getAddressEncoder,
  getBytesEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps/programs/perps";

/**
 * Derives the position PDA for a given wallet and token mint.
 * @param wallet - User's wallet address.
 * @param tokenMint - Token mint address of the market.
 * @returns Derived position PDA address.
 */
export async function derivePositionPda(
  wallet: Address,
  tokenMint: Address
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERPS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(
        new Uint8Array([112, 111, 115, 105, 116, 105, 111, 110]) // "position"
      ),
      getAddressEncoder().encode(wallet),
      getAddressEncoder().encode(tokenMint),
    ],
  });
  return pda;
}

/**
 * Derives the protocol config PDA.
 * @returns Derived config PDA address.
 */
export async function deriveConfigPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERPS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(new Uint8Array([99, 111, 110, 102, 105, 103])), // "config"
    ],
  });
  return pda;
}

/**
 * Derives the vault PDA.
 * @returns Derived vault PDA address.
 */
export async function deriveVaultPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERPS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(new Uint8Array([118, 97, 117, 108, 116])), // "vault"
    ],
  });
  return pda;
}

/**
 * Derives the per-user collateral token account PDA.
 * @param wallet - User's wallet address.
 * @returns Derived user collateral PDA address.
 */
export async function deriveUserCollateralPda(
  wallet: Address
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PERPS_PROGRAM_ADDRESS,
    seeds: [
      // "user_collateral"
      getBytesEncoder().encode(
        new Uint8Array([117, 115, 101, 114, 95, 99, 111, 108, 108, 97, 116, 101, 114, 97, 108])
      ),
      getAddressEncoder().encode(wallet),
    ],
  });
  return pda;
}
