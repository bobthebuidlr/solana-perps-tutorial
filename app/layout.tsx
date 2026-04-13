import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
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
  title: "Perps Dex",
  description: "On-chain perpetual futures trading on Solana",
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
      <body
        suppressHydrationWarning
        className={`${inter.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <nav className="sticky top-0 z-40 flex justify-between items-center py-2 px-10 border-b border-border-low bg-card/80 backdrop-blur-md">
            <h1 className="text-lg font-bold tracking-tight">Perps Dex</h1>
            <WalletConnectButton />
          </nav>
          {children}
        </Providers>
      </body>
    </html>
  );
}
