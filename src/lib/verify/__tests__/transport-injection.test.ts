import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool, MODEL_DECOMPOSER } from '../nemotron';
import { TavilyClient } from '../tavily';

// No-op control reruns these against the baseline clients, with network blocked.
test('Nemotron uses only the explicitly supplied transport', async () => {
  const priorFetch = globalThis.fetch;
  const priorKey = process.env.NEBIUS_API_KEY;
  let globalCalls = 0;
  let scopedCalls = 0;
  globalThis.fetch = async () => { globalCalls++; throw new Error('OFFLINE: global network blocked'); };
  process.env.NEBIUS_API_KEY = 'offline';
  try {
    const result = await callTool<{ ok: boolean }>({
      model: MODEL_DECOMPOSER, user: 'offline', tool: { name: 'record', description: 'fixture', parameters: {} },
      fetch: async () => {
        scopedCalls++;
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'record', arguments: '{"ok":true}' } }] } }] });
      },
    });
    assert.equal(result.args.ok, true);
    assert.equal(scopedCalls, 1);
    assert.equal(globalCalls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = priorKey;
  }
});
test('Tavily uses only the explicitly supplied transport', async () => {
  const priorFetch = globalThis.fetch;
  let globalCalls = 0;
  let scopedCalls = 0;
  globalThis.fetch = async () => { globalCalls++; throw new Error('OFFLINE: global network blocked'); };
  try {
    const result = await new TavilyClient(1, 'offline').search('offline', {
      fetch: async () => { scopedCalls++; return Response.json({ request_id: 'offline', results: [] }); },
    });
    assert.equal(result.requestId, 'offline');
    assert.equal(scopedCalls, 1);
    assert.equal(globalCalls, 0);
  } finally { globalThis.fetch = priorFetch; }
});

// Concurrent source-inspection feature must share scoped transport too.
test('Tavily extraction cannot bypass the supplied transport', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('OFFLINE: global network blocked'); };
  let calls = 0;
  try {
    const result = await new TavilyClient(1, 'offline').extract(['https://example.com'], 'offline', {
      fetch: async () => { calls++; return Response.json({ request_id: 'offline-extract', results: [] }); },
    });
    assert.equal(result.requestId, 'offline-extract');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
