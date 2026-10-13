/**
 * Minimal Federal Register API client (https://www.federalregister.gov/developers).
 *
 * URL builders and response handling are pure so they can be unit-tested
 * without network; the fetch function is injected.
 */

import type { FrDocument } from './types';

const BASE = 'https://www.federalregister.gov/api/v1';

export const FR_FIELDS = [
  'document_number',
  'title',
  'type',
  'action',
  'abstract',
  'publication_date',
  'html_url',
  'raw_text_url',
  'agencies',
] as const;

export interface DocumentQuery {
  agency: string; // agency slug
  types: Array<'RULE' | 'PRORULE' | 'NOTICE'>;
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  page?: number;
  perPage?: number;
}

export function buildDocumentsUrl(q: DocumentQuery): string {
  const p = new URLSearchParams();
  p.append('conditions[agencies][]', q.agency);
  for (const t of q.types) p.append('conditions[type][]', t);
  p.append('conditions[publication_date][gte]', q.from);
  p.append('conditions[publication_date][lte]', q.to);
  for (const f of FR_FIELDS) p.append('fields[]', f);
  p.append('order', 'oldest');
  p.append('per_page', String(q.perPage ?? 1000));
  p.append('page', String(q.page ?? 1));
  return `${BASE}/documents.json?${p.toString()}`;
}

export function buildPublicInspectionUrl(availableOn: string): string {
  const p = new URLSearchParams();
  p.append('conditions[available_on]', availableOn);
  // Only the two fields we need — full PI records are large and slow.
  p.append('fields[]', 'document_number');
  p.append('fields[]', 'filed_at');
  p.append('per_page', '1000');
  return `${BASE}/public-inspection-documents.json?${p.toString()}`;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Global-fetch Fetcher with a 20 s per-request timeout and exponential
 * backoff on network errors, 429 and 5xx. A request that keeps failing
 * resolves to { ok: false, status: -1 } instead of hanging the caller.
 */
export const retryingFetcher: Fetcher = async (url) => {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      // Hard per-request timeout: a hung socket must not stall the whole backfill.
      res = await fetch(url, {
        headers: { 'User-Agent': 'PolicyOS research backfill' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      if (attempt >= 3) return { ok: false, status: -1, json: async () => ({}) };
      console.warn(`[fetch] attempt ${attempt} failed (${(e as Error).name}); retrying`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= 4) return res;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
};

interface DocumentsPage {
  count?: number;
  total_pages?: number;
  results?: FrDocument[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pull every page for one query. The FR API refuses page numbers beyond
 * 10,000 results, so callers should keep date ranges reasonable (a year at a
 * time is plenty for BIS/USTR).
 */
export async function fetchAllDocuments(
  q: Omit<DocumentQuery, 'page'>,
  fetcher: Fetcher,
  delayMs = 250,
): Promise<FrDocument[]> {
  const out: FrDocument[] = [];
  for (let page = 1; ; page++) {
    const url = buildDocumentsUrl({ ...q, page });
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`FR documents HTTP ${res.status}: ${url}`);
    const body = (await res.json()) as DocumentsPage;
    out.push(...(body.results ?? []));
    const totalPages = body.total_pages ?? 1;
    if (page >= totalPages || !body.results?.length) break;
    await sleep(delayMs);
  }
  return out;
}

interface PiPage {
  results?: Array<{ document_number?: string; filed_at?: string | null }>;
}

/** document_number → filed_at for everything on public inspection that day. */
export async function fetchPublicInspectionDay(
  availableOn: string,
  fetcher: Fetcher,
): Promise<Map<string, string>> {
  const res = await fetcher(buildPublicInspectionUrl(availableOn));
  const map = new Map<string, string>();
  if (!res.ok) return map; // best-effort: caller falls back to publication time
  const body = (await res.json()) as PiPage;
  for (const r of body.results ?? []) {
    if (r.document_number && r.filed_at) map.set(r.document_number, r.filed_at);
  }
  return map;
}

/** Calendar days to scan before publication for the public-inspection record. */
export function piLookbackDates(publicationDate: string, days = 5): string[] {
  const [y, m, d] = publicationDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = 0; i <= days; i++) {
    out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}
