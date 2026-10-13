import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, MODEL_DECOMPOSER, MODEL_SCREENER, MODEL_ADJUDICATOR } from '../nemotron';
import { runVerification } from '../pipeline';
import { POST } from '../../../app/api/verify/route';
import { consumeVerificationStream } from '../stream';
import { liveReport, reportMarkdown } from '../report';
import type { VerifyEvent } from '../types';

const SOURCE = 'https://www.gov.uk/test-notice';
const SECRET = 'UPSTREAM_PRIVATE_SENTINEL';
const tool = { name: 'expected', description: 'test', parameters: { type: 'object' } };
const completion = (name: string, args: unknown, finish = 'tool_calls') => Response.json({
  choices: [{ finish_reason: finish, message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }],
});

async function isolated(fn: () => Promise<void>, fetcher: typeof fetch) {
  const originalFetch = globalThis.fetch;
  const nebius = process.env.NEBIUS_API_KEY;
  const tavily = process.env.TAVILY_API_KEY;
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-test';
  globalThis.fetch = fetcher;
  try { await fn(); } finally {
    globalThis.fetch = originalFetch;
    if (nebius === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = nebius;
    if (tavily === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = tavily;
  }
}

test('hosted verification without a shared database stops before any paid call', async () => {
  const previousVercel = process.env.VERCEL;
  const previousDatabase = process.env.DATABASE_URL;
  let calls = 0;
  try {
    process.env.VERCEL = '1';
    delete process.env.DATABASE_URL;
    await isolated(async () => {
      const response = await POST(new Request('http://localhost/api/verify', {
        method: 'POST', body: JSON.stringify({ claim: 'A precise policy claim.' }),
      }));
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /Shared live verification limit/);
      assert.equal(calls, 0);
    }, async () => { calls++; throw new Error('Provider must not be called'); });
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
});

test('a completed API stream and export say when local review storage was skipped', async () => {
  const priorDatabase = process.env.DATABASE_URL;
  const priorVercel = process.env.VERCEL;
  const priorShared = process.env.VERIFY_REQUIRE_SHARED_QUOTA;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.VERIFY_REQUIRE_SHARED_QUOTA;
  const claim = 'The policy takes effect in 2026.';
  const events: VerifyEvent[] = [];
  try {
    await isolated(async () => {
      const response = await POST(new Request('http://localhost/api/verify', {
        method: 'POST', body: JSON.stringify({ claim }),
      }));
      assert.equal(response.status, 200);
      await consumeVerificationStream(response.body!, event => events.push(event));
    }, async (url, init) => {
      if (String(url).includes('tavily')) return Response.json({ request_id: 'fresh-search-id', results: [
        { url: SOURCE, title: 'Policy notice', score: 0.95, content: 'The policy takes effect in 2026.' },
      ] });
      const name = JSON.parse(String(init?.body)).tool_choice.function.name;
      return completion(name, name === 'record_assertions'
        ? { assertions: [{ text: claim, search_query: 'policy effective 2026' }] }
        : name === 'record_screening'
          ? { judgements: [{ index: 0, relevant: true, leaning: 'supports', reason: 'The notice states the date.' }] }
          : { verdict: 'supported', confidence: 0.8, cited_urls: [SOURCE], rationale: 'The source passage states the date.' });
    });
  } finally {
    if (priorDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabase;
    if (priorVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = priorVercel;
    if (priorShared === undefined) delete process.env.VERIFY_REQUIRE_SHARED_QUOTA;
    else process.env.VERIFY_REQUIRE_SHARED_QUOTA = priorShared;
  }
  const done = events.at(-1);
  assert.ok(done?.type === 'done', 'the final event follows the storage attempt');
  assert.equal(done.result.overall, 'supported');
  assert.deepEqual(done.result.tavilyRequestIds, ['fresh-search-id']);
  assert.deepEqual(done.reviewPersistence, { status: 'skipped', savedAssertions: 0 });
  const report = liveReport(done.result, done.result.provenance!.adjudicationEvidence,
    undefined, null, done.reviewPersistence);
  assert.equal(report.reviewPersistence?.status, 'skipped');
  assert.match(reportMarkdown(report), /Review queue: not saved/);
  assert.match(reportMarkdown(report), /fresh-search-id/);
});

test('visitor SSE completes honestly after two decomposition transport failures', async () => {
  const priorDatabase = process.env.DATABASE_URL;
  const priorVercel = process.env.VERCEL;
  const priorShared = process.env.VERIFY_REQUIRE_SHARED_QUOTA;
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.VERIFY_REQUIRE_SHARED_QUOTA;
  const claim = 'The policy takes effect in 2026.';
  const events: VerifyEvent[] = [];
  let decompositionCalls = 0, searchCalls = 0;
  try {
    await isolated(async () => {
      const response = await POST(new Request('http://localhost/api/verify', {
        method: 'POST', body: JSON.stringify({ claim }),
      }));
      assert.equal(response.status, 200);
      await consumeVerificationStream(response.body!, event => events.push(event));
    }, async (url, init) => {
      if (String(url).includes('tavily')) {
        searchCalls += 1;
        return Response.json({ request_id: 'fallback-search-id', results: [
          { url: SOURCE, title: 'Policy notice', score: 0.95, content: claim },
        ] });
      }
      const name = JSON.parse(String(init?.body)).tool_choice.function.name;
      if (name === 'record_assertions') {
        decompositionCalls += 1;
        throw new TypeError('simulated connection reset');
      }
      return completion(name, name === 'record_screening'
        ? { judgements: [{ index: 0, relevant: true, leaning: 'supports' }] }
        : { verdict: 'supported', confidence: 0.8, cited_urls: [SOURCE],
            rationale: 'The policy notice states the date.' });
    });
  } finally {
    if (priorDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabase;
    if (priorVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = priorVercel;
    if (priorShared === undefined) delete process.env.VERIFY_REQUIRE_SHARED_QUOTA;
    else process.env.VERIFY_REQUIRE_SHARED_QUOTA = priorShared;
  }
  const done = events.at(-1);
  assert.ok(done?.type === 'done');
  assert.equal(done.result.overall, 'supported');
  assert.equal(done.result.provenance?.decompositionFallback, 'whole_claim');
  assert.deepEqual(done.reviewPersistence, { status: 'skipped', savedAssertions: 0 });
  assert.equal(decompositionCalls, 2);
  assert.equal(searchCalls, 1);
  assert.ok(!events.some(event => event.type === 'error'));
  const report = liveReport(done.result, {}, undefined, null, done.reviewPersistence);
  assert.match(reportMarkdown(report), /Decomposition fallback: original claim checked/);
});

for (const [label, response] of [
  ['wrong tool', () => completion('unexpected', {})],
  ['truncated completion', () => completion('expected', {}, 'length')],
  ['non-object arguments', () => completion('expected', null)],
] as const) {
  test(`Nemotron rejects ${label}`, async () => isolated(async () => {
    await assert.rejects(callTool({ model: MODEL_DECOMPOSER, user: 'test', tool }));
  }, async () => response()));
}

for (const failedStage of ['retrieve', 'adjudicate'] as const) {
  test(`${failedStage} failure does not leak upstream body in verdict or done`, async () => {
    const events: VerifyEvent[] = [];
    const models: string[] = [];
    await isolated(async () => {
      for await (const event of runVerification('A policy claim.')) events.push(event);
    }, async (url, init) => {
      if (String(url).includes('tavily')) return failedStage === 'retrieve'
        ? new Response(SECRET, { status: 502 })
        : Response.json({ request_id: 'offline-id', results: [{ url: SOURCE, title: 'Notice', score: 0.9, content: 'Evidence' }] });
      const body = JSON.parse(String(init?.body));
      const name = body.tool_choice.function.name;
      models.push(body.model);
      if (name === 'record_verdict') return new Response(SECRET, { status: 502 });
      return completion(name, name === 'record_assertions'
        ? { assertions: [{ text: 'A policy claim.', search_query: 'policy' }] }
        : { judgements: [{ index: 0, relevant: true, leaning: 'unclear' }] });
    });
    assert.ok(events.some(e => e.type === 'error' && e.stage === failedStage && e.message.includes(SECRET)), 'server diagnostic retains detail');
    const publicResults = events.filter(e => e.type === 'done' || e.type === 'verdict');
    assert.ok(!JSON.stringify(publicResults).includes(SECRET), 'public result must be safe');
    const done = events.find(e => e.type === 'done');
    assert.ok(done?.type === 'done');
    assert.equal(done.result.overall, 'insufficient_evidence');
    assert.equal(done.result.stats.modelCalls, models.length, 'failed model requests count as attempts');
    assert.deepEqual(models, failedStage === 'retrieve'
      ? [MODEL_DECOMPOSER] : [MODEL_DECOMPOSER, MODEL_SCREENER, MODEL_ADJUDICATOR]);
  });
}

test('a pre-aborted run never contacts any upstream', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await isolated(async () => {
    await assert.rejects(async () => { for await (const event of runVerification('claim', { signal: controller.signal })) void event; });
    assert.equal(calls, 0);
  }, async () => { calls += 1; throw new Error('Unexpected upstream'); });
});

test('disconnect aborts in-flight inference and never starts retrieval', async () => {
  const controller = new AbortController();
  let calls = 0;
  await isolated(async () => {
    const run = (async () => { for await (const event of runVerification('claim', { signal: controller.signal })) void event; })();
    await assert.rejects(run, /abort/i);
    assert.equal(calls, 1);
  }, async (_url, init) => {
    calls += 1;
    assert.ok(init?.signal);
    queueMicrotask(() => controller.abort());
    return new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Abort did not reach upstream')), 100);
      init.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  });
});

test('malformed decomposition produces a completed failed stage, no search', async () => {
  const events: VerifyEvent[] = [];
  await isolated(async () => {
    for await (const event of runVerification('claim')) events.push(event);
  }, async () => completion('record_assertions', { assertions: [{ text: 'claim', search_query: null }] }));
  assert.ok(events.some(e => e.type === 'error' && e.stage === 'decompose'));
  assert.ok(events.some(e => e.type === 'stage' && e.stage === 'decompose' && e.status === 'done' && e.detail === 'failed'));
  assert.ok(!events.some(e => e.type === 'stage' && e.stage === 'retrieve'));
});

for (const mode of ['response cancel', 'request abort'] as const) {
  test(`SSE ${mode} stops upstream and closes without another call`, async () => {
    const controller = new AbortController();
    let calls = 0;
    let began!: () => void; let ended!: () => void;
    const started = new Promise<void>(resolve => { began = resolve; });
    const stopped = new Promise<void>(resolve => { ended = resolve; });
    await isolated(async () => {
      const response = await POST(new Request('http://localhost/api/verify', {
        method: 'POST', body: JSON.stringify({ claim: 'policy' }), signal: controller.signal,
      }));
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /padding/);
      await started;
      if (mode === 'response cancel') await reader.cancel();
      else { controller.abort(); while (!(await reader.read()).done) { /* drain queued stage */ } }
      await stopped;
      assert.equal(calls, 1);
      reader.releaseLock();
    }, async (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { ended(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
        began();
      });
    });
  });
}
