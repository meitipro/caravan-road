import type { Metadata, Viewport } from "next";
import { Inter, Pixelify_Sans, Vazirmatn } from "next/font/google";
import "../ui/tokens.css";
import "../ui/globals.css";
import "../ui/screens.css";

// Fonts (all open licenses): Pixelify Sans and Inter and Vazirmatn are SIL OFL 1.1.
const pixelify = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixelify", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const vazirmatn = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-vazirmatn", display: "swap" });

export const metadata: Metadata = {
  title: "Caravan Road",
  description: "Trade across the desert. Outwit the merchants. Keep what you earn.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b1f2b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${pixelify.variable} ${inter.variable} ${vazirmatn.variable}`}>
      <body>{children}</body>
    </html>
  );
}
