/**
 * Is a scheduled review still ahead, or already overdue?
 *
 * The country page rendered `nextScheduledCheck` as "Next scheduled check:
 * <date>". That value is the earliest `nextReviewAt` across a country's
 * curated lifecycles, and those are laid out relative to the fixture's
 * reference date of 2026-04-17. Measured against production on 2026-10-10,
 * every country page was therefore announcing a *next* check that had
 * already passed:
 *
 *   US 2026-04-19   GB 2026-02-18   DE 2026-03-20
 *   CN 2026-03-08   CA 2026-04-20
 *
 * between six and eight months earlier. The same family as the rest of this
 * codebase's corrections: a figure computed from a fixed fixture, presented
 * as a forward-looking claim.
 *
 * Inventing a future date would be worse. A curated record that has not been
 * reviewed since April is overdue, and saying so is both true and more
 * informative than a date. The live pipelines check their sources daily and
 * are reported separately, so the two cannot be confused.
 */

export type ReviewSchedule =
  | { state: 'scheduled'; date: string; days: number }
  | { state: 'overdue'; date: string; days: number }
  | { state: 'unknown' };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `date` is the ISO day in both states, so a caller can always show it; the
 * state decides whether it is a promise or a debt.
 */
export function reviewSchedule(
  nextReviewAt: string | null | undefined,
  now: number = Date.now(),
): ReviewSchedule {
  if (!nextReviewAt) return { state: 'unknown' };
  const at = new Date(nextReviewAt).getTime();
  if (Number.isNaN(at)) return { state: 'unknown' };
  const days = Math.floor(Math.abs(now - at) / DAY_MS);
  const date = new Date(at).toISOString().slice(0, 10);
  return at >= now ? { state: 'scheduled', date, days } : { state: 'overdue', date, days };
}
