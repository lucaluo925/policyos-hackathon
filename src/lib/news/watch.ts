import type { MonitorItem } from './query';
export type WatchFilter = { q: string; country: string; domain: string; days: string };
export type WatchRule = WatchFilter & { id: string; name: string };
export const EMPTY_FILTER: WatchFilter = { q: '', country: '', domain: '', days: '' };
export const SAVED_ITEMS_KEY = 'policyos:monitor:saved:v1';
export const WATCH_RULES_KEY = 'policyos:monitor:rules:v1';

export function readSavedItems(value: string | null): MonitorItem[] {
  try {
    const rows = JSON.parse(value ?? '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => r && typeof r.id === 'string' && typeof r.title === 'string' && typeof r.source === 'string' && typeof r.publishedAt === 'string' && Number.isFinite(Date.parse(r.publishedAt)) && ['climate', 'trade', 'immigration'].includes(r.domain) && Array.isArray(r.countries) && r.countries.every((c: unknown) => typeof c === 'string') && (r.url === null || typeof r.url === 'string')).slice(0, 200);
  } catch { return []; }
}
export function readWatchRules(value: string | null): WatchRule[] {
  try {
    const rows = JSON.parse(value ?? '[]');
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.q === 'string' && r.q.length <= 160 && typeof r.country === 'string' && /^(?:[A-Z]{2})?$/.test(r.country) && ['', 'climate', 'trade', 'immigration'].includes(r.domain) && ['', '1', '7', '30'].includes(r.days)).slice(0, 20) : [];
  } catch { return []; }
}
export function filterSavedItems(items: MonitorItem[], filter: WatchFilter, now = Date.now()): MonitorItem[] {
  const terms = filter.q.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter((item) => (!filter.domain || item.domain === filter.domain) && (!filter.country || item.countries.includes(filter.country)) && (!filter.days || Date.parse(item.publishedAt) >= now - Number(filter.days) * 86_400_000) && terms.every((term) => `${item.title} ${item.description ?? ''} ${item.source}`.toLocaleLowerCase().includes(term)));
}
export function unseenItems(items: MonitorItem[], seen: Set<string>): MonitorItem[] { return items.filter((item) => !seen.has(item.id)); }
// Spreadsheet applications interpret formula prefixes even inside quoted cells.
function safeCsv(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function monitorCsv(items: MonitorItem[]): string {
  const columns = ['id', 'publishedAt', 'domain', 'countries', 'source', 'title', 'url', 'provenance'] as const;
  return '\uFEFF' + columns.join(',') + '\r\n' + items.map((item) => columns.map((c) => safeCsv(c === 'countries' ? item.countries.join('|') : item[c])).join(',')).join('\r\n') + '\r\n';
}
