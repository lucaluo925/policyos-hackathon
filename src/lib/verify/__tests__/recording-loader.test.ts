import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadPublicRecording } from '../recording-loader';

const recording = JSON.parse(readFileSync('public/verify-recordings/boe-service-passport-adjudication-20261012.json', 'utf8'));

test('a real public recording loads without changing its historical evidence', async () => {
  assert.deepEqual(await loadPublicRecording('/recording', {
    fetch: async () => Response.json(recording),
  }), recording);
});

for (const stalled of ['headers', 'body']) {
  test(`a stalled recording ${stalled} times out and cancels the request`, async () => {
    let signal: AbortSignal | null | undefined;
    const never = new Promise<Response>(() => {});
    await assert.rejects(loadPublicRecording('/recording', {
      timeoutMs: 5,
      fetch: async (_, init) => {
        signal = init?.signal;
        return stalled === 'headers' ? never : {
          ok: true, json: () => new Promise(() => {}),
        } as unknown as Response;
      },
    }), /timed out/);
    assert.equal(signal?.aborted, true);
    // A failed attempt does not poison the next load.
    assert.deepEqual(await loadPublicRecording('/recording', {
      fetch: async () => Response.json(recording),
    }), recording);
  });
}

test('failed responses and undisclosed recording scope do not become displayed reports', async () => {
  await assert.rejects(loadPublicRecording('/recording', {
    fetch: async () => new Response('unavailable', { status: 503 }),
  }), /unavailable/);
  await assert.rejects(loadPublicRecording('/recording', {
    fetch: async () => Response.json({}),
  }), /scope/);
});

test('an incomplete recording is rejected before replacing a usable report', async () => {
  const incomplete = structuredClone(recording);
  delete incomplete.assertions;
  await assert.rejects(loadPublicRecording('/recording', {
    fetch: async () => Response.json(incomplete),
  }), /recording/i);
});

test('both shipped recordings retain their original data, including absent optional metadata', async () => {
  const eu = JSON.parse(readFileSync('public/verify-recordings/eu-ai-act-entry-20261013.json', 'utf8'));
  assert.deepEqual(await loadPublicRecording('/eu', { fetch: async () => Response.json(eu) }), eu);
  const older = structuredClone(recording);
  delete older.provenance; delete older.tavilyRequestIds;
  assert.deepEqual(await loadPublicRecording('/older', { fetch: async () => Response.json(older) }), older);
});

const invalidVariants: Array<[string, (value: typeof recording) => void]> = [
  ['statistics', value => { delete value.stats; }],
  ['negative call count', value => { value.stats.modelCalls = -1; }],
  ['assertion result', value => { value.assertions[0].citedUrls = null; }],
  ['duplicate assertion identity', value => { value.assertions.push(structuredClone(value.assertions[0])); }],
  ['retrieved evidence', value => { value.docs = { a1: null }; }],
  ['passage text', value => { Object.values<Array<{ snippet: unknown }>>(value.docs)[0][0].snippet = 123; }],
  ['source attribution', value => { value.sourceAttribution.primaryDocumentUrl = 'javascript:alert(1)'; }],
  ['credential-bearing source', value => { value.sourceAttribution.url = 'https://user:password@example.org/'; }],
  ['omitted source URLs', value => { value.omittedAdjudicationUrls = { a1: ['data:text/html,broken'] }; }],
  ['exact adjudication passage', value => { value.provenance.adjudicationEvidence = { a1: [{ url: 'https://example.org', title: 'test', retrievalScore: 0.5 }] }; }],
  ['inspection trail', value => { value.provenance.sourceInspection = { a1: { status: 'done', requestedUrls: null, extractedUrls: [], failedUrls: [] } }; }],
  ['search trail', value => { value.provenance.searches = [{ assertionId: 'a1', kind: 'open', requestId: 'test', query: 'test', depth: 'basic', includeDomains: [], returnedUrls: {}, excludedNavigationUrls: [], elapsedMs: 1 }]; }],
  ['model diagnostics', value => { value.provenance.modelCalls = [{ stage: 'screen', model: 'test', tool: 'test', outcome: 'tool_returned', elapsedMs: 1, usage: null }]; }],
  ['issuer discovery', value => { Object.values<Array<{ issuerDiscovery?: unknown }>>(value.docs)[0][0].issuerDiscovery = { seedUrl: 'https://example.org', indexUrl: 'javascript:alert(1)', readBytes: 1 }; }],
];
for (const [name, mutate] of invalidVariants) {
  test(`invalid ${name} is rejected and a subsequent valid recording remains loadable`, async () => {
    const invalid = structuredClone(recording);
    mutate(invalid);
    await assert.rejects(loadPublicRecording('/invalid', { fetch: async () => Response.json(invalid) }), /recording/i);
    assert.deepEqual(await loadPublicRecording('/valid', { fetch: async () => Response.json(recording) }), recording);
  });
}
