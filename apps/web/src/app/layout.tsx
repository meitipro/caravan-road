import type { Metadata, Viewport } from "next";
import { Inter, Pixelify_Sans, Vazirmatn } from "next/font/google";
import localFont from "next/font/local";
import "../ui/tokens.css";
import "../ui/globals.css";
import "../ui/screens.css";

// Fonts (all open licenses): Pixelify Sans and Inter and Vazirmatn are SIL OFL 1.1.
const pixelify = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixelify", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const vazirmatn = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-vazirmatn", display: "swap" });

// Digits inside pixel-font text. The Pixelify Sans "5" reads as an "S" and 1/7 are ambiguous, so this
// face (Inter, tabular figures) is declared for U+0030-0039 only and listed FIRST in --font-pixel in
// tokens.css: the browser takes digits from it and every other character from Pixelify Sans.
// src/ui/fonts.test.ts guards this wiring.
const digits = localFont({
  src: [{ path: "../ui/fonts/inter-latin-digits.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-digits",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0030-0039" }],
});

export const metadata: Metadata = {
  title: "Caravan Road",
  description: "Trade across the desert. Outwit the merchants. Keep what you earn.",
  // No favicon.ico ships, so browsers requested it and logged a 404 on every page.
  icons: { icon: "/assets/ui/coin.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b1f2b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${digits.variable} ${pixelify.variable} ${inter.variable} ${vazirmatn.variable}`}>
      <body>{children}</body>
    </html>
  );
}
