import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runVerification } from '../pipeline';
import type { VerificationResult } from '../types';

test('a later assertion receives a newly cited issuer passage despite two older cached pages', async () => {
  const previous = { nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY };
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline';
  const oldA = 'https://www.ato.gov.au/old-topic-a';
  const oldB = 'https://www.ato.gov.au/old-topic-b';
  const decisive = 'https://www.ato.gov.au/current-rule';
  let searches = 0;
  let verdicts = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://api.tavily.com/search') {
      searches += 1;
      const hits = searches === 1
        ? [{ url: oldA, title: 'Older official overview', score: .9, content: 'Australia topic overview.' },
          { url: oldB, title: 'Older official table', score: .8, content: 'Australia topic rate table.' }]
        : searches === 2
          ? [{ url: decisive, title: 'Issuing authority rule', score: .95,
            content: 'The issuing authority states the payment rule and its earlier-period exception.' }]
          : [{ url: 'https://example.com/commentary', title: 'Commentary', score: .9,
            content: 'A publisher discusses the payment rule.' }];
      return Response.json({ request_id: `search-${searches}`, results: hits });
    }
    assert.equal(String(input), 'https://api.tokenfactory.nebius.com/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    const name = body.tool_choice.function.name as string;
    const args = name === 'record_assertions'
      ? { assertions: [
        { text: 'Australia has a program.', search_query: 'Australia program' },
        { text: 'The program has a payment rule.', search_query: 'Australia payment rule' },
        { text: 'That payment rule covers an earlier period.', search_query: 'Australia earlier period rule' },
      ] }
      : name === 'record_screening'
        ? { judgements: Array.from({ length: 5 }, (_, index) =>
          ({ index, relevant: true, leaning: 'supports' })) }
        : { verdict: 'supported', confidence: .9,
          cited_urls: [++verdicts === 1 ? oldA : decisive],
          rationale: 'The cited issuing authority passage is relevant.' };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }],
    } }] });
  };
  try {
    let result: VerificationResult | undefined;
    for await (const event of runVerification('In Australia, the program has a payment rule for an earlier period.',
      { fetch, inspectSources: true, tavilyBudget: 3 })) {
      if (event.type === 'done') result = event.result;
    }
    assert.ok(result);
    assert.ok(result.provenance);
    assert.equal(result.stats.tavilyCalls, 3);
    const third = result.provenance.adjudicationEvidence.a3;
    assert.ok(third.some(doc => doc.url === decisive && doc.searchRequestId === 'search-2'));
    assert.ok(!third.some(doc => doc.url === oldB));
    assert.deepEqual(result.assertions[2].citedUrls, [decisive]);
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});
