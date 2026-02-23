import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getBytesEncoder,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import { getViewPositionPnlInstruction } from "../generated/perps/instructions/viewPositionPnl";
import { PERPS_PROGRAM_ADDRESS } from "../generated/perps/programs/perps";
import { getPnlInfoDecoder, type PnlInfo } from "../generated/perps/types/pnlInfo";

/**
 * Fetches the PnL breakdown for a single position by simulating the
 * on-chain `viewPositionPnl` view instruction and decoding its return data.
 * The simulation is read-only: no transaction is actually sent.
 *
 * @param tokenMint - Token mint address that identifies the position's market.
 * @returns pnl - Decoded PnlInfo (price, funding, total components), or null.
 * @returns isLoading - True while the simulation RPC call is in-flight.
 * @returns error - Last error encountered, or null.
 * @returns refresh - Manually re-runs the simulation.
 */
export function usePositionPnl(tokenMint: Address | null) {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();
  const [pnl, setPnl] = useState<PnlInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;

  const fetchPnl = useCallback(async () => {
    if (!walletAddress || !tokenMint || !client?.runtime?.rpc) {
      setPnl(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Derive position PDA (unique per user + market token mint)
      const [positionAddress] = await getProgramDerivedAddress({
        programAddress: PERPS_PROGRAM_ADDRESS,
        seeds: [
          getBytesEncoder().encode(
            new Uint8Array([112, 111, 115, 105, 116, 105, 111, 110]) // "position"
          ),
          getAddressEncoder().encode(walletAddress),
          getAddressEncoder().encode(tokenMint),
        ],
      });

      // Derive markets PDA
      const [marketsAddress] = await getProgramDerivedAddress({
        programAddress: PERPS_PROGRAM_ADDRESS,
        seeds: [
          getBytesEncoder().encode(
            new Uint8Array([109, 97, 114, 107, 101, 116, 115]) // "markets"
          ),
        ],
      });

      // Derive oracle PDA
      const [oracleAddress] = await getProgramDerivedAddress({
        programAddress: PERPS_PROGRAM_ADDRESS,
        seeds: [
          getBytesEncoder().encode(
            new Uint8Array([111, 114, 97, 99, 108, 101]) // "oracle"
          ),
        ],
      });

      // Build the read-only view instruction
      const instruction = getViewPositionPnlInstruction({
        markets: marketsAddress,
        position: positionAddress,
        oracle: oracleAddress,
        tokenMint,
      });

      // Fetch a recent blockhash so the transaction message compiles correctly
      const {
        value: { blockhash, lastValidBlockHeight },
      } = await client.runtime.rpc.getLatestBlockhash().send();

      // Build a minimal transaction message with the view instruction
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayer(walletAddress, tx),
        (tx) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash, lastValidBlockHeight },
            tx
          ),
        (tx) => appendTransactionMessageInstruction(instruction, tx)
      );

      // Compile and base64-encode (no signing needed; sigVerify: false below)
      const compiledTx = compileTransaction(message);
      const encodedTx = getBase64EncodedWireTransaction(compiledTx);

      // Simulate — this is a pure read; we skip signature verification
      const { value: sim } = await client.runtime.rpc
        .simulateTransaction(encodedTx, {
          encoding: "base64",
          sigVerify: false,
        })
        .send();

      if (sim.err) {
        throw new Error(
          `viewPositionPnl simulation failed: ${JSON.stringify(sim.err)}`
        );
      }

      if (!sim.returnData?.data?.[0]) {
        throw new Error("viewPositionPnl returned no data");
      }

      // Decode the base64 return bytes into PnlInfo.
      // The program writes raw Borsh-encoded PnlInfo via set_return_data.
      const bytes = Uint8Array.from(
        atob(sim.returnData.data[0])
          .split("")
          .map((c) => c.charCodeAt(0))
      );

      // getPnlInfoDecoder().read(bytes, offset) → [PnlInfo, newOffset]
      const [pnlInfo] = getPnlInfoDecoder().read(bytes, 0);
      setPnl(pnlInfo);
    } catch (err) {
      console.error("usePositionPnl error:", err);
      setError(
        err instanceof Error ? err : new Error("Failed to fetch position PnL")
      );
      setPnl(null);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, tokenMint, client]);

  useEffect(() => {
    fetchPnl();
  }, [fetchPnl]);

  return { pnl, isLoading, error, refresh: fetchPnl };
}
