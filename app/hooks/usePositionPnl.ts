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
import { useQuery } from "@tanstack/react-query";
import { useSolanaClient, useWalletConnection } from "@solana/react-hooks";
import { getViewPositionPnlInstruction } from "../generated/perps/instructions/viewPositionPnl";
import { type PnlInfo } from "../generated/perps/types/pnlInfo";
import { getPositionInfoDecoder } from "../generated/perps/types/positionInfo";
import { derivePositionPda } from "../lib/pdas";
import { useMarketsPda, useOraclePda } from "./usePdas";

/**
 * Fetches the PnL breakdown for a single position by simulating the
 * on-chain `viewPositionPnl` view instruction and decoding its return data.
 * The simulation is read-only: no transaction is actually sent.
 * Uses React Query for caching and 5-second auto-refresh.
 *
 * @param tokenMint - Token mint address that identifies the position's market.
 * @returns pnl - Decoded PnlInfo (price, funding, total components), or null.
 * @returns isLoading - True while the simulation RPC call is in-flight.
 * @returns error - Last error encountered, or null.
 */
export function usePositionPnl(tokenMint: Address | null) {
  const client = useSolanaClient();
  const { wallet } = useWalletConnection();
  const marketsAddress = useMarketsPda();
  const oracleAddress = useOraclePda();

  const walletAddress = wallet?.account.address;

  const { data, isLoading, error } = useQuery({
    queryKey: ["positionPnl", tokenMint ?? "none"],
    queryFn: async (): Promise<PnlInfo | null> => {
      if (!walletAddress || !tokenMint || !client?.runtime?.rpc || !marketsAddress || !oracleAddress) {
        return null;
      }

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
      return positionInfo.pnlInfo;
    },
    enabled: !!walletAddress && !!tokenMint && !!client?.runtime?.rpc && !!marketsAddress && !!oracleAddress,
    refetchInterval: 5000,
  });

  return {
    pnl: data ?? null,
    isLoading,
    error: error as Error | null,
  };
}
