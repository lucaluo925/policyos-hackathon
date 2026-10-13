/**
 * Scroll-position maths for the reading-paced text reveal.
 *
 * This lives in lib rather than inside the component so it can be asserted on
 * directly. Reading a progress curve off a scrolling page by eye is the kind
 * of check that looks convincing and proves nothing — the failure it would
 * miss is a curve that merely approaches 1 without reaching it, which leaves
 * the last words of every paragraph permanently grey.
 */

/**
 * How far through its reveal an element is, clamped to 0..1.
 *
 * Begins when the element's top reaches 85% of the viewport height, and
 * completes once it has travelled its own height plus half a screen beyond
 * that. Scaling the distance by the element's height means a long paragraph
 * takes proportionally longer to light up than a short one, and neither
 * finishes while still below the fold.
 *
 * @param top              element's top edge relative to the viewport
 * @param height           element's height
 * @param viewportHeight   visible viewport height
 */
export function revealProgress(top: number, height: number, viewportHeight: number): number {
  const total = height + viewportHeight * 0.5;
  if (total <= 0) return 1;
  const travelled = viewportHeight * 0.85 - top;
  return Math.min(1, Math.max(0, travelled / total));
}
