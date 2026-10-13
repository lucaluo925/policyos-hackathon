import { ANNOUNCEMENT_SOURCES } from '@/lib/announcements/registry';
import { readOfficialAnnouncements } from '@/lib/announcements/load';
import type { AnnouncementBundle } from '@/lib/announcements/types';
import type { MonitorItem, MonitorQuery, MonitorResult } from './query';

// A bounded starter view, not a claim of global or exhaustive monitoring.
// Selecting a country reads every official announcement connector configured for it.
export const FEATURED_MONITOR_COUNTRIES = ['MY', 'NZ', 'HK', 'CH', 'NO', 'ZA'] as const;

type Reader = (country: string) => Promise<AnnouncementBundle>;
const timestamp = (value: string) => new Date(value).toISOString();

export async function queryDirectMonitor(
  query: MonitorQuery,
  read: Reader = readOfficialAnnouncements,
  now: () => number = Date.now,
): Promise<MonitorResult> {
  const scopeCountries = query.country ? [query.country] : [...FEATURED_MONITOR_COUNTRIES];
  const configured = scopeCountries.filter(country => ANNOUNCEMENT_SOURCES.some(source => source.countries.includes(country)));
  const checkedAt = new Date(now()).toISOString();
  if (configured.length === 0) return { items: [], nextCursor: null, available: false, checkedAt, mode: 'direct', scopeCountries, sourceSummary: { available: 0, retained: 0, unavailable: 0 }, emptyReason: 'no_source' };

  const bundles = await Promise.all(configured.map(read));
  const sources = bundles.flatMap(bundle => bundle.sources);
  const sourceSummary = {
    available: sources.filter(source => source.status === 'available').length,
    retained: sources.filter(source => source.status === 'retained').length,
    unavailable: sources.filter(source => source.status === 'unavailable').length,
  };
  const available = sourceSummary.available + sourceSummary.retained > 0;
  if (!available) return { items: [], nextCursor: null, available: false, checkedAt, mode: 'direct', scopeCountries, sourceSummary, emptyReason: 'sources_unavailable' };

  const byId = new Map<string, MonitorItem>();
  for (const bundle of bundles) {
    for (const entry of bundle.items) {
      const prior = byId.get(entry.id);
      if (prior) {
        if (!prior.countries.includes(bundle.country)) prior.countries.push(bundle.country);
        continue;
      }
      byId.set(entry.id, {
        id: entry.id, title: entry.title, description: null, source: entry.sourceName,
        url: entry.url, publishedAt: entry.publishedAt, datePrecision: entry.datePrecision,
        domain: entry.topic, countries: [bundle.country], lang: entry.language, provenance: 'official_feed',
      });
    }
  }
  const terms = query.q.toLocaleLowerCase().split(' ').filter(Boolean);
  const cutoff = query.days ? now() - query.days * 86_400_000 : null;
  const rows = [...byId.values()]
    .filter(item => (!query.domain || item.domain === query.domain)
      && (cutoff === null || Date.parse(item.publishedAt) >= cutoff)
      && terms.every(term => `${item.title} ${item.source}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.id.localeCompare(a.id));
  const afterCursor = query.cursor
    ? rows.filter(item => timestamp(item.publishedAt) < query.cursor!.publishedAt
      || (timestamp(item.publishedAt) === query.cursor!.publishedAt && item.id < query.cursor!.id))
    : rows;
  const items = afterCursor.slice(0, query.limit);
  const last = items.at(-1);
  const nextCursor = afterCursor.length > query.limit && last
    ? Buffer.from(JSON.stringify({ publishedAt: timestamp(last.publishedAt), id: last.id })).toString('base64url')
    : null;
  return { items, nextCursor, available: true, checkedAt, mode: 'direct', scopeCountries, sourceSummary };
}
