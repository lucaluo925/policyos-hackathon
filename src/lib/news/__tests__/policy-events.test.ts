import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregatePolicyEvents, policyEventsJson } from '../policy-events';
import type { MonitorItem } from '../query';

function item(id: string, patch: Partial<MonitorItem> = {}): MonitorItem {
  return { id, title: 'New carbon emissions reporting requirements for industrial exporters',
    description: null, source: 'Official environment ministry', url: `https://example.gov/notices/${id}`,
    publishedAt: '2026-10-12T12:00:00.000Z', domain: 'climate', countries: ['NZ'],
    lang: 'en', provenance: 'official_feed', ...patch };
}

test('tracking variants group without changing source URLs, dates or announcement contents', () => {
  const input = [item('a', { url: 'https://example.gov/document?id=123&utm_source=feed#section' }),
    item('b', { title: 'Correction to the carbon reporting document', url: 'https://example.gov/document?id=123' })];
  const original = structuredClone(input);
  const groups = aggregatePolicyEvents(input);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].links[0].reason, 'same_document');
  assert.deepEqual(input, original);
  assert.deepEqual(groups.flatMap(group => group.items).sort((a,b) => a.id.localeCompare(b.id)), original);
});

test('semantic document query parameters are retained', () => {
  assert.equal(aggregatePolicyEvents([
    item('a', { url: 'https://example.gov/doc?id=123', title: 'Carbon reporting' }),
    item('b', { url: 'https://example.gov/doc?id=456', title: 'Visa rules' }),
  ]).length, 2);
});

test('same official title and scope form a candidate without hiding either source', () => {
  const groups = aggregatePolicyEvents([item('a'), item('b', { source: 'Official trade ministry' })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].links[0].reason, 'same_title');
});

test('close wording forms an explicitly unverified similarity candidate', () => {
  const groups = aggregatePolicyEvents([item('a'), item('b', {
    title: 'New carbon emissions reporting requirements for industrial exporters announced',
  })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].links[0].reason, 'similar_text');
});

for (const [label, patch] of [
  ['country', { countries: ['AU'] }], ['topic', { domain: 'trade' }],
  ['language', { lang: 'de' }], ['unknown country', { countries: [] }],
  ['nonofficial provenance', { provenance: 'collected_feed' }],
  ['older occurrence', { publishedAt: '2026-09-01T00:00:00.000Z' }],
  ['invalid source date', { publishedAt: 'unknown' }],
] as Array<[string, Partial<MonitorItem>]>) {
  test(`matching generic text does not cross ${label}`, () => {
    assert.equal(aggregatePolicyEvents([item('a'), item('b', patch)]).length, 2);
  });
}

test('amounts, dates and explicit negations stay separate even with similar wording', () => {
  for (const [a, b] of [['Tax credit increases to 10 percent', 'Tax credit increases to 20 percent'],
    ['Requirements take effect in 2026', 'Requirements take effect in 2027'],
    ['Exporters must report emissions', 'Exporters must not report emissions']]) {
    const suffix = ' under the new industrial carbon emissions reporting regulations';
    assert.equal(aggregatePolicyEvents([item('a', { title: a + suffix }), item('b', { title: b + suffix })]).length, 2);
  }
});

test('short boilerplate and different topics are never joined using similar summaries', () => {
  assert.equal(aggregatePolicyEvents([item('a', { title: 'Ministry news' }), item('b', { title: 'Ministry news' })]).length, 2);
  assert.equal(aggregatePolicyEvents([item('a'), item('b', { title: 'Temporary visa processing changes for seasonal agricultural workers' })]).length, 2);
});

test('pairwise checks prevent chaining a policy event past the 14-day window', () => {
  const groups = aggregatePolicyEvents([item('a', { publishedAt: '2026-10-14T00:00:00Z' }),
    item('b', { publishedAt: '2026-10-04T00:00:00Z' }), item('c', { publishedAt: '2026-09-24T00:00:00Z' })]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].items.map(item => item.id), ['a', 'b']);
});

test('input order cannot change candidate groups and pagination repeats do not duplicate an item', () => {
  const input = [item('a'), item('b'), item('c', { title: 'Unrelated trade meeting' })];
  assert.deepEqual(aggregatePolicyEvents(input), aggregatePolicyEvents([...input].reverse()));
  assert.equal(aggregatePolicyEvents([...input, input[0]]).flatMap(group => group.items).length, 3);
});

test('event export preserves every original and discloses candidate scope without a verdict', () => {
  const input = [item('a'), item('b')];
  const exported = JSON.parse(policyEventsJson(input, '2026-10-14T18:00:00Z'));
  assert.equal(exported.kind, 'policy_event_candidates');
  assert.equal(exported.scope, 'loaded_announcements_only');
  assert.equal(exported.exportedAt, '2026-10-14T18:00:00Z');
  assert.deepEqual(exported.events.flatMap((group: {items: MonitorItem[]}) => group.items), input);
  assert.equal(exported.verdict, undefined);
  assert.match(exported.notes.join(' '), /not verified policy identities/);
});

test('retained and saved event exports disclose their view, filters and read status', () => {
  const input = [item('a'), item('b')];
  const context = { view: 'loaded_announcements' as const,
    filters: { q: 'carbon', country: 'NZ', domain: 'climate', days: '7' },
    loadedAt: '2026-10-14T16:00:00Z', latestReadStatus: 'failed' as const };
  const exported = JSON.parse(policyEventsJson(input, '2026-10-14T18:00:00Z', context));
  assert.deepEqual(exported.context, context);
  assert.deepEqual(exported.events.flatMap((group: {items: MonitorItem[]}) => group.items), input);
  const saved = JSON.parse(policyEventsJson(input, undefined, {
    ...context, view: 'saved_browser_snapshots', loadedAt: null, latestReadStatus: 'not_applicable',
  }));
  assert.equal(saved.context.view, 'saved_browser_snapshots');
  assert.equal(saved.context.loadedAt, null);
  assert.equal(saved.context.latestReadStatus, 'not_applicable');
});
