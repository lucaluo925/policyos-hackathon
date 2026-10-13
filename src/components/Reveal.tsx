'use client';

/**
 * Fade-and-rise on scroll into view.
 *
 * The reference site (helloclever.co) does this with no animation library at
 * all: CSS transitions toggled when a block enters the viewport, opacity
 * 0 -> 1 with translateY(16px) -> 0 over 700ms on cubic-bezier(0, 0, 0.2, 1).
 * Those numbers were read off the live page, so this matches it rather than
 * approximating it. No library here either — an IntersectionObserver and one
 * class name are the whole mechanism.
 *
 * The hidden state and the prefers-reduced-motion override live in
 * globals.css (.reveal), not here, so they apply before hydration: if the
 * JavaScript never arrives, a reader is not left looking at an element stuck
 * at opacity 0.
 *
 * Children are always rendered. Only opacity and offset change, so nothing is
 * hidden from the accessibility tree or from a crawler.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Stagger within a group, in ms. Keep it under ~240 or it stops reading as one motion. */
  delay?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, className = '' }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={shown && delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal ${shown ? 'reveal-shown' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
