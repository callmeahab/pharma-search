import { Toaster } from "../components/ui/toaster";
import { Toaster as Sonner } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { ThemeProvider } from "../contexts/ThemeContext";
import { WishlistProvider } from "../contexts/WishlistContext";
import CookieConsent from "../components/CookieConsent";
import { Analytics } from "../components/Analytics";
import { Providers } from "../components/Providers";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apošteka",
  description:
    "Pronađite najbolje cene za zdravstvene suplemente, vitamine i farmaceutske proizvode u više prodavnica.",
  keywords:
    "apoteka, lekovi, vitamini, suplementi, zdravstveni proizvodi, uporedjivanje cena, online kupovina, farmaceutski proizvodi, zdrava ishrana, wellness, dijetetski suplementi, prirodni lekovi, medicinski proizvodi, apotekarske usluge, zdravlje i nega",
  authors: [{ name: "Kumovi" }],
  openGraph: {
    title: "Apošteka - Uporedi cene lekova i suplemenata",
    description:
      "Pronađite najbolje cene za zdravstvene suplemente, vitamine i farmaceutske proizvode u više prodavnica.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col dark:bg-gray-900 dark:text-gray-100 transition-colors duration-200">
        <Providers>
          <ThemeProvider>
            <WishlistProvider>
              <TooltipProvider>
                <Analytics />
                {children}
                <Toaster />
                <Sonner />
                <CookieConsent />
              </TooltipProvider>
            </WishlistProvider>
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}