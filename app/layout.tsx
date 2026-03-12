import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Markets, MarketsList, OrderForm } from "./components/markets";
import { PositionsTable } from "./components/positions-table";
import { AccountOverview } from "./components/account-overview";
import { Providers } from "./components/providers";
import { WalletConnectButton } from "./components/wallet-connect-button";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Solana dApp Starter",
  description: "A minimal Next.js starter powered by @solana/react-hooks",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <Providers>
        <body
          suppressHydrationWarning
          className={`${inter.variable} ${geistMono.variable} antialiased`}
        >
          <div>
            <nav className="flex justify-between items-center py-2 px-10 border-b">
              <h1 className="text-2xl font-bold">Perps Dex</h1>
              <WalletConnectButton />
            </nav>
          </div>
          <div className="grid grid-cols-2 gap-4 p-4">
            {/* Top row: Markets list and Order form */}
            <Markets />
            {/* Bottom row: Positions table and Account overview */}
            <PositionsTable />
            <AccountOverview />
          </div>
        </body>
      </Providers>
    </html>
  );
}
