"use client";
import { useWalletConnection } from "@solana/react-hooks";
import { useState } from "react";

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
        {addr.slice(0, 4)}…{addr.slice(-4)}
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

function WalletSelectDialog({ onClose }: { onClose: () => void }) {
  const { connectors, connect, wallet, status } = useWalletConnection();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border-low bg-card-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Connect a Wallet</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted transition hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>

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
                    ? "Connecting…"
                    : status === "connected" &&
                        wallet?.connector.id === connector.id
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
      </div>
    </div>
  );
}
