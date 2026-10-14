import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CountryResearchReadError, parseCountryResearchResult, readCountryResearch } from '../client-read';
import { countryResearchReport } from '../lead-report';
import { verificationHref } from '../../intelligence/research-lead';
import { policyClaim } from '../../verify/claim-text';

const query = { countryIso: 'NZ', domain: 'trade', scope: 'public' } as const;
const result = { countryIso: 'NZ', countryName: 'New Zealand', domain: 'trade', scope: 'public',
  searchedAt: '2026-10-14T18:00:00.000Z', requestId: 'local-test-only', items: [{
    title: 'LOCAL FIXTURE Trade announcement', url: 'https://www.mfat.govt.nz/en/trade/policy?scope=a%26b',
    excerpt: 'LOCAL FIXTURE ONLY: New Zealand announced trade policy details.', recognizedOfficialDomain: true, countryGovernmentDomain: true,
  }] } as const;
const failsWith = (code: CountryResearchReadError['code']) => (error: unknown) => error instanceof CountryResearchReadError && error.code === code;

test('country research response retains source/request/date context and rejects unrelated batches', () => {
  assert.deepEqual(parseCountryResearchResult(result, query), result);
  for (const patch of [{ countryIso: 'SG' }, { domain: 'climate' }, { scope: 'country-government' },
    { searchedAt: 'invalid' }, { items: null }, { requestId: null }]) {
    assert.throws(() => parseCountryResearchResult({ ...result, ...patch }, query), failsWith('invalid_response'));
  }
});
test('unsafe or malformed source objects cannot reach URL rendering or clickable links', () => {
  for (const item of [null, {}, { ...result.items[0], url: 'javascript:alert(1)' },
    { ...result.items[0], url: 'https://user:password@example.org/doc' },
    { ...result.items[0], url: 'http://example.org/doc' }, { ...result.items[0], excerpt: null }]) {
    assert.throws(() => parseCountryResearchResult({ ...result, items: [item] }, query), failsWith('invalid_response'));
  }
  assert.deepEqual(parseCountryResearchResult({ ...result, items: [] }, query).items, [], 'valid empty search is still a completed result');
});
test('a single explicit search request carries the selected country/domain/scope', async () => {
  let calls = 0;
  const response = await readCountryResearch(query, { signal: new AbortController().signal,
    transport: async (url, init) => {
      calls++; assert.equal(url, '/api/explore/research');
      assert.deepEqual(JSON.parse(init!.body as string), { country: 'NZ', domain: 'trade', scope: 'public' });
      return Response.json(result);
    } });
  assert.deepEqual(response, result); assert.equal(calls, 1);
});
test('HTML, truncated JSON and network errors never expose raw messages or retry automatically', async () => {
  for (const transport of [async () => new Response('<html>upstream private diagnostic</html>', { status: 502 }),
    async () => new Response('{broken', { status: 200 }), async () => { throw new Error('upstream key=private-test-value'); }]) {
    let calls = 0;
    try {
      await readCountryResearch(query, { signal: new AbortController().signal, transport: async () => { calls++; return transport(); } });
      assert.fail('invalid response must not complete');
    } catch (error) {
      assert.ok(error instanceof CountryResearchReadError);
      assert.doesNotMatch(error.message, /private|Unexpected|JSON|html/i);
    }
    assert.equal(calls, 1);
  }
});
test('daily limits and judge sign-in remain distinct recoverable outcomes', async () => {
  for (const [status, body, expected] of [[429, {}, 'daily_limit'], [401, { code: 'judge_required' }, 'judge_required'], [503, {}, 'unavailable']] as const) {
    await assert.rejects(readCountryResearch(query, { signal: new AbortController().signal,
      transport: async () => Response.json(body, { status }) }), failsWith(expected));
  }
});
function stalledTransport(): typeof fetch {
  return async (_url, init) => new Promise((_resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('transport ignored abort')), 500);
    const stop = () => { clearTimeout(guard); reject(init!.signal!.reason); };
    if (init?.signal?.aborted) stop(); else init?.signal?.addEventListener('abort', stop, { once: true });
  });
}
test('bounded browser wait exits a stalled request without another attempt', async () => {
  let calls = 0; const transport = stalledTransport();
  await assert.rejects(readCountryResearch(query, { signal: new AbortController().signal, timeoutMs: 5,
    transport: async (url, init) => { calls++; return transport(url, init); } }), failsWith('timeout'));
  assert.equal(calls, 1);
});
test('explicit cancellation remains cancellation and does not claim a refund', async () => {
  const controller = new AbortController();
  const pending = readCountryResearch(query, { signal: controller.signal, transport: stalledTransport() });
  controller.abort();
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
});
test('retained search exports preserve original date/scope and disclose a failed newer scope', () => {
  const mutable = parseCountryResearchResult(structuredClone(result), query);
  const report = countryResearchReport(mutable,
    { status: 'failed', scope: 'country-government' }, new Date('2026-10-14T19:00:00Z'));
  assert.equal(report.kind, 'country-research-leads'); assert.equal(report.retained, true);
  assert.equal(report.result.scope, 'public'); assert.equal(report.latestAttempt.scope, 'country-government');
  assert.equal(report.result.searchedAt, result.searchedAt); assert.equal(report.exportedAt, '2026-10-14T19:00:00.000Z');
  assert.equal(report.result.requestId, result.requestId); assert.deepEqual(report.result.items, result.items);
  assert.equal('overall' in report, false, 'search leads must not masquerade as verification verdicts');
  assert.notEqual(report.result, mutable, 'export snapshots cannot mutate retained UI data');
});
test('verification handoff preserves the exact source and bounded draft without running providers', () => {
  const item = result.items[0];
  const claim = policyClaim(result.countryName, item.title, item.excerpt);
  const link = new URL(verificationHref(claim, item.url), 'https://policyos.example');
  assert.equal(link.searchParams.get('source'), item.url); assert.equal(link.searchParams.get('claim'), claim);
  assert.equal(link.searchParams.has('autorun'), false);
});


test('response validation whitelists exportable fields instead of retaining unknown diagnostics', () => {
  const clean = parseCountryResearchResult({ ...result, debug: 'private-test-only', items: [{ ...result.items[0], diagnostic: 'ignored' }] }, query);
  assert.equal('debug' in clean, false); assert.equal('diagnostic' in clean.items[0], false);
});


test('available search parameters remain traceable, while old results never invent a query', () => {
  assert.equal(parseCountryResearchResult(result, query).search, undefined);
  const search = { query: 'New Zealand government official trade tariffs customs policy announcement 2026', includeDomains: [], searchDepth: 'basic', maxResults: 5 } as const;
  const parsed = parseCountryResearchResult({ ...result, search }, query);
  assert.deepEqual(parsed.search, search);
  const report = countryResearchReport(parsed, { status: 'failed', scope: 'country-government' });
  assert.equal(report.result.search!.query, search.query);
  assert.deepEqual(report.result.search!.includeDomains, []);
  assert.throws(() => parseCountryResearchResult({ ...result, search: { ...search, includeDomains: [null] } }, query), failsWith('invalid_response'));
});
