import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runVerification } from '../pipeline';
import type { VerificationResult, VerifyEvent } from '../types';

const SOURCE = 'https://www.federalregister.gov/documents/test-policy';
const UNSEEN = 'https://example.com/not-retrieved';

/** Exercise the production generator with fixed upstream responses, without API spend. */
async function verify(adjudication: Record<string, unknown>, options: { snippet?: string; scores?: number[] } = {}) {
  const originalFetch = globalThis.fetch;
  const originalNebius = process.env.NEBIUS_API_KEY;
  const originalTavily = process.env.TAVILY_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-only';
  process.env.TAVILY_API_KEY = 'test-only';
  const toolNames: string[] = [];
  const outputCaps: Record<string, number> = {};
  let searchCalls = 0;
  let adjudicatorPrompt = '';
  let screenerPrompt = '';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://api.tavily.com/search') {
      searchCalls += 1;
      return Response.json({ request_id: searchCalls === 1 ? 'recorded-request' : 'retry-request', results: [
        { url: SOURCE, title: 'Policy notice', score: options.scores?.[searchCalls - 1] ?? 0.95,
          content: options.snippet ?? 'The policy takes effect in 2026.' },
      ] });
    }
    assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    const name = body.tool_choice.function.name as string;
    toolNames.push(name);
    outputCaps[name] = body.max_tokens;
    if (name === 'record_verdict') adjudicatorPrompt = body.messages.at(-1).content;
    if (name === 'record_screening') screenerPrompt = body.messages.at(-1).content;
    const args = name === 'record_assertions'
      ? { assertions: [{ text: 'The policy takes effect in 2026.', search_query: 'policy effective 2026' }] }
      : name === 'record_screening'
        ? { judgements: [{ index: 0, relevant: true, leaning: 'supports', reason: 'Policy notice' }] }
        : adjudication;
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }],
    } }] });
  };
  try {
    const events: VerifyEvent[] = [];
    let result: VerificationResult | undefined;
    for await (const event of runVerification('The policy takes effect in 2026.')) {
      events.push(event);
      if (event.type === 'done') result = event.result;
    }
    assert.ok(result, 'pipeline must finish');
    assert.deepEqual(toolNames, ['record_assertions', 'record_screening', 'record_verdict']);
    assert.deepEqual(result.tavilyRequestIds, searchCalls === 1 ? ['recorded-request'] : ['recorded-request', 'retry-request']);
    assert.equal(result.stats.tavilyCalls, searchCalls);
    return { result, events, adjudicatorPrompt, screenerPrompt, outputCaps };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = originalNebius;
    if (originalTavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalTavily;
  }
}

test('the adjudicator has room to return a tool call after long reasoning', async () => {
  const { outputCaps } = await verify({ verdict: 'supported', confidence: 0.8,
    cited_urls: [SOURCE], rationale: 'Confirmed.' });
  assert.equal(outputCaps.record_assertions, 3072);
  assert.equal(outputCaps.record_screening, 2048);
  assert.equal(outputCaps.record_verdict, 4096);
});

test('a supported answer without citations stays unresolved throughout the stream', async () => {
  const { result, events } = await verify({ verdict: 'supported', confidence: 0.99, rationale: 'It is true.' });
  assert.equal(result.overall, 'insufficient_evidence');
  assert.equal(result.assertions[0].confidence, 0);
  assert.match(result.assertions[0].rationale, /citation/i);
  const verdict = events.find((event) => event.type === 'verdict');
  assert.ok(verdict?.type === 'verdict');
  assert.equal(verdict.result.verdict, result.overall);
  assert.ok(events.some((event) => event.type === 'stage' && event.stage === 'adjudicate'
    && event.status === 'done' && event.detail === result.overall));
});

test('invented citations cannot preserve a refuted verdict', async () => {
  const { result } = await verify({ verdict: 'refuted', confidence: 0.98, cited_urls: [UNSEEN], rationale: 'It is false.' });
  assert.equal(result.overall, 'insufficient_evidence');
  assert.equal(result.assertions[0].confidence, 0);
  assert.deepEqual(result.assertions[0].citedUrls, []);
});

test('a real citation keeps the verdict while invented and duplicate URLs are removed', async () => {
  const { result } = await verify({ verdict: 'supported', confidence: 0.8,
    cited_urls: [UNSEEN, SOURCE, SOURCE], rationale: 'The notice establishes the date.' });
  assert.equal(result.overall, 'supported');
  assert.equal(result.assertions[0].confidence, 0.8);
  assert.deepEqual(result.assertions[0].citedUrls, [SOURCE]);
});

test('an unresolved answer may have no citation without losing its explanation', async () => {
  const { result } = await verify({ verdict: 'insufficient_evidence', confidence: 0.7,
    cited_urls: [], rationale: 'The date is not settled by the excerpt.' });
  assert.equal(result.overall, 'insufficient_evidence');
  assert.equal(result.assertions[0].confidence, 0.7);
  assert.equal(result.assertions[0].rationale, 'The date is not settled by the excerpt.');
});

