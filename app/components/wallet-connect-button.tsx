"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useState } from "react";
import { Dialog } from "./ui";

/**
 * Wallet connect/disconnect button for the nav bar.
 */
export function WalletConnectButton() {
  const [open, setOpen] = useState(false);
  const { disconnect, wallet, status } = useWalletConnection();

  if (status === "connected") {
    const addr = wallet?.account.address.toString() ?? "";
    return (
      <button
        onClick={() => disconnect()}
        className="inline-flex items-center gap-2 rounded-lg border border-border-low bg-surface px-3 py-2 text-sm font-medium transition hover:border-border-strong hover:bg-surface-hover cursor-pointer"
      >
        <span className="h-2 w-2 rounded-full bg-long" />
        {addr.slice(0, 4)}\u2026{addr.slice(-4)}
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border-low bg-surface px-3 py-2 text-sm font-medium transition hover:border-border-strong hover:bg-surface-hover cursor-pointer"
      >
        Connect Wallet
      </button>

      {open && <WalletSelectDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Modal dialog for selecting a wallet connector.
 * @param onClose - Callback when the dialog is dismissed.
 */
function WalletSelectDialog({ onClose }: { onClose: () => void }) {
  const { connectors, connect, wallet, status } = useWalletConnection();

  return (
    <Dialog onClose={onClose} title="Connect a Wallet">
      <div className="grid gap-3 sm:grid-cols-2">
        {connectors.map((connector) => (
          <button
            key={connector.id}
            onClick={() => connect(connector.id)}
            disabled={status === "connecting"}
            className="group flex items-center justify-between rounded-xl border border-border-low bg-surface px-4 py-3 text-left text-sm font-medium transition hover:border-border-strong hover:bg-surface-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex flex-col">
              <span className="text-base">{connector.name}</span>
              <span className="text-xs text-muted">
                {status === "connecting"
                  ? "Connecting\u2026"
                  : status === "connected" && wallet?.connector.id === connector.id
                    ? "Active"
                    : "Tap to connect"}
              </span>
            </span>
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full bg-border-low transition group-hover:bg-primary/80"
            />
          </button>
        ))}
      </div>
    </Dialog>
  );
}
