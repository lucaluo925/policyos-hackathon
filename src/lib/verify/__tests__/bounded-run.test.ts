import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_PUBLIC_CLAIM, BOUNDED_STEPS, createBoundedTransport, runBoundedVerification, BoundedRunError, type BoundedApproval } from '../bounded-run';
import { MODEL_DECOMPOSER, MODEL_ADJUDICATOR } from '../nemotron';

// Synthetic offline fixtures. These rates/token counts are NOT live authorization facts.
const url = 'https://www.gov.uk/government/news/uk-leaves-european-union';
const assertion = { text: APPROVED_PUBLIC_CLAIM, search_query: 'UK left EU 31 January 2020 gov.uk' };
const decomposition = tool('record_assertions', { assertions: [assertion] });
const retrieval = { request_id: 'offline-search', results: [{ url, title: 'UK leaves EU', score: 0.9, content: APPROVED_PUBLIC_CLAIM }] };
const responses = [
  decomposition,
  retrieval,
  tool('record_screening', { judgements: [{ index: 0, relevant: true, leaning: 'supports' }] }),
  tool('record_verdict', { verdict: 'supported', confidence: 0.9, cited_urls: [url], rationale: 'Offline fixture only.' }),
];
function tool(name: string, args: unknown) {
  return { id: 'offline-model', choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 30, completion_tokens: 40 } };
}
function approval(): BoundedApproval {
  return {
    approved: true, claim: APPROVED_PUBLIC_CLAIM, checkedAt: Date.now(), validUntil: Date.now() + 60000,
    giftBalanceUsd: 1, giftSpendCapUsd: 1, cashSpendCapUsd: 0, payAsYouGoDisabled: true, tavilyCreditsAvailable: 1, tavilyCreditsValidUntil: Date.now() + 60000,
    rates: {
      [MODEL_DECOMPOSER]: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
      [MODEL_ADJUDICATOR]: { inputPerMillionUsd: 3, outputPerMillionUsd: 4 },
    },
    tavilyBasicUsd: 0.008, taxMultiplier: 1,
    tokenizer: { identity: 'OFFLINE fixture counter', verifiedBasis: 'synthetic test only', upperBound: () => 1000 },
  };
}
const previous = { nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY };
before(() => { process.env.NEBIUS_API_KEY = 'offline'; process.env.TAVILY_API_KEY = 'offline'; });
after(() => {
  if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = previous.nebius;
  if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previous.tavily;
});
function fixture(change?: (data: typeof responses, bodies: Record<string, unknown>[]) => void) {
  const data = structuredClone(responses);
  const bodies: Record<string, unknown>[] = [];
  change?.(data, bodies);
  let calls = 0;
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(data[calls++]);
  };
  return { fetch, bodies, get calls() { return calls; } };
}
test('offline approved pipeline makes exactly Super/search/Super/Ultra, captures usage, no persistence', async () => {
  const offline = fixture();
  const output = await runBoundedVerification({ approval: approval(), fetch: offline.fetch });
  assert.equal(output.result.overall, 'supported');
  assert.equal(offline.calls, 4);
  assert.deepEqual(output.requests.map(r => r.stage), BOUNDED_STEPS.map(s => s.tool));
  assert.deepEqual(output.requests.map(r => r.model), [MODEL_DECOMPOSER, null, MODEL_DECOMPOSER, MODEL_ADJUDICATOR]);
  assert.equal(output.requests[0].promptTokens, 30);
  assert.ok(output.ceilingUsd < 1);
  assert.ok(!JSON.stringify(output.requests).includes('Bearer'));
});
for (const [label, change] of [
  ['missing authorization', (a: BoundedApproval) => { a.approved = false as true; }],
  ['expired balance', (a: BoundedApproval) => { a.validUntil = Date.now() - 1; }],
  ['unverified tokenizer', (a: BoundedApproval) => { a.tokenizer.verifiedBasis = ''; }],
  ['missing model price', (a: BoundedApproval) => { delete a.rates[MODEL_ADJUDICATOR]; }],
  ['insufficient credit', (a: BoundedApproval) => { a.giftBalanceUsd = 0.001; }],
  ['separate search credits exhausted', (a: BoundedApproval) => { a.tavilyCreditsAvailable = 0; }],
  ['search credits expired', (a: BoundedApproval) => { a.tavilyCreditsValidUntil = Date.now() - 1; }],
  ['cash risk', (a: BoundedApproval) => { a.payAsYouGoDisabled = false as true; }],
  ['stale account check', (a: BoundedApproval) => { a.checkedAt -= 3600_001; }],
] as const) {
  test(`preflight blocks ${label} before network`, async () => {
    const a = approval(); change(a); const offline = fixture();
    await assert.rejects(runBoundedVerification({ approval: a, fetch: offline.fetch }));
    assert.equal(offline.calls, 0);
  });
}
for (const [label, step, replacement] of [
  ['multiple assertions', 0, tool('record_assertions', { assertions: [assertion, assertion] })],
  ['malformed assertion', 0, tool('record_assertions', { assertions: [{ ...assertion, text: '' }] })],
  ['missing usage', 0, { choices: decomposition.choices }],
  ['excess usage', 0, { ...responses[0], usage: { prompt_tokens: 1001, completion_tokens: 40 } }],
  ['truncated tool', 0, { ...responses[0], choices: [{ finish_reason: 'length', message: decomposition.choices[0].message }] }],
  ['wrong tool', 0, tool('other', { assertions: [assertion] })],
  ['empty retrieval', 1, { request_id: 'empty', results: [] }],
  ['poor retrieval', 1, { ...responses[1], results: [{ ...retrieval.results[0], score: 0.09 }] }],
  ['oversized URL', 1, { ...responses[1], results: [{ ...retrieval.results[0], url: `https://example.com/${'a'.repeat(3000)}` }] }],
  ['oversized title', 1, { ...responses[1], results: [{ ...retrieval.results[0], title: 'a'.repeat(3000) }] }],
  ['missing request id', 1, { results: retrieval.results }],
  ['malformed screening', 2, tool('record_screening', { judgements: [{ index: 0, relevant: 'false', leaning: 'supports' }] })],
  ['missing citation', 3, tool('record_verdict', { verdict: 'supported', confidence: 0.9, cited_urls: [], rationale: 'fixture' })],
  ['unseen citation', 3, tool('record_verdict', { verdict: 'supported', confidence: 0.9, cited_urls: ['https://invented.example'], rationale: 'fixture' })],
] as const) {
  test(`stops on ${label}, never retries or continues`, async () => {
    const offline = fixture(data => { data[step] = replacement as typeof data[number]; });
    await assert.rejects(runBoundedVerification({ approval: approval(), fetch: offline.fetch }));
    assert.equal(offline.calls, step + 1);
  });
}
for (const status of [401, 403, 429, 500, 503]) {
  test(`HTTP ${status} stops after one possibly billed attempt`, async () => {
    let calls = 0;
    await assert.rejects(runBoundedVerification({ approval: approval(), fetch: async () => { calls++; return new Response('private sentinel', { status }); } }), /Bounded/);
    assert.equal(calls, 1);
  });
}
test('input token upper bound is checked before I/O', async () => {
  const a = approval(); a.tokenizer.upperBound = () => 1501;
  const offline = fixture();
  await assert.rejects(runBoundedVerification({ approval: a, fetch: offline.fetch }));
  assert.equal(offline.calls, 0);
});
test('deadline stops a transport that ignores abort; no followup request', async () => {
  let calls = 0;
  await assert.rejects(runBoundedVerification({ approval: approval(), timeoutMs: 15, fetch: async () => { calls++; return new Promise<Response>(() => {}); } }));
  assert.equal(calls, 1);
});
test('caller abort and invalid deadline block all network', async () => {
  const controller = new AbortController(); controller.abort();
  const offline = fixture();
  await assert.rejects(runBoundedVerification({ approval: approval(), signal: controller.signal, fetch: offline.fetch }));
  await assert.rejects(runBoundedVerification({ approval: approval(), timeoutMs: 120001, fetch: offline.fetch }));
  assert.equal(offline.calls, 0);
});
async function captured() {
  const requests: Array<[string, RequestInit]> = [];
  const offline = fixture();
  await runBoundedVerification({ approval: approval(), fetch: async (input, init) => {
    requests.push([String(input), init!]); return offline.fetch(input, init);
  } });
  // The prior run closed its signal. Use new signals for replaying synthetic requests.
  return requests.map(([url, init]) => [url, { ...init, signal: undefined }] as const);
}
for (const fault of ['endpoint', 'model', 'order', 'output', 'bytes'] as const) {
  test(`transport rejects ${fault} before I/O`, async () => {
    const requests = await captured();
    const [url, init] = requests[fault === 'order' ? 1 : 0];
    const body = JSON.parse(String(init.body));
    if (fault === 'model') body.model = MODEL_ADJUDICATOR;
    if (fault === 'output') body.max_tokens++;
    if (fault === 'bytes') body.messages[0].content = 'a'.repeat(10000);
    let calls = 0;
    const controller = new AbortController();
    const transport = createBoundedTransport({ approval: approval(), controller, fetch: async () => { calls++; return Response.json(responses[0]); } });
    await assert.rejects(transport.fetch(fault === 'endpoint' ? 'https://evil.example' : url, { ...init, body: JSON.stringify(body) }));
    assert.equal(calls, 0);
    assert.equal(controller.signal.aborted, true);
  });
}
test('fifth request blocked; record getter cannot alter reservation state', async () => {
  const requests = await captured(); const offline = fixture(); const controller = new AbortController();
  const transport = createBoundedTransport({ approval: approval(), fetch: offline.fetch, controller });
  for (const [url, init] of requests) await transport.fetch(url, init);
  (transport.records as unknown[]).length = 0;
  await assert.rejects(transport.fetch(...requests[0]));
  assert.equal(offline.calls, 4);
  assert.equal(transport.records.length, 4);
});
test('concurrent request stops run with only the first reservation dispatched', async () => {
  const requests = await captured(); let calls = 0; const controller = new AbortController();
  const transport = createBoundedTransport({ approval: approval(), controller, fetch: async () => { calls++; return new Promise<Response>(() => {}); } });
  const pending = transport.fetch(...requests[0]);
  await assert.rejects(transport.fetch(...requests[0]));
  await assert.rejects(pending);
  assert.equal(calls, 1);
});

test('failure evidence retains possibly billed reservation without raw response or key', async () => {
  await assert.rejects(runBoundedVerification({ approval: approval(), fetch: async () => new Response('PRIVATE_SENTINEL', { status: 429 }) }), error => {
    assert.ok(error instanceof BoundedRunError);
    assert.equal(error.requests.length, 1);
    assert.ok(error.requests[0].reservedUsd > 0);
    assert.ok(!JSON.stringify(error).includes('PRIVATE_SENTINEL'));
    return true;
  });
});
test('response byte cap aborts before subsequent calls', async () => {
  let calls = 0;
  await assert.rejects(runBoundedVerification({ approval: approval(), fetch: async () => { calls++; return new Response('a'.repeat(262145)); } }));
  assert.equal(calls, 1);
});
