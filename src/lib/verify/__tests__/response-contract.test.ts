import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runVerification } from '../pipeline';
import type { VerificationResult, VerifyEvent } from '../types';

const FIRST = 'https://example.gov/effective-date';
const SECOND = 'https://example.gov/background';
const healthy = { verdict: 'supported', confidence: .8, cited_urls: [FIRST], rationale: 'The supplied notice gives the claimed date.' };
const rows = [
  { index: 0, relevant: true, leaning: 'supports', reason: 'Effective date' },
  { index: 1, relevant: true, leaning: 'unclear', reason: 'Background' },
];

async function run(adjudication: unknown, judgements: unknown = rows) {
  const before = { NEBIUS_API_KEY: process.env.NEBIUS_API_KEY, TAVILY_API_KEY: process.env.TAVILY_API_KEY };
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-response-contract';
  const events: VerifyEvent[] = [], requests: string[] = [];
  let prompt = '';
  try {
    for await (const event of runVerification('The policy takes effect on 1 January 2026.', { maxAssertions: 1,
      fetch: async (url, init) => {
        if (String(url) === 'https://api.tavily.com/search') {
          requests.push('search');
          return Response.json({ request_id: 'offline', results: [
            { url: FIRST, title: 'Notice', score: .95, content: 'The policy takes effect on 1 January 2026.' },
            { url: SECOND, title: 'Background', score: .9, content: 'The ministry administers the policy.' },
          ] });
        }
        const body = JSON.parse(String(init?.body));
        const name = body.tool_choice.function.name;
        requests.push(name);
        if (name === 'record_verdict') prompt = body.messages.at(-1).content;
        const args = name === 'record_assertions' ? { assertions: [{ text: 'The policy takes effect on 1 January 2026.', search_query: 'policy effective date' }] }
          : name === 'record_screening' ? { judgements } : adjudication;
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
          tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }],
        } }] });
      },
    })) events.push(event);
  } finally {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  const done = events.find(e => e.type === 'done');
  assert.ok(done?.type === 'done');
  assert.deepEqual(requests, ['record_assertions', 'search', 'record_screening', 'record_verdict']);
  assert.equal(done.result.stats.modelCalls, 3);
  assert.equal(done.result.stats.tavilyCalls, 1);
  return { result: done.result as VerificationResult, events, prompt };
}

for (const [name, changes] of [
  ['missing confidence', { confidence: undefined }],
  ['string confidence', { confidence: '0.8' }],
  ['null confidence', { confidence: null }],
  ['out-of-range confidence', { confidence: 1.4 }],
  ['object rationale', { rationale: { text: 'An untrusted object' } }],
  ['blank rationale', { rationale: ' \n ' }],
  ['mixed citation types', { cited_urls: [FIRST, 12] }],
] as const) {
  test(`a parsed tool response with ${name} cannot produce a definitive answer`, async () => {
    const { result, events } = await run({ ...healthy, ...changes });
    assert.equal(result.overall, 'insufficient_evidence');
    assert.equal(result.assertions[0].confidence, 0);
    assert.match(result.assertions[0].rationale, /invalid.*(field|response)|malformed/i);
    for (const e of events) if (e.type === 'verdict') assert.equal(e.result.verdict, 'insufficient_evidence');
    assert.equal(result.provenance!.modelCalls!.at(-1)!.outcome, 'tool_returned', 'Syntax-level diagnostics must not imply acceptance');
    assert.equal(result.provenance!.adjudicationEvidence.a1.length, 2);
  });
}

test('duplicate contradictory screen indices cannot discard the decisive retrieved source', async () => {
  const { result, prompt, events } = await run(healthy, [rows[0], { ...rows[0], relevant: false, leaning: 'refutes' }, rows[1]]);
  assert.ok(prompt.includes(FIRST));
  assert.equal(result.overall, 'supported');
  const screened = events.find(e => e.type === 'screened');
  assert.ok(screened?.type === 'screened');
  assert.equal(screened.docs[0].relevant, true);
  assert.equal(screened.docs[0].leaning, 'unclear');
  assert.match(screened.docs[0].reason!, /valid.*judgement|unjudged/i);
});

test('malformed screening fields keep the affected source without poisoning valid independent rows', async () => {
  const { result, events, prompt } = await run(healthy, [
    { index: 0, relevant: 0, leaning: 'supports', reason: { private: 'NOT_A_SCREENING_STRING' } },
    rows[1], { index: 200, relevant: false, leaning: 'refutes' },
  ]);
  assert.ok(prompt.includes(FIRST));assert.equal(result.overall, 'supported');
  const screened = events.find(e => e.type === 'screened');assert.ok(screened?.type === 'screened');
  assert.equal(screened.docs[0].relevant, true);assert.equal(screened.docs[0].leaning, 'unclear');
  assert.equal(screened.docs[1].reason, 'Background');
  assert.ok(!JSON.stringify(events).includes('NOT_A_SCREENING_STRING'));
});

test('healthy judgements still discard an unrelated source and preserve the normal verdict', async () => {
  const { result, prompt } = await run(healthy, [rows[0], { index: 1, relevant: false, leaning: 'unclear' }]);
  assert.equal(result.overall, 'supported');assert.equal(result.assertions[0].confidence, .8);
  assert.ok(prompt.includes(FIRST));assert.ok(!prompt.includes(SECOND));
  assert.deepEqual(result.assertions[0].citedUrls, [FIRST]);
});

for (const [name, first] of [
  ['non-boolean relevance', { index: 0, relevant: 'false', leaning: 'refutes' }],
  ['unknown leaning', { index: 0, relevant: false, leaning: 'neutral' }],
  ['non-text explanation', { index: 0, relevant: false, leaning: 'refutes', reason: { private: 'NOT_A_SCREENING_STRING' } }],
] as const) {
  test(`a screening row with ${name} cannot discard evidence or fabricate its direction`, async () => {
    const { events, prompt } = await run(healthy, [first, rows[1]]);
    assert.ok(prompt.includes(FIRST));
    const screened = events.find(e => e.type === 'screened');
    assert.ok(screened?.type === 'screened');
    assert.equal(screened.docs[0].relevant, true);
    assert.equal(screened.docs[0].leaning, 'unclear');
    assert.ok(!JSON.stringify(events).includes('NOT_A_SCREENING_STRING'));
  });
}
