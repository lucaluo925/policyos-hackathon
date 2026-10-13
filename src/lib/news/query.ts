import type { Domain } from '@prisma/client';
import { resolveFeedItem, feedLang } from '@/lib/feeds/registry';

export const MONITOR_BATCH_SIZE = 100;
export type MonitorQuery = { domain?: Domain; country?: string; q: string; days?: number; limit: number; cursor?: { publishedAt: string; id: string } };
export type MonitorRow = { id: string; title: string; description: string | null; source: string; url: string | null; publishedAt: Date; domain: Domain; feedKey: string | null; provenance: string | null; policyLinks: Array<{ countryIso: string | null }> };
export type MonitorItem = { id: string; title: string; description: string | null; source: string; url: string | null; publishedAt: string; datePrecision?: 'day' | 'timestamp'; domain: Domain; countries: string[]; lang: string; provenance: string | null };
export type MonitorResult = { items: MonitorItem[]; nextCursor: string | null; available: boolean; checkedAt: string; mode?: 'database' | 'direct'; scopeCountries?: string[]; sourceSummary?: { available: number; retained: number; unavailable: number }; emptyReason?: 'no_source' | 'sources_unavailable' };
export class InvalidMonitorQuery extends Error {}

export function parseMonitorQuery(params: URLSearchParams): MonitorQuery {
  const domain = params.get('domain') || undefined;
  const country = params.get('country')?.toUpperCase() || undefined;
  const q = (params.get('q') ?? '').trim().replace(/\s+/g, ' ');
  const daysText = params.get('days');
  const limitText = params.get('limit') ?? '25';
  if (domain && !['climate', 'trade', 'immigration'].includes(domain)) throw new InvalidMonitorQuery('Invalid topic');
  if (country && !/^[A-Z]{2}$/.test(country)) throw new InvalidMonitorQuery('Invalid country');
  if (q.length > 160) throw new InvalidMonitorQuery('Search is limited to 160 characters');
  if (daysText && !['1', '7', '30'].includes(daysText)) throw new InvalidMonitorQuery('Invalid time window');
  if (!/^\d+$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > 50) throw new InvalidMonitorQuery('Limit must be 1–50');
  let cursor: MonitorQuery['cursor'];
  const encoded = params.get('cursor');
  if (encoded) {
    if (encoded.length > 300) throw new InvalidMonitorQuery('Invalid cursor');
    try {
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (typeof parsed.id !== 'string' || !/^[\w-]{1,100}$/.test(parsed.id) || typeof parsed.publishedAt !== 'string' || new Date(parsed.publishedAt).toISOString() !== parsed.publishedAt) throw new Error();
      cursor = { id: parsed.id, publishedAt: parsed.publishedAt };
    } catch { throw new InvalidMonitorQuery('Invalid cursor'); }
  }
  return { domain: domain as Domain | undefined, country, q, days: daysText ? Number(daysText) : undefined, limit: Number(limitText), cursor };
}

export function paginateMonitorRows(rows: MonitorRow[], query: MonitorQuery, now = new Date()): MonitorResult {
  const items: MonitorItem[] = [];
  let lastConsumed: MonitorRow | undefined;
  let overflow = false;
  for (const row of rows) {
    const domain = resolveFeedItem(row.feedKey, row.title, row.domain);
    if (!domain || (query.domain && query.domain !== domain)) { lastConsumed = row; continue; }
    if (items.length === query.limit) { overflow = true; break; }
    items.push({ id: row.id, title: row.title, description: row.description, source: row.source, url: row.url, publishedAt: row.publishedAt.toISOString(), domain, countries: [...new Set(row.policyLinks.flatMap((l) => l.countryIso ? [l.countryIso] : []))], lang: feedLang(row.feedKey), provenance: row.provenance });
    lastConsumed = row;
  }
  return { items, nextCursor: (overflow || rows.length === MONITOR_BATCH_SIZE) && lastConsumed ? Buffer.from(JSON.stringify({ publishedAt: lastConsumed.publishedAt.toISOString(), id: lastConsumed.id })).toString('base64url') : null, available: true, checkedAt: now.toISOString() };
}
