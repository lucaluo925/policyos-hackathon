import type { Metadata, Viewport } from "next";
import ErrorBoundary from '@/components/osiris/ErrorBoundary';
import "./globals.css";

/*
 * Root layout for the OSIRIS intelligence module.
 *
 * This is a separate root layout from the PolicyOS one in `src/app/(policyos)`:
 * the OSIRIS dashboard is a full-viewport dark WebGL surface whose stylesheet
 * redefines `:root`, `*` and `html, body`, so it cannot share PolicyOS's global
 * CSS layer. Route groups keep the two stylesheets in separate chunks.
 * Navigating between `/osiris` and the rest of the site is a full page load,
 * which is expected with multiple root layouts.
 *
 * Upstream: carbon-evolution/osiris (MIT). The upstream layout's site identity
 * — metadataBase, canonical URL, Open Graph / Twitter cards and JSON-LD, all
 * pointing at osirisai.live and crediting the Osiris Project — has been removed
 * rather than copied, so this deployment does not publish another site's
 * canonical URL or authorship. See THIRD_PARTY_NOTICES.md for attribution.
 */

export const viewport: Viewport = {
  themeColor: "#1A73E8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: {
    default: "Intelligence Map — PolicyOS",
    template: "%s | PolicyOS Intelligence Map",
  },
  description:
    "Real-time intelligence map: live flight and satellite tracking, CCTV networks, earthquake and wildfire monitoring, conflict and infrastructure layers, cyber-threat feeds and OSINT lookups on a single WebGL globe.",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  category: "technology",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#06060C",
    "msapplication-config": "none",
  },
};

export default function OsirisRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        <ErrorBoundary name="OSIRIS Core">
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
