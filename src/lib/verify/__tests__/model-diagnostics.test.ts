import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, MODEL_DECOMPOSER, type ModelCallDiagnostic } from '../nemotron';
import { runVerification } from '../pipeline';
import { liveReport, reportMarkdown } from '../report';
import type { VerifyEvent } from '../types';

const SECRET = 'PROVIDER_PRIVATE_BODY_SENTINEL';
const tool = { name: 'expected', description: 'fixture', parameters: { type: 'object' } };
const response = (name = tool.name, args = '{"ok":true}', finish = 'tool_calls', usage: unknown = {
  prompt_tokens: 42, completion_tokens: 2048, completion_tokens_details: { reasoning_tokens: 1800 },
}) => Response.json({ choices: [{ finish_reason: finish,
  message: { tool_calls: [{ function: { name, arguments: args } }] } }], usage });

async function capture(fetcher: typeof fetch, observerThrows = false) {
  const before = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'offline-key';
  const records: ModelCallDiagnostic[] = [];
  let error: unknown, result;
  try {
    result = await callTool({ model: MODEL_DECOMPOSER, user: SECRET, tool, fetch: fetcher,
      onDiagnostic: r => { records.push(r); if (observerThrows) throw new Error('observer error'); } });
  } catch (e) { error = e; }
  finally { if (before === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = before; }
  assert.equal(records.length, 1, 'Exactly one diagnostic per attempted provider call');
  assert.ok(!JSON.stringify(records).includes(SECRET), 'Diagnostics must exclude prompts, arguments and bodies');
  return { record: records[0], error, result };
}

test('HTTP 200 length termination remains a failed call with finish reason and usage', async () => {
  const { record, error } = await capture(async () => response(tool.name, '{"ok":true}', 'length'));
  assert.ok(error);
  assert.equal(record.httpStatus, 200);
  assert.equal(record.outcome, 'failed');
  assert.equal(record.failureKind, 'truncated');
  assert.equal(record.finishReason, 'length');
  assert.deepEqual(record.usage, { promptTokens: 42, completionTokens: 2048, reasoningTokens: 1800 });
});

for (const [label, provider, kind] of [
  ['HTTP error', () => new Response(SECRET, { status: 502 }), 'http_error'],
  ['invalid response', () => new Response('{'+SECRET, { status: 200 }), 'invalid_response'],
  ['wrong tool', () => response('wrong', `{"secret":"${SECRET}"}`), 'tool_mismatch'],
  ['invalid arguments', () => response(tool.name, SECRET), 'invalid_arguments'],
] as const) {
  test(`diagnostics classify ${label} without publishing payload text`, async () => {
    const { record, error } = await capture(async () => provider());
    assert.ok(error);
    assert.equal(record.failureKind, kind);
    assert.equal(record.outcome, 'failed');
  });
}

test('untrusted usage and finish labels cannot turn into published metadata', async () => {
  const { record, result } = await capture(async () => response(tool.name, '{"ok":true}', SECRET,
    { prompt_tokens: SECRET, completion_tokens: -1, completion_tokens_details: { reasoning_tokens: 1.2 } }));
  assert.deepEqual(result?.args, { ok: true });
  assert.equal(record.finishReason, 'other');
  assert.equal(record.outcome, 'tool_returned');
  assert.equal(record.failureKind, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(record.usage)), {});
});

test('observer errors do not alter a usable response or trigger a retry', async () => {
  let requests = 0;
  const { record, result, error } = await capture(async () => { requests++; return response(); }, true);
  assert.equal(requests, 1);
  assert.equal(error, undefined);
  assert.deepEqual(result?.args, { ok: true });
  assert.equal(record.outcome, 'tool_returned');
});

