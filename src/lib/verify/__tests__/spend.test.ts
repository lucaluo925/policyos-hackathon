import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetedModelFetch, configuredModelBudget, ModelBudgetStopped, type BudgetStore } from '../spend';
import { MODEL_ADJUDICATOR } from '../nemotron';

const budget = { id: 'offline-budget', capMicroUsd: 4_980_000, expiresAt: Date.now() + 60_000 };
const url = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const request = { method: 'POST', body: JSON.stringify({ model: MODEL_ADJUDICATOR, max_tokens: 4096 }) };
function setup(options: { deny?: boolean; status?: number; usage?: unknown; settleFails?: boolean } = {}) {
  const events: string[] = [];
  const abort = new AbortController();
  let amount = 0;
  const store: BudgetStore = {
    async reserve() { events.push('reserve'); if (options.deny) throw new ModelBudgetStopped('denied'); amount = 1_500_000; return 'row'; },
    async settle(id, cost) { assert.equal(id, 'row'); events.push('settle'); if (options.settleFails) throw new Error('db down'); amount = cost; },
  };
  const transport: typeof fetch = async () => {
    events.push('fetch');
    return Response.json({ usage: 'usage' in options ? options.usage : { prompt_tokens: 2575, completion_tokens: 706 } }, { status: options.status ?? 200 });
  };
  return { events, abort, amount: () => amount, fetch: budgetedModelFetch(budget, abort, transport, store) };
}

test('budget is reserved before network and settled with upward rounding and headroom', async () => {
  const run = setup();
  const response = await run.fetch(url, request);
  assert.deepEqual(run.events, ['reserve', 'fetch', 'settle']);
  assert.equal(run.amount(), 5867);
  assert.equal((await response.json()).usage.completion_tokens, 706, 'caller can still read the response');
});

test('denied reservation aborts recovery and sends no provider request', async () => {
  const run = setup({ deny: true });
  await assert.rejects(run.fetch(url, request), ModelBudgetStopped);
  await assert.rejects(run.fetch('https://api.tavily.com/search', {}), ModelBudgetStopped);
  assert.deepEqual(run.events, ['reserve']);
  assert.equal(run.abort.signal.aborted, true);
});

test('provider failure retains the entire reservation', async () => {
  const run = setup({ status: 500 });
  assert.equal((await run.fetch(url, request)).status, 500);
  assert.equal(run.amount(), 1_500_000);
  assert.deepEqual(run.events, ['reserve', 'fetch']);
});

test('a network disconnect cannot release a possibly billed reservation', async () => {
  let reserved = 0, settlements = 0;
  const abort = new AbortController();
  const fetcher = budgetedModelFetch(budget, abort, async () => { throw new Error('connection lost'); }, {
    async reserve() { reserved = 1_500_000; return 'row'; },
    async settle() { settlements++; },
  });
  await assert.rejects(fetcher(url, request), ModelBudgetStopped);
  assert.equal(reserved, 1_500_000);
  assert.equal(settlements, 0);
  assert.equal(abort.signal.aborted, true);
});

test('missing, partial, negative and oversized usage never refund and stop the run', async () => {
  for (const usage of [null, {}, { prompt_tokens: 10 }, { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 100, completion_tokens: 9000 }, { prompt_tokens: 1_048_577, completion_tokens: 100 }]) {
    const run = setup({ usage });
    await assert.rejects(run.fetch(url, request), ModelBudgetStopped);
    assert.equal(run.amount(), 1_500_000);
    assert.equal(run.abort.signal.aborted, true);
  }
});

test('settlement database failure retains reservation and stops subsequent work', async () => {
  const run = setup({ settleFails: true });
  await assert.rejects(run.fetch(url, request), ModelBudgetStopped);
  assert.equal(run.amount(), 1_500_000);
  await assert.rejects(run.fetch(url, request), ModelBudgetStopped);
  assert.equal(run.events.filter(x => x === 'fetch').length, 1);
});

test('unapproved models, multiple outputs, streaming and overlarge bodies fail before network', async () => {
  for (const changes of [{ model: 'other' }, { n: 2 }, { stream: true }, { max_tokens: 8193 }, { text: 'x'.repeat(131_073) }]) {
    const run = setup();
    await assert.rejects(run.fetch(url, { method: 'POST', body: JSON.stringify({ model: MODEL_ADJUDICATOR, max_tokens: 4096, ...changes }) }), ModelBudgetStopped);
    assert.deepEqual(run.events, []);
  }
});

test('budget configuration requires an explicit, unexpired campaign and positive dollar cap', () => {
  const keys = ['VERIFY_MODEL_BUDGET_ID', 'VERIFY_MODEL_BUDGET_USD', 'VERIFY_MODEL_BUDGET_EXPIRES_AT'];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.VERIFY_MODEL_BUDGET_ID = 'test-campaign';
    process.env.VERIFY_MODEL_BUDGET_USD = '4.98';
    process.env.VERIFY_MODEL_BUDGET_EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();
    assert.equal(configuredModelBudget().capMicroUsd, 4_980_000);
    process.env.VERIFY_MODEL_BUDGET_USD = '4.98oops';
    assert.throws(configuredModelBudget, ModelBudgetStopped);
    process.env.VERIFY_MODEL_BUDGET_USD = '4.98';
    process.env.VERIFY_MODEL_BUDGET_EXPIRES_AT = '2000-01-01';
    assert.throws(configuredModelBudget, ModelBudgetStopped);
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
