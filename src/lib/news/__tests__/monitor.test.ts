import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonitorQuery, paginateMonitorRows, MONITOR_BATCH_SIZE, InvalidMonitorQuery, type MonitorRow } from '../query';
import { readSavedItems, readWatchRules, filterSavedItems, monitorCsv, unseenItems } from '../watch';

const now = new Date('2026-10-11T12:00:00.000Z');
function row(id: string, overrides: Partial<MonitorRow> = {}): MonitorRow {
  return { id, title: 'Trade export control announcement', description: 'Semiconductor export licences', source: 'Government', url: 'https://example.gov/policy', publishedAt: new Date('2026-10-10T12:00:00.000Z'), domain: 'trade', feedKey: 'unknown', provenance: 'official_feed', policyLinks: [{ countryIso: 'US' }], ...overrides };
}
const query = (input = '') => parseMonitorQuery(new URLSearchParams(input));

test('monitor query validates country, topic, time window and bounded limits', () => {
  assert.deepEqual(query('country=us&domain=trade&days=7&q=export++controls&limit=2'), { country: 'US', domain: 'trade', days: 7, q: 'export controls', limit: 2, cursor: undefined });
  for (const input of ['limit=0', 'limit=51', 'limit=2x', 'days=-1', 'country=USA', 'domain=all', 'cursor=oops', `q=${'x'.repeat(161)}`]) assert.throws(() => query(input), InvalidMonitorQuery, input);
});

test('pagination reapplies current topic rules, keeping formerly misclassified trade', () => {
  const rows = [row('3', { feedKey: 'de-bundesregierung', domain: 'climate', title: 'Freier Handel und Reformen für Wachstum und Wohlstand' }), row('2', { domain: 'climate' }), row('1')];
  const result = paginateMonitorRows(rows, query('domain=trade'), now);
  assert.deepEqual(result.items.map((r) => r.id), ['3', '1']);
  assert.equal(result.items[0].domain, 'trade');
});

test('routine government notices are suppressed before pagination', () => {
  const result = paginateMonitorRows([row('2', { feedKey: 'jp-mof-news', title: 'Auction Result of 20-Year JGBs on September 15, 2026' }), row('1')], query('limit=1'), now);
  assert.deepEqual(result.items.map((r) => r.id), ['1']);
  assert.equal(result.nextCursor, null);
});

test('cursor preserves timestamp ties and never consumes the first eligible overflow row', () => {
  const result = paginateMonitorRows([row('z'), row('y', { domain: 'climate' }), row('x')], query('domain=trade&limit=1'), now);
  assert.deepEqual(result.items.map((r) => r.id), ['z']);
  assert.deepEqual(query(`cursor=${result.nextCursor}`).cursor, { publishedAt: '2026-10-10T12:00:00.000Z', id: 'y' });
  const next = paginateMonitorRows([row('x')], query('domain=trade&limit=1'), now);
  assert.equal(next.items[0].id, 'x');
  assert.equal(next.nextCursor, null);
});

test('a fully suppressed batch still advances to older records', () => {
  const rows = Array.from({ length: MONITOR_BATCH_SIZE }, (_, i) => row(`item${100 - i}`, { domain: 'climate' }));
  const result = paginateMonitorRows(rows, query('domain=trade'), now);
  assert.equal(result.items.length, 0);
  assert.equal(query(`cursor=${result.nextCursor}`).cursor?.id, 'item1');
});

test('monitor items retain provenance, country links and exact publication instant', () => {
  const result = paginateMonitorRows([row('a', { policyLinks: [{ countryIso: 'US' }, { countryIso: 'US' }, { countryIso: null }] })], query(), now);
  assert.deepEqual(result.items[0].countries, ['US']);
  assert.equal(result.items[0].publishedAt, '2026-10-10T12:00:00.000Z');
  assert.equal(result.items[0].provenance, 'official_feed');
  assert.equal(result.checkedAt, now.toISOString());
});

test('corrupt browser storage and malformed saved conditions degrade safely', () => {
  assert.deepEqual(readSavedItems('{broken'), []);
  assert.deepEqual(readWatchRules('{}'), []);
  assert.deepEqual(readSavedItems('[{"id":"a"}]'), []);
  assert.deepEqual(readWatchRules('[{"id":"a","name":"x","q":"","country":"USA","domain":"trade","days":"7"}]'), []);
});

test('saved announcement filtering matches all keywords plus country/topic/window', () => {
  const items = paginateMonitorRows([row('a'), row('b', { publishedAt: new Date('2026-09-01T00:00:00.000Z') }), row('c', { policyLinks: [{ countryIso: 'CA' }] })], query(), now).items;
  assert.deepEqual(filterSavedItems(items, { q: 'export government', country: 'US', domain: 'trade', days: '7' }, now.getTime()).map((r) => r.id), ['a']);
  assert.equal(filterSavedItems(items, { q: 'not-found', country: '', domain: '', days: '' }, now.getTime()).length, 0);
});

test('new-item detection compares IDs so older unseen publications are detected', () => {
  const items = paginateMonitorRows([row('existing'), row('newly-collected', { publishedAt: new Date('2026-09-01T00:00:00.000Z') })], query(), now).items;
  assert.deepEqual(unseenItems(items, new Set(['existing'])).map((r) => r.id), ['newly-collected']);
  assert.equal(unseenItems(items, new Set(items.map((r) => r.id))).length, 0);
});

test('CSV preserves quotes and line breaks, includes evidence links, neutralizes formulas', () => {
  const items = paginateMonitorRows([row('a', { title: '  =HYPERLINK("https://bad")\nsecond line', source: '+SUM(1,2)' })], query(), now).items;
  const csv = monitorCsv(items);
  assert.ok(csv.startsWith('\uFEFFid,publishedAt'));
  assert.ok(csv.includes('"\'  =HYPERLINK(""https://bad"")\nsecond line"'));
  assert.ok(csv.includes('"\'+SUM(1,2)"'));
  assert.ok(csv.includes('https://example.gov/policy'));
});
