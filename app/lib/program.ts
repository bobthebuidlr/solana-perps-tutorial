import { type Address } from "@solana/kit";
import idl from "../../anchor/target/idl/perps.json";

/**
 * Program address read from the Anchor IDL so it stays in sync after `anchor build`.
 * @returns The on-chain program address.
 */
export const PERPS_PROGRAM_ADDRESS = idl.address as Address;
