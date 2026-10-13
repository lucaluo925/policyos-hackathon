/**
 * Line icons for the homepage feature cards.
 *
 * These replaced emoji. Emoji render differently on every platform, carry a
 * colour palette nobody chose, and read as a placeholder — which is the wrong
 * signal on the one page where the product makes its first impression. Inline
 * SVG costs no request, inherits `currentColor`, and stays sharp at any DPR.
 */

import type { ReactNode } from 'react';

export type FeatureIconName = 'map' | 'markets' | 'metrics' | 'feed' | 'extract' | 'history';

const PATHS: Record<FeatureIconName, ReactNode> = {
  map: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
    </>
  ),
  markets: (
    <>
      <path d="M3 17l5-5 3.5 3.5L21 6" />
      <path d="M21 11V6h-5" />
    </>
  ),
  metrics: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  feed: (
    <>
      <path d="M4 11a9 9 0 019 9M4 4a16 16 0 0116 16" />
      <circle cx="5" cy="19" r="1.5" />
    </>
  ),
  extract: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5M9 10h4M9 13h2.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.5 8.5 0 005.6 6.4" />
      <path d="M5 3v4h4M12 7.5V12l3 2" />
    </>
  ),
};

export function FeatureIcon({ name }: { name: FeatureIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