test('one decomposition timeout retries once and records both paid-call attempts', async () => {
  const key = process.env.NEBIUS_API_KEY, searchKey = process.env.TAVILY_API_KEY;
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const events: VerifyEvent[] = [];
  let decomposerCalls = 0;
  try {
    for await (const event of runVerification('The policy starts in 2026.', {
      decomposeTimeoutMs: 10,
      fetch: async (url, init) => {
        if (String(url).includes('tavily')) return Response.json({ request_id: 'offline-search', results: [
          { url: 'https://example.gov/notice', title: 'Notice', score: .9,
            content: 'The policy starts in 2026.' },
        ] });
        const name = JSON.parse(String(init?.body)).tool_choice.function.name;
        if (name === 'record_assertions' && ++decomposerCalls === 1) {
          const signal = init?.signal as AbortSignal;
          return new Promise<Response>((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        const args = name === 'record_assertions'
          ? { assertions: [{ text: 'The policy starts in 2026.', search_query: 'policy start 2026' }] }
          : name === 'record_screening'
            ? { judgements: [{ index: 0, relevant: true, leaning: 'supports' }] }
            : { verdict: 'supported', confidence: .8, cited_urls: ['https://example.gov/notice'],
                rationale: 'The notice states the date.' };
        return response(name, JSON.stringify(args));
      },
    })) events.push(event);
  } finally {
    if (key === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = key;
    if (searchKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = searchKey;
  }
  const done = events.find(event => event.type === 'done');
  assert.ok(done?.type === 'done');
  assert.equal(decomposerCalls, 2);
  assert.equal(done.result.stats.modelCalls, 4);
  assert.deepEqual(done.result.provenance?.modelCalls?.slice(0, 2).map(call =>
    [call.outcome, call.failureKind ?? null]), [['failed', 'timeout'], ['tool_returned', null]]);
});

test('invalid decomposition response is not retried', async () => {
  const key = process.env.NEBIUS_API_KEY, searchKey = process.env.TAVILY_API_KEY;
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  let calls = 0;
  const events: VerifyEvent[] = [];
  try {
    for await (const event of runVerification('A claim.', { fetch: async () => {
      calls += 1;
      return new Response('{invalid json', { status: 200 });
    } })) events.push(event);
  } finally {
    if (key === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = key;
    if (searchKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = searchKey;
  }
  assert.equal(calls, 1);
  assert.ok(events.some(event => event.type === 'error' && event.stage === 'decompose'));
  assert.ok(!events.some(event => event.type === 'done'));
});

test('pipeline preserves failed adjudication diagnostics in a downloadable unresolved result', async () => {
  const key = process.env.NEBIUS_API_KEY, searchKey = process.env.TAVILY_API_KEY;
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const events: VerifyEvent[] = [];
  try {
    for await (const event of runVerification('Fixed public claim.', { fetch: async (url, init) => {
      if (String(url).includes('tavily')) return Response.json({ request_id: 'offline-search', results: [
        { url: 'https://example.gov/notice', title: 'Notice', score: .9, content: 'Source text.' },
      ] });
      const name = JSON.parse(String(init?.body)).tool_choice.function.name;
      const args = name === 'record_assertions' ? { assertions: [{ text: 'Fixed public claim.', search_query: 'fixed' }] }
        : name === 'record_screening' ? { judgements: [{ index: 0, relevant: true, leaning: 'unclear' }] }
        : { verdict: 'supported', confidence: .9, cited_urls: ['https://example.gov/notice'], rationale: SECRET };
      return response(name, JSON.stringify(args), name === 'record_verdict' ? 'length' : 'tool_calls');
    } })) events.push(event);
  } finally {
    if (key === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = key;
    if (searchKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = searchKey;
  }
  const finished = events.find(e => e.type === 'done');
  assert.ok(finished?.type === 'done');
  assert.equal(finished.result.overall, 'insufficient_evidence');
  const calls = finished.result.provenance!.modelCalls!;
  assert.equal(calls.length, finished.result.stats.modelCalls);
  assert.deepEqual(calls.map(c => c.stage), ['decompose', 'screen', 'adjudicate', 'adjudicate']);
  assert.equal(calls[2].failureKind, 'truncated');
  assert.equal(calls[2].assertionId, 'a1');
  assert.equal(calls[3].failureKind, 'truncated');
  const report = liveReport(finished.result, {});
  assert.ok(!JSON.stringify(report).includes(SECRET));
  assert.match(reportMarkdown(report), /length.*truncated/);
  delete finished.result.provenance!.modelCalls;
  assert.equal(liveReport(finished.result, {}).modelCalls, null, 'Never infer old termination reasons from token counts');
});

test('one bounded adjudication retry recovers a length-only failure and records both attempts', async () => {
  const key = process.env.NEBIUS_API_KEY, searchKey = process.env.TAVILY_API_KEY;
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const events: VerifyEvent[] = [];
  const ceilings: number[] = [];
  try {
    for await (const event of runVerification('A fixed policy claim.', { fetch: async (url, init) => {
      if (String(url).includes('tavily')) return Response.json({ request_id: 'offline-search', results: [
        { url: 'https://example.gov/notice', title: 'Notice', score: .9, content: 'The policy applies.' },
      ] });
      const body = JSON.parse(String(init?.body));
      const name = body.tool_choice.function.name;
      const args = name === 'record_assertions' ? { assertions: [{ text: 'A fixed policy claim.', search_query: 'fixed policy' }] }
        : name === 'record_screening' ? { judgements: [{ index: 0, relevant: true, leaning: 'supports' }] }
        : { verdict: 'supported', confidence: .9, cited_urls: ['https://example.gov/notice'], rationale: 'The notice confirms the policy.' };
      if (name === 'record_verdict') ceilings.push(body.max_tokens);
      return response(name, JSON.stringify(args), name === 'record_verdict' && ceilings.length === 1 ? 'length' : 'tool_calls');
    } })) events.push(event);
  } finally {
    if (key === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = key;
    if (searchKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = searchKey;
  }
  const finished = events.find(e => e.type === 'done');
  assert.ok(finished?.type === 'done');
  assert.equal(finished.result.overall, 'supported');
  assert.deepEqual(ceilings, [4096, 6144]);
  assert.equal(finished.result.stats.modelCalls, 4);
  assert.deepEqual(finished.result.provenance?.modelCalls?.slice(-2).map(c => c.outcome),
    ['failed', 'tool_returned']);
});
