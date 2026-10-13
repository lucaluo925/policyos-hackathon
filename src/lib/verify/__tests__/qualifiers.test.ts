import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingQualifiers, qualifierSearchQuery, scopedHitAddsQualifier } from '../qualifiers';
import { needsOfficialSearch } from '../official-search';
import { inspectSourceExcerpts } from '../source-inspection';
import { runVerification } from '../pipeline';
import type { VerifyEvent } from '../types';

test('a broad official summary cannot suppress search for an omitted coordinated category', () => {
  const claim = 'Teachers and nurses receive permits valid for five years from the date of issue.';
  const summary = 'Teachers receive permits valid for two years.';
  assert.deepEqual(missingQualifiers(claim, summary), ['nurses', 'date of issue']);
  assert.equal(needsOfficialSearch(claim, [{url: 'https://www.gov.uk/rules', snippet: summary}], ['gov.uk']), true);
  const correction = 'Teachers and nurses receive permits valid for two years from the date of issue.';
  assert.equal(needsOfficialSearch(claim, [{url: 'https://www.gov.uk/rules', snippet: correction}], ['gov.uk']), false,
    'The false quantity must not force a search once the category and clock start are covered');
  assert.equal(scopedHitAddsQualifier(claim, summary, correction), true);
  assert.equal(scopedHitAddsQualifier(claim, summary, 'Teachers receive permits valid for five years.'), false);
});

test('a repaired query preserves the omitted scope without inventing an answer', () => {
  const query = qualifierSearchQuery('"permits" "valid for five years"',
    'Teachers and nurses receive permits valid for five years from the date of issue.');
  assert.match(query, /teachers nurses date of issue/);
  assert.match(query, /validity period/);
  assert.doesNotMatch(query, /["“”]|five years|two years|gov\.uk/);
  assert.deepEqual(missingQualifiers('Businesses subject to VAT can receive invoices.', 'Businesses can receive invoices.'), ['vat']);
  assert.equal(qualifierSearchQuery('plain query', 'A single rule applies.'), 'plain query');
});

test('contiguous official extraction preserves eligibility and later deadlines together', () => {
  const scope = 'Businesses established here and subject to VAT must use electronic invoices.';
  const intervening = 'The platform carries the structured invoice and transmits the data to the authority. '.repeat(12);
  const dates = 'All businesses must receive invoices from 1 September 2026. Small businesses must issue them from 1 September 2027.';
  const body = scope + '\n' + intervening + '\n' + dates;
  assert.ok(body.indexOf(dates) > 900);
  const docs = ['https://www.gov.uk/rule', 'https://example.com/rule'].map(url => ({
    url, title: 'Invoice rules', snippet: dates, retrievalScore: .9, searchRequestId: 'search',
  }));
  const result = inspectSourceExcerpts(docs, docs.map(doc => doc.url), {
    requestId: 'extract', passages: docs.map(doc => ({url: doc.url, content: body})),
  }, 'Businesses subject to VAT must receive electronic invoices from 1 September 2026.');
  assert.equal(result.docs[0].snippet, body, 'Retain verbatim context rather than concatenate invented summaries');
  assert.ok(result.docs[0].snippet.length <= 2400);
  assert.ok(result.docs[1].snippet.length <= 900, 'Secondary sources retain their existing cost bound');
  assert.equal(result.docs[0].extractionRequestId, 'extract');
});

test('the full pipeline retains an improved same-URL scope passage and exports actual model input', async () => {
  const before = { nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY };
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const claim = 'In the UK, teachers and nurses receive permits valid for five years from the date of issue.';
  const url = 'https://www.gov.uk/synthetic-permit-test';
  const broad = 'Teachers receive permits valid for two years.';
  const exact = 'Teachers and nurses receive permits valid for two years from the date of issue.';
  const page = exact + '\n' + 'Additional permit application guidance. '.repeat(38);
  let scopedQuery = '', submitted = '', calls = 0;
  const transport: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(input).endsWith('/search')) {
      calls++;
      if (body.include_domains) scopedQuery = body.query;
      return Response.json({ request_id: body.include_domains ? 'scoped' : 'open', results: [
        {url, title: 'Synthetic permit guidance', score: .9, content: body.include_domains ? exact : broad},
      ] });
    }
    if (String(input).endsWith('/extract')) {
      calls++;
      return Response.json({request_id: 'read', results: [{url, raw_content: page}]});
    }
    const name = body.tool_choice.function.name;
    if (name === 'record_verdict') submitted = body.messages.at(-1).content;
    const args = name === 'record_assertions'
      ? {assertions: [{text: claim, search_query: 'UK teachers permits "five years"'}]}
      : name === 'record_screening'
        ? {judgements: [0, 1].map(index => ({index, relevant: true, leaning: 'refutes'}))}
        : {verdict: 'refuted', confidence: .8, cited_urls: [url], rationale: 'The synthetic source specifies two years.'};
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {
      tool_calls: [{function: {name, arguments: JSON.stringify(args)}}],
    }}]});
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(claim, {inspectSources: true, fetch: transport})) events.push(event);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.type === 'done');
    assert.equal(calls, 3);
    assert.match(scopedQuery, /nurses date of issue/);
    const docs = done.result.provenance!.adjudicationEvidence.a1;
    assert.deepEqual(docs.map(doc => doc.searchRequestId), ['open', 'scoped']);
    assert.ok(docs.every(doc => doc.snippet === page && submitted.includes(doc.snippet)));
    assert.ok(docs.every(doc => doc.extractionRequestId === 'read'));
    assert.equal(events.filter(event => event.type === 'error').length, 0);
  } finally {
    if (before.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = before.nebius;
    if (before.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = before.tavily;
  }
});
