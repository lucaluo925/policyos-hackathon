/**
 * End-to-end Federal Register → PolicyEventRecord collection.
 *
 * Shared by the backfill script (scripts/events-backfill.ts) and the daily
 * cron route (/api/events/ingest) so both produce identical records:
 *   1. list BIS rules/proposed rules and USTR rules/notices in [from, to]
 *   2. full-text scan of China-related Entity List rules for semis entities
 *   3. public-inspection lookup for relevant candidates (event instant)
 */

import { BIS_SLUG, USTR_SLUG, needsBodyScan, semisHitsFromBody } from './tagger';
import { fetchAllDocuments, fetchPublicInspectionDay, piLookbackDates, type Fetcher } from './federal-register';
import { toEventRecord } from './build';
import type { FrDocument, PolicyEventRecord } from './types';

export interface CollectOptions {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  fetcher: Fetcher;
  /** Raw-text fetcher for the body scan (defaults to global fetch with a timeout). */
  fetchText?: (url: string) => Promise<string | null>;
  usePi?: boolean;
  piDays?: number;
  delayMs?: number;
  log?: (msg: string) => void;
}

export interface CollectResult {
  records: PolicyEventRecord[];
  piHits: number;
  bodyScanned: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function yearRanges(from: string, to: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const a = y === Number(from.slice(0, 4)) ? from : `${y}-01-01`;
    const b = y === Number(to.slice(0, 4)) ? to : `${y}-12-31`;
    out.push([a, b]);
  }
  return out;
}

async function defaultFetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PolicyOS research backfill' },
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function collectFrEvents(o: CollectOptions): Promise<CollectResult> {
  const log = o.log ?? (() => {});
  const delay = o.delayMs ?? 200;
  const fetchText = o.fetchText ?? defaultFetchText;
  const usePi = o.usePi ?? true;
  const piDays = Math.max(0, o.piDays ?? 3);

  const queries = [
    { agency: BIS_SLUG, types: ['RULE', 'PRORULE'] as Array<'RULE' | 'PRORULE' | 'NOTICE'> },
    { agency: USTR_SLUG, types: ['RULE', 'NOTICE'] as Array<'RULE' | 'PRORULE' | 'NOTICE'> },
  ];
  const docs = new Map<string, FrDocument>();
  for (const q of queries) {
    for (const [a, b] of yearRanges(o.from, o.to)) {
      const got = await fetchAllDocuments({ agency: q.agency, types: q.types, from: a, to: b }, o.fetcher, delay);
      for (const d of got) docs.set(d.document_number, d);
      log(`[fr] ${q.agency} ${a}..${b}: ${got.length}`);
    }
  }
  const sorted = [...docs.values()].sort((x, y) => x.publication_date.localeCompare(y.publication_date));

  // Full-text pass for China-related Entity List rules whose abstract names no
  // semiconductor entity (abstracts rarely list entities).
  const bodyHits = new Map<string, string[]>();
  const toScan = sorted.filter((d) => needsBodyScan(d) && d.raw_text_url);
  log(`\n[body] scanning full text of ${toScan.length} China-related Entity List rules`);
  for (const [i, d] of toScan.entries()) {
    const text = await fetchText(d.raw_text_url!);
    if (text != null) bodyHits.set(d.document_number, semisHitsFromBody(text));
    else log(`[body] ${d.document_number} failed`);
    if ((i + 1) % 10 === 0 || i + 1 === toScan.length) log(`[body] ${i + 1}/${toScan.length}`);
    await sleep(delay);
  }

  // Public-inspection lookup only for candidates; each calendar day once.
  const base = sorted.map((d) => toEventRecord(d, null, bodyHits.get(d.document_number) ?? []));
  const neededDays = usePi
    ? [...new Set(base.filter((r) => r.relevant).flatMap((r) => piLookbackDates(r.publicationDate, piDays)))].sort()
    : [];
  log(`\n[pi] relevant candidates=${base.filter((r) => r.relevant).length}; public-inspection days to fetch=${neededDays.length}`);
  const piByDoc = new Map<string, string>();
  for (const [i, day] of neededDays.entries()) {
    const m = await fetchPublicInspectionDay(day, o.fetcher);
    for (const [k, v] of m) if (!piByDoc.has(k) || v < piByDoc.get(k)!) piByDoc.set(k, v);
    if ((i + 1) % 10 === 0 || i + 1 === neededDays.length) log(`[pi] ${i + 1}/${neededDays.length} days (${day})`);
    await sleep(Math.min(delay, 150));
  }

  let piHits = 0;
  const records = sorted.map((d, i) => {
    const filed = base[i].relevant ? piByDoc.get(d.document_number) ?? null : null;
    const rec = filed ? toEventRecord(d, filed, bodyHits.get(d.document_number) ?? []) : base[i];
    if (rec.eventTimeSource === 'public_inspection') piHits++;
    return rec;
  });
  return { records, piHits, bodyScanned: toScan.length };
}
