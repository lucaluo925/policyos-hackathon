import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryDirectMonitor, FEATURED_MONITOR_COUNTRIES } from '../direct-monitor';
import { parseMonitorQuery } from '../query';
import type { AnnouncementBundle, AnnouncementSourceResult, OfficialAnnouncement } from '@/lib/announcements/types';

const now = Date.parse('2026-10-12T12:00:00.000Z');
const query = (input = '') => parseMonitorQuery(new URLSearchParams(input));
const source = (status: AnnouncementSourceResult['status']): AnnouncementSourceResult => ({
  sourceId: 'official', name: 'Government', url: 'https://government.example/feed', status,
  fetchedAt: status === 'unavailable' ? null : new Date(now).toISOString(),
  checkedAt: new Date(now).toISOString(), records: 1, problem: status === 'unavailable' ? 'offline' : null,
});
function item(id: string, overrides: Partial<OfficialAnnouncement> = {}): OfficialAnnouncement {
  return {
    id, sourceId: 'official', sourceName: 'Government', country: 'NZ', topic: 'trade',
    title: `Export policy ${id}`, url: `https://government.example/${id}`,
    publishedAt: '2026-10-11', datePrecision: 'day', dateKind: 'published',
    language: 'en', kind: 'announcement', ...overrides,
  };
}
function bundle(country: string, items: OfficialAnnouncement[], status: AnnouncementSourceResult['status'] = 'available'): AnnouncementBundle {
  return { country, checkedAt: new Date(now).toISOString(), sources: [source(status)], items };
}

test('the default direct view reads only its six named countries, deduplicates shared items, and labels its limits', async () => {
  const called: string[] = [];
  const result = await queryDirectMonitor(query(), async country => {
    called.push(country);
    return bundle(country, [item('shared', { country })]);
  }, () => now);
  assert.deepEqual(called, [...FEATURED_MONITOR_COUNTRIES]);
  assert.deepEqual(result.scopeCountries, [...FEATURED_MONITOR_COUNTRIES]);
  assert.equal(result.mode, 'direct');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].countries, [...FEATURED_MONITOR_COUNTRIES]);
  assert.equal(result.items[0].publishedAt, '2026-10-11');
  assert.equal(result.items[0].datePrecision, 'day');
  assert.equal(result.items[0].url, 'https://government.example/shared');
  assert.equal(result.sourceSummary?.available, FEATURED_MONITOR_COUNTRIES.length);
});

test('one selected country can be read outside the starter view; search, domain and cursor preserve source dates', async () => {
  const read = async (country: string) => bundle(country, [
    item('c', { publishedAt: '2026-10-11' }), item('b', { publishedAt: '2026-10-11' }),
    item('a', { title: 'Routine climate notice', topic: 'climate', publishedAt: '2026-10-10' }),
  ]);
  const first = await queryDirectMonitor(query('country=NZ&domain=trade&q=export&limit=1'), read, () => now);
  assert.deepEqual(first.scopeCountries, ['NZ']);
  assert.deepEqual(first.items.map(entry => entry.id), ['c']);
  assert.ok(first.nextCursor);
  const second = await queryDirectMonitor(query(`country=NZ&domain=trade&q=export&limit=1&cursor=${first.nextCursor}`), read, () => now);
  assert.deepEqual(second.items.map(entry => entry.id), ['b']);
  assert.equal(second.nextCursor, null);
});

test('unconfigured, failed and successfully read empty sources remain distinct', async () => {
  let called = false;
  const missing = await queryDirectMonitor(query('country=AQ'), async () => { called = true; throw Error('should not read'); }, () => now);
  assert.equal(called, false);
  assert.equal(missing.available, false);
  assert.equal(missing.emptyReason, 'no_source');
  const failed = await queryDirectMonitor(query('country=NZ'), async country => bundle(country, [], 'unavailable'), () => now);
  assert.equal(failed.available, false);
  assert.equal(failed.emptyReason, 'sources_unavailable');
  const empty = await queryDirectMonitor(query('country=NZ'), async country => bundle(country, []), () => now);
  assert.equal(empty.available, true);
  assert.equal(empty.emptyReason, undefined);
  assert.deepEqual(empty.items, []);
});

test('a failed connector does not erase items read from another connector', async () => {
  const result = await queryDirectMonitor(query('country=ZA'), async country => ({
    ...bundle(country, [item('usable')]), sources: [source('available'), source('unavailable')],
  }), () => now);
  assert.equal(result.available, true);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.sourceSummary, { available: 1, retained: 0, unavailable: 1 });
});
