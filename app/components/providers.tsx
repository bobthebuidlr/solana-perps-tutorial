"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SolanaProvider } from "@solana/react-hooks";
import { PropsWithChildren } from "react";

import { autoDiscover, createClient } from "@solana/client";

const client = createClient({
  endpoint: "http://localhost:8899",
  walletConnectors: autoDiscover(),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
});

export function Providers({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaProvider client={client}>{children}</SolanaProvider>
    </QueryClientProvider>
  );
}
