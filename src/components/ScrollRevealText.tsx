'use client';

/**
 * A statement paragraph whose words darken one by one as it scrolls past.
 *
 * Copied in mechanism, not in markup, from helloclever.co/travel, measured off
 * the live page rather than eyeballed: each word is its own bare <span>,
 * unlit words sit at rgb(155,155,157), lit words at rgb(28,28,30), with a CSS
 * transition on colour. The type there is bold, 26 / 32 / 40px with
 * leading 1.6. No animation library is involved on that site, and none here.
 *
 * Two deliberate differences from a naive version:
 *
 * 1. Words render DARK until the effect initialises, not light. If the
 *    JavaScript never runs, or runs late, a reader sees full-contrast text
 *    instead of a paragraph of grey at 2.6:1. The dimming is something the
 *    effect opts into, never something a reader has to wait for.
 * 2. State only changes when the word COUNT changes, not on every scroll
 *    event, so a fast scroll through a 40-word paragraph re-renders at most
 *    40 times rather than once per frame.
 *
 * prefers-reduced-motion is handled in globals.css: the colour is pinned and
 * the transition removed, so no word ever moves or fades for those readers.
 */

import { useEffect, useRef, useState } from 'react';
import { revealProgress } from '@/lib/motion/scroll-progress';

interface ScrollRevealTextProps {
  text: string;
  className?: string;
}

/** -1 means "not initialised yet": every word renders at full contrast. */
const UNINITIALISED = -1;

export function ScrollRevealText({ text, className = '' }: ScrollRevealTextProps) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [litCount, setLitCount] = useState(UNINITIALISED);
  // Split keeps the whitespace runs as their own chunks so the original
  // spacing survives. Each chunk carries the running word index, computed
  // without mutating anything during render — the lists are ~50 items, so the
  // quadratic count costs nothing and stays obviously correct.
  const parts = text.split(/(\s+)/);
  const chunks = parts.map((chunk, i) => ({
    chunk,
    isWord: chunk.trim().length > 0,
    wordIndex: parts.slice(0, i + 1).filter((c) => c.trim().length > 0).length,
  }));
  const wordCount = chunks.length ? chunks[chunks.length - 1].wordIndex : 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let last = UNINITIALISED;

    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const next = Math.round(revealProgress(rect.top, rect.height, vh) * wordCount);
      if (next !== last) {
        last = next;
        setLitCount(next);
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    // Deferred rather than called straight from the effect body, so the first
    // measurement happens after layout with real geometry.
    frame = requestAnimationFrame(measure);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [wordCount]);

  return (
    <p
      ref={ref}
      className={`m-0 max-w-[1060px] whitespace-pre-line text-[26px] font-bold leading-[1.6] md:text-[32px] lg:text-[40px] ${className}`}
    >
      {chunks.map(({ chunk, isWord, wordIndex }, i) => {
        if (!isWord) return <span key={i}>{chunk}</span>;
        const lit = litCount === UNINITIALISED || wordIndex <= litCount;
        return (
          <span key={i} className={lit ? 'word-lit' : 'word-dim'}>
            {chunk}
          </span>
        );
      })}
    </p>
  );
}
