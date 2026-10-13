/**
 * Earliest documented public-availability instant for an FR document.
 *
 * Two sources, in order of preference:
 *   1. Public Inspection `filed_at` — the document is readable on
 *      federalregister.gov from this moment, usually the business day
 *      *before* publication.
 *   2. Publication date at 06:00 America/New_York — conservative fallback
 *      when no public-inspection record is found.
 *
 * Known remaining bias (documented, not fixed here): agencies sometimes issue
 * press releases before public inspection. That disclosure is not captured,
 * so the true event can be earlier than `eventInstant`; the research layer
 * should include a pre-event window (e.g. [-1, +1]) to catch leakage.
 */

import type { EventTimeSource } from './types';

/** Offset (minutes, local − UTC) of `timeZone` at the given UTC instant. */
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

/** Convert a wall-clock time in `timeZone` to a UTC Date (DST-aware). */
export function zonedWallTimeToUtc(
  dateYmd: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wall - tzOffsetMinutes(wall, timeZone) * 60000;
  // Second pass settles DST-boundary cases.
  guess = wall - tzOffsetMinutes(guess, timeZone) * 60000;
  return new Date(guess);
}

export function publicationInstant(publicationDate: string): Date {
  return zonedWallTimeToUtc(publicationDate, 6, 0, 'America/New_York');
}

export function earliestInstant(
  publicationDate: string,
  publicInspectionFiledAt: string | null,
): { instant: Date; source: EventTimeSource } {
  const pub = publicationInstant(publicationDate);
  if (publicInspectionFiledAt) {
    const pi = new Date(publicInspectionFiledAt);
    if (!Number.isNaN(pi.getTime()) && pi.getTime() <= pub.getTime()) {
      return { instant: pi, source: 'public_inspection' };
    }
  }
  return { instant: pub, source: 'publication_0600_et' };
}
