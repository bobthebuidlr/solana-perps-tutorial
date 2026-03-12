import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { useCallback, useEffect, useState } from "react";
import { getViewPositionPnlInstruction } from "../generated/perps/instructions/viewPositionPnl";
import { type PnlInfo } from "../generated/perps/types/pnlInfo";
import { getPositionInfoDecoder } from "../generated/perps/types/positionInfo";
import { derivePositionPda } from "../lib/pdas";
import { useMarketsPda, useOraclePda } from "./usePdas";

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
  const marketsAddress = useMarketsPda();
  const oracleAddress = useOraclePda();
  const [pnl, setPnl] = useState<PnlInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const walletAddress = wallet?.account.address;

  const fetchPnl = useCallback(async () => {
    if (!walletAddress || !tokenMint || !client?.runtime?.rpc || !marketsAddress || !oracleAddress) {
      setPnl(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Derive position PDA (unique per user + market token mint)
      const positionAddress = await derivePositionPda(walletAddress, tokenMint);

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

      // The program returns the full PositionInfo struct (size + direction +
      // entryPrice + pnlInfo). Decode from offset 0 and extract pnlInfo.
      const [positionInfo] = getPositionInfoDecoder().read(bytes, 0);
      setPnl(positionInfo.pnlInfo);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Failed to fetch position PnL")
      );
      setPnl(null);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, tokenMint, client, marketsAddress, oracleAddress]);

  useEffect(() => {
    fetchPnl();
  }, [fetchPnl]);

  // Auto-refresh PnL every 5 seconds when we have a position
  useEffect(() => {
    if (!tokenMint || !walletAddress) return;
    
    const interval = setInterval(() => {
      fetchPnl();
    }, 5000);

    return () => clearInterval(interval);
  }, [tokenMint, walletAddress, fetchPnl]);

  return { pnl, isLoading, error, refresh: fetchPnl };
}
