import assert from 'node:assert/strict';
import test from 'node:test';
import { boeDocumentId, readBoeMetadata } from '../boe-metadata';
import { runVerification } from '../pipeline';
import type { VerifyEvent } from '../types';

const original = 'https://www.boe.es/buscar/doc.php?id=BOE-A-2025-7439';
const api = 'https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2025-7439/metadatos';
const metadata = {status: {code: '200'}, data: [{identificador: 'BOE-A-2025-7439',
  titulo: 'Real Decreto 214/2025 de huella de carbono', fecha_publicacion: '20250412',
  fecha_vigencia: '20250612'}]};

test('BOE metadata accepts only a retrieved issuer document ID and records publication alone', async () => {
  assert.equal(boeDocumentId(original), 'BOE-A-2025-7439');
  for (const url of [
    'https://boe.es.evil.example/buscar/doc.php?id=BOE-A-2025-7439',
    'http://www.boe.es/buscar/doc.php?id=BOE-A-2025-7439',
    'https://www.boe.es/redirect?id=BOE-A-2025-7439',
    'https://www.boe.es/buscar/doc.php?id=BOE-A-2025-7439%2F..',
  ]) assert.equal(boeDocumentId(url), null);
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => {
    calls.push(String(input));
    return Response.json(metadata);
  };
  const doc = await readBoeMetadata(original, {fetch: fetcher});
  assert.deepEqual(calls, [api]);
  assert.equal(doc?.url, api);
  assert.match(doc?.snippet ?? '', /Publication date \(fecha_publicacion\): 2025-04-12/);
  assert.doesNotMatch(doc?.snippet ?? '', /2025-06-12/);
});

test('BOE metadata fails closed on mismatched ID, invalid date, and unavailable record', async () => {
  const mock = (body: unknown, status = 200): typeof fetch => async () =>
    Response.json(body, {status});
  assert.equal(await readBoeMetadata(original, {fetch: mock({...metadata,
    data: [{...metadata.data[0], identificador: 'BOE-A-2025-1'}]})}), null);
  assert.equal(await readBoeMetadata(original, {fetch: mock({...metadata,
    data: [{...metadata.data[0], fecha_publicacion: '20250230'}]})}), null);
  assert.equal(await readBoeMetadata(original, {fetch: mock({}, 404)}), null);
});

test('enhanced verification can cite BOE metadata alongside the law text', async () => {
  const before = {nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY};
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    if (endpoint === api) return Response.json(metadata);
    const body = JSON.parse(String(init?.body));
    if (endpoint.endsWith('/search')) return Response.json({request_id: body.include_domains ? 'scoped' : 'open',
      results: body.include_domains
        ? [{url: original, title: 'Real Decreto 214/2025', score: .95,
          content: 'Disposición final. Entrará en vigor a los dos meses de su publicación.'}]
        : [{url: 'https://example.org/analysis', title: 'Analysis', score: .9,
          content: 'Royal Decree 214/2025 was published in April 2025.'}]});
    if (endpoint.endsWith('/extract')) return Response.json({request_id: 'extracted',
      results: [{url: original, raw_content: 'Disposición final. Entrará en vigor a los dos meses de su publicación.'}]});
    const name = body.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? {assertions: [{text: 'Royal Decree 214/2025 was published on 12 April 2025.',
        search_query: 'publication date Royal Decree 214/2025'}]}
      : name === 'record_screening'
        ? {judgements: [0, 1, 2].map(index => ({index, relevant: true, leaning: 'supports'}))}
        : {verdict: 'supported', confidence: .9, cited_urls: [api],
          rationale: 'The BOE issuer metadata gives the publication date.'};
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {
      tool_calls: [{function: {name, arguments: JSON.stringify(args)}}],
    }}]});
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification('Spain Royal Decree 214/2025 was published on 12 April 2025.',
      {inspectSources: true, tavilyBudget: 3, fetch: transport})) events.push(event);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.type === 'done');
    assert.equal(done.result.overall, 'supported');
    assert.deepEqual(done.result.assertions[0].citedUrls, [api]);
    assert.match(done.result.provenance?.adjudicationEvidence.a1.find(doc => doc.url === api)?.snippet ?? '',
      /2025-04-12/);
    assert.equal(done.result.stats.tavilyCalls, 3);
  } finally {
    if (before.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = before.nebius;
    if (before.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = before.tavily;
  }
});