test('malformed citation output fails closed without crashing the generator', async () => {
  const { result, events } = await verify({ verdict: 'supported', confidence: 0.9,
    cited_urls: SOURCE, rationale: 'The date is confirmed.' });
  assert.equal(result.overall, 'insufficient_evidence');
  assert.equal(result.assertions[0].confidence, 0);
  assert.equal(events.filter((event) => event.type === 'error').length, 0);
});

test('an unknown verdict cannot keep the model confidence', async () => {
  const { result } = await verify({ verdict: 'certainly_true', confidence: 0.95,
    cited_urls: [SOURCE], rationale: 'True.' });
  assert.equal(result.overall, 'insufficient_evidence');
  assert.equal(result.assertions[0].confidence, 0);
});

test('saved prompt excerpts match the text actually sent to the adjudicator', async () => {
  const snippet = 'The policy takes effect in 2026. '.repeat(50);
  const { result, adjudicatorPrompt } = await verify({ verdict: 'supported', confidence: 0.8,
    cited_urls: [SOURCE], rationale: 'Confirmed.' }, { snippet });
  const provenance = result.provenance;
  assert.ok(provenance);
  assert.equal(provenance.adjudicationEvidence.a1[0].snippet, snippet.slice(0, 900));
  assert.ok(adjudicatorPrompt.includes(`EXCERPT: ${provenance.adjudicationEvidence.a1[0].snippet}`));
  assert.ok(!adjudicatorPrompt.includes(snippet.slice(0, 901)));
  assert.ok(Date.parse(provenance.completedAt) >= Date.parse(provenance.startedAt));
  assert.equal(provenance.models.decomposer, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(provenance.models.adjudicator, 'nvidia/Nemotron-3-Ultra-550b-a55b');
});

test('screening sees the decisive part of the same bounded excerpt as adjudication', async () => {
  const snippet = `${'CBAM background. '.repeat(44)}The single mass-based threshold is 50 tonnes.`;
  assert.ok(snippet.indexOf('50 tonnes') > 600);
  assert.ok(snippet.indexOf('50 tonnes') < 900);
  const { screenerPrompt, adjudicatorPrompt } = await verify({ verdict: 'supported', confidence: .8,
    cited_urls: [SOURCE], rationale: 'Confirmed.' }, { snippet });
  assert.match(screenerPrompt, /single mass-based threshold is 50 tonnes/);
  assert.match(adjudicatorPrompt, /single mass-based threshold is 50 tonnes/);
});

test('the generator retains a same-topic official page despite a mistaken screening rejection', async () => {
  const previous = { fetch: globalThis.fetch, nebius: process.env.NEBIUS_API_KEY,
    tavily: process.env.TAVILY_API_KEY };
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const commission = 'https://taxation-customs.ec.europa.eu/cbam-definitive-regime';
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/search')) return Response.json({ request_id: 'search-1', results: [
      { url: commission, title: 'CBAM definitive regime', score: .9,
        content: 'EU importers above the 50-tonne annual threshold must apply for authorised CBAM declarant status.' },
      { url: 'https://example.org/recipe', title: 'Bread recipe', score: .8, content: 'Bake bread.' },
      { url: 'https://example.org/cbam-commentary', title: 'CBAM commentary', score: .8,
        content: 'CBAM authorisation depends on the 50-tonne annual threshold.' },
    ] });
    const body = JSON.parse(String(init?.body));
    const name = body.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? { assertions: [{ text: 'EU CBAM declarant status is required regardless of import quantity.',
        search_query: 'EU CBAM declarant status import quantity' }] }
      : name === 'record_screening'
        ? { judgements: [
          { index: 0, relevant: false, leaning: 'supports', reason: 'Misread threshold.' },
          { index: 1, relevant: false, leaning: 'unclear' },
          { index: 2, relevant: true, leaning: 'refutes' },
        ] }
        : { verdict: 'refuted', confidence: .9, cited_urls: [commission],
          rationale: 'Commission threshold refutes a quantity-independent requirement.' };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }],
    } }] });
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification('EU CBAM declarant status is required regardless of import quantity.'))
      events.push(event);
    const screened = events.find(event => event.type === 'screened');
    const done = events.find(event => event.type === 'done');
    assert.ok(screened?.type === 'screened');
    assert.ok(done?.type === 'done');
    assert.equal(screened.docs[0].relevant, true);
    assert.equal(screened.docs[0].leaning, 'unclear');
    assert.match(screened.docs[0].reason, /kept after screener rejection/);
    assert.equal(screened.docs[1].relevant, false);
    assert.equal(done.result.overall, 'refuted');
    assert.deepEqual(done.result.assertions[0].citedUrls, [commission]);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('evidence chosen from a retry carries that retry request ID', async () => {
  const { result, events } = await verify({ verdict: 'supported', confidence: 0.8,
    cited_urls: [SOURCE], rationale: 'Confirmed.' }, { scores: [0.05, 0.95] });
  const event = events.find((event) => event.type === 'evidence');
  assert.ok(event?.type === 'evidence');
  assert.equal(event.tavilyRequestId, 'retry-request');
  assert.equal(event.docs[0].retrievalScore, 0.95);
  assert.equal(result.stats.tavilyCalls, 2);
});
