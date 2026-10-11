import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Source_Serif_4,
  STIX_Two_Math,
} from "next/font/google";

import { LookProvider } from "@/components/look-provider";

import "./globals.css";

const uiSans = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const readingSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

// MathML needs a math font; many systems have none. Loaded only where math shows.
const mathFont = STIX_Two_Math({
  variable: "--font-math",
  weight: "400",
  adjustFontFallback: false,
});

const uiMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const lookBootstrap = `(function(){try{var v=localStorage.getItem("omni-look");var look=v==="day"||v==="night"?v:(v==="thea"||v==="remnote"?"day":"night");var el=document.documentElement;el.setAttribute("data-look",look);el.classList.toggle("dark",look==="night");}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Omni-Reviewer demo",
  description:
    "Try Omni-Reviewer with three sample OpenStax Microbiology packs: Locked In, Summary, Test Me and Carded. No sign-in needed.",
  applicationName: "Omni-Reviewer demo",
};

// Day look `--background: #ffffff`; Night look `--background:
// oklch(0.14 0.025 250)` converted to hex (app/globals.css).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#030a13" },
  ],
  viewportFit: "cover",
};

const OPENSTAX_BOOK_URL = "https://openstax.org/details/books/microbiology";

/** Pack attribution, on every page (the packs are CC BY-NC-SA 4.0). */
function AttributionFooter() {
  return (
    <footer className="border-t border-border/70 bg-chrome/60">
      <p className="mx-auto w-full max-w-5xl px-4 py-4 text-xs leading-relaxed text-muted-foreground sm:px-6">
        Sample content adapted from OpenStax <em>Microbiology</em> (Rice University), CC BY-NC-SA 4.0. Access for free at{" "}
        <a
          href={OPENSTAX_BOOK_URL}
          className="rounded text-foreground underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          openstax.org
        </a>
        .
      </p>
    </footer>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-look="night"
      className={`dark ${uiSans.variable} ${readingSerif.variable} ${uiMono.variable} ${mathFont.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans">
        <Script id="omni-look" strategy="beforeInteractive">
          {lookBootstrap}
        </Script>
        <LookProvider>
          <div className="flex min-h-full flex-1 flex-col">{children}</div>
          <AttributionFooter />
        </LookProvider>
      </body>
    </html>
  );
}
