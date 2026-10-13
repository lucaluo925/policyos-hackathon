/**
 * Whether a monitored source is actually working.
 *
 * The country page used to report only `lastCheckedAt`, which is stamped on
 * every attempt including the ones that fail. A source that has returned
 * HTTP 404 on all 170 of its attempts therefore displayed as "Last checked
 * today", under a tile headed "Live pipelines". The page was asserting a
 * freshness it did not have, which in a product about checking claims
 * against sources is the worst thing it can get wrong.
 *
 * `lastSuccessAt` and `consecutiveFails` are the fields that carry the
 * truth, and this turns them into something a page can show.
 */

export type SourceHealthState = 'healthy' | 'failing' | 'never_succeeded';

export interface SourceHealth {
  state: SourceHealthState;
  /** One line for the page; null when there is nothing to warn about. */
  label: string | null;
  daysSinceSuccess: number | null;
}

/**
 * A single missed check is ordinary — sites rate-limit and time out — so a
 * warning needs either a run of failures or a genuinely stale last success
 * before it earns the reader's attention. Below that the data is still
 * yesterday's, which is what the schedule promises anyway.
 */
export const FAIL_RUN_THRESHOLD = 3;
export const STALE_DAYS_THRESHOLD = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysSince(date: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / DAY_MS);
}

export function sourceHealth(
  source: { lastSuccessAt?: Date | string | null; consecutiveFails?: number | null },
  now: Date = new Date(),
): SourceHealth {
  const fails = source.consecutiveFails ?? 0;
  const days = daysSince(source.lastSuccessAt, now);

  if (days === null) {
    return {
      state: 'never_succeeded',
      label:
        fails > 0
          ? `Never fetched successfully — ${fails} failed attempts`
          : 'Never fetched successfully',
      daysSinceSuccess: null,
    };
  }

  if (fails >= FAIL_RUN_THRESHOLD || days >= STALE_DAYS_THRESHOLD) {
    const age = days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
    return {
      state: 'failing',
      label: `Not reachable — last successful fetch ${age}, ${fails} failed attempts since`,
      daysSinceSuccess: days,
    };
  }

  return { state: 'healthy', label: null, daysSinceSuccess: days };
}
