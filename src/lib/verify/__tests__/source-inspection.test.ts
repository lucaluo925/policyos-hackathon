import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceInspectionUrls, inspectSourceExcerpts, selectSourceExcerpt,
  readIssuerHtml } from '../source-inspection';
import { TavilyClient, TavilyBudgetExceeded } from '../tavily';
import { runVerification } from '../pipeline';
import { liveReport, reportMarkdown } from '../report';
import { POST } from '../../../app/api/verify/route';
import type { EvidenceDoc, VerifyEvent } from '../types';

const A = 'https://www.gov.uk/policy';
const B = 'https://digital-strategy.ec.europa.eu/policy';
const doc = (url: string, snippet = 'Search excerpt'): EvidenceDoc => ({ url, title: url, retrievalScore: .9, snippet });

test('source inspection prioritizes real issuing domains, deduplicates and bounds retrieved URLs', () => {
  assert.deepEqual(sourceInspectionUrls([doc('https://evileuropa.eu/x'), doc(A), doc(A),
    doc('javascript:alert(1)'), doc(B), doc('https://example.com/other')]), [A, B, 'https://evileuropa.eu/x']);
});

test('partial extraction preserves evidence and rejects unseen or empty excerpts', () => {
  const docs = [doc(A), doc(B), doc('https://example.com')];
  const result = inspectSourceExcerpts(docs, [A, B], { requestId: 'extract-1', passages: [
    { url: A, content: 'Relevant original paragraph. ' + 'x'.repeat(1500) },
    { url: B, content: '  ' }, { url: 'https://unseen.gov/invented', content: 'Invented URL' },
  ] });
  assert.equal(result.docs[0].snippet.length, 900);
  assert.equal(result.docs[0].extractionRequestId, 'extract-1');
  assert.deepEqual(result.docs.slice(1), docs.slice(1));
  assert.deepEqual(result.extractedUrls, [A]);
  assert.deepEqual(result.failedUrls, [B]);
  assert.equal(docs[0].snippet, 'Search excerpt', 'Do not mutate evidence from the initial retrieval');
});

test('official query chunks retain distant rule and date metadata within one bounded adjudication excerpt', () => {
  const gazette = 'https://www.boe.es/buscar/act.php?id=BOE-A-2024-24099';
  const rule = 'Disposición final cuarta. Entrada en vigor. El presente Real Decreto y el Reglamento ' +
    'entrarán en vigor a los 6 meses de su publicación en el Boletín Oficial del Estado.';
  const metadata = 'Texto original, publicado el 20/11/2024, en vigor a partir del 20/05/2025.';
  const extracted = rule + ' Contexto de otras disposiciones. '.repeat(17) +
    ' [...] ' + 'Otras reglas sobre permisos. '.repeat(18) + ' [...] ' + metadata;
  assert.ok(extracted.indexOf(metadata) > 900);
  const inspected = inspectSourceExcerpts([doc(gazette, rule)], [gazette], {
    requestId: 'boe-query-extract', passages: [{url: gazette, content: extracted}],
  }, "Spain's Royal Decree 1155/2024 was published on 20 November 2024 and took effect on 20 May 2025. Real Decreto 1155/2024 publicación entrada en vigor");
  assert.match(inspected.docs[0].snippet, /entrarán en vigor a los 6 meses/);
  assert.match(inspected.docs[0].snippet, /Texto original, publicado el 20\/11\/2024, en vigor a partir del 20\/05\/2025/);
  assert.ok(inspected.docs[0].snippet.length <= 2400);
  assert.equal(inspected.docs[0].extractionRequestId, 'boe-query-extract');
});

test('Tavily Extract requests five relevant chunks without adding a provider call', async () => {
  let body: Record<string, unknown> | undefined;
  const client = new TavilyClient(1, 'offline-key');
  const transport: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({request_id: 'extract-chunks', results: [{url: A, raw_content: 'Source text'}]});
  };
  const result = await client.extract([A], 'policy commencement', {fetch: transport});
  assert.equal(body?.query, 'policy commencement');
  assert.equal(body?.chunks_per_source, 5);
  assert.equal(client.callsUsed, 1);
  assert.equal(result.passages[0].content, 'Source text');
});

test('full-page selection finds the policy passage without matching a false quantity', () => {
  const page = 'Generic navigation '.repeat(70) +
    'Digital nomad visa | Period of stay | 6 months; no extension granted. ' +
    'Visa applicants must work remotely in Japan.';
  const excerpt = selectSourceExcerpt(page,
    'The Japanese digital nomad visa allows an initial stay of twelve months.');
  assert.match(excerpt, /Digital nomad visa \| Period of stay \| 6 months/);
  assert.ok(!excerpt.startsWith('Generic navigation '));
});

test('date-bound eligibility keeps the study-permit condition and its outcome together', () => {
  const page = 'Navigation and unrelated guidance. '.repeat(45) +
    'Language requirement: If you submitted your PGWP application before November 1, 2024, you do not need language results. ' +
    'Other instructions. '.repeat(60) +
    'If you graduated from any other college, polytechnic or non-university program: ' +
    'Field of study requirement: If you submitted your study permit application on or after November 1, 2024, you must graduate in an eligible field of study. ' +
    'If you submitted your study permit application before November 1, 2024, you do not need to meet the field of study requirement. ' +
    'Further program information. '.repeat(45);
  const claim = 'A Canadian college graduate who submitted their study permit application before 1 November 2024 does not need to meet the PGWP field-of-study requirement in 2026.';
  const excerpt = selectSourceExcerpt(page, claim, 'If you submitted your study permit application on or after November 1, 2024, you must graduate in an eligible field of study.');
  assert.match(excerpt, /college, polytechnic or non-university program/);
  assert.match(excerpt, /study permit application before November 1, 2024, you do not need/);
  assert.doesNotMatch(excerpt, /PGWP application before November 1, 2024, you do not need language/);
});

test('bounded issuer HTML read recovers a condition that cleaned provider text omitted', async () => {
  const url = 'https://www.canada.ca/en/immigration/eligibility.html';
  const claim = 'A Canadian college student who submitted a study permit application before 1 November 2024 does not need the field-of-study requirement.';
  const html = `<html><main>${'<p>Other eligibility information.</p>'.repeat(45)}` +
    '<h3>For college graduates</h3><p>If you submitted your study permit application on or after November 1, 2024, you must meet the field-of-study requirement.</p>' +
    '<p>If you submitted your study permit application before November 1, 2024, you do not need the field-of-study requirement.</p>' +
    '</main></html>';
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  };
  const read = await readIssuerHtml(url, claim, ['canada.ca'], { fetch: transport });
  assert.equal(calls, 1);
  assert.match(read?.excerpt ?? '', /study permit application before November 1, 2024, you do not need/);
  assert.ok((read?.bytes ?? 0) > 0);
  assert.equal(await readIssuerHtml('https://www.canada.ca:8443/eligibility', claim,
    ['canada.ca'], { fetch: transport }), null);
  assert.equal(await readIssuerHtml('https://www.canada.ca.attacker.test/eligibility', claim,
    ['canada.ca'], { fetch: transport }), null);
  assert.equal(await readIssuerHtml('https://www.canada.ca/guide.pdf', claim,
    ['canada.ca'], { fetch: transport }), null);
  assert.equal(calls, 1, 'Rejected URLs never reach the transport');
  assert.equal(await readIssuerHtml(url, claim, ['canada.ca'], { fetch: async () =>
    new Response(null, { status: 302, headers: { location: 'https://attacker.test' } }) }), null);
  assert.equal(await readIssuerHtml(url, claim, ['canada.ca'], { fetch: async () =>
    new Response(html, { headers: { 'content-type': 'text/plain' } }) }), null);
});

test('the verifier records direct issuer text separately from Tavily Extract', async () => {
  const previous = { nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY };
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const url = 'https://www.canada.ca/en/immigration/eligibility.html';
  const claim = 'In Canada, college graduates who submitted their study permit application before 1 November 2024 do not need the PGWP field-of-study requirement.';
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    if (endpoint.endsWith('/search')) return Response.json({ request_id: 'search-discovery', results: [{
      url, title: 'PGWP eligibility', score: .9,
      content: 'If you submitted your study permit application on or after November 1, 2024, you must meet a field-of-study requirement.',
    }] });
    if (endpoint.endsWith('/extract')) return Response.json({ request_id: 'extract-omission', results: [{
      url, raw_content: 'If you submitted your study permit application on or after November 1, 2024, you must meet a field-of-study requirement.',
    }] });
    if (endpoint === url) return new Response('<html><main><h3>College programs</h3>' +
      '<p>If you submitted your study permit application on or after November 1, 2024, you must meet a field-of-study requirement.</p>' +
      '<p>If you submitted your study permit application before November 1, 2024, you do not need to meet it.</p>' +
      '</main></html>', { headers: { 'content-type': 'text/html' } });
    const request = JSON.parse(String(init?.body));
    const name = request.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? { assertions: [{ text: claim, search_query: 'Canada college PGWP study permit before November 2024 field of study' }] }
      : name === 'record_screening'
        ? { judgements: [{ index: 0, relevant: true, leaning: 'supports' }] }
        : { verdict: 'supported', confidence: .8, cited_urls: [url], rationale: 'The before-date exception is present.' };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }],
    } }] });
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(claim,
      { inspectSources: true, tavilyBudget: 3, fetch: transport })) events.push(event);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.type === 'done');
    assert.equal(done.result.overall, 'supported');
    assert.equal(done.result.stats.tavilyCalls, 2);
    const passage = done.result.provenance?.adjudicationEvidence.a1[0];
    assert.match(passage?.snippet ?? '', /study permit application before November 1, 2024/);
    assert.equal(passage?.issuerHtmlRead, true);
    assert.equal(passage?.searchRequestId, 'search-discovery');
    assert.equal(passage?.extractionRequestId, undefined);
    assert.equal(done.result.provenance?.issuerHtmlReads?.a1[0].status, 'used');
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('a specific eligibility exception outranks repeated generic page headings', () => {
  const page = ('Canada PGWP eligible post-graduation work permit study requirement.\n').repeat(24) +
    'Field of study requirement: There are no field of study requirements for graduates ' +
    'with a bachelor’s degree, master’s degree or doctoral degree.\n' +
    ('General information about PGWP eligibility.\n').repeat(24);
  const excerpt = selectSourceExcerpt(page,
    'In Canada all bachelor’s degree graduates must meet a field of study requirement for a PGWP.');
  assert.match(excerpt, /no field of study requirements for graduates with a bachelor’s degree/);
});

test('an operative date replacement outranks a recital quoting the obsolete date', () => {
  const search = 'Battery due diligence obligations are to be applied from 18 August 2025.';
  const page = 'Battery due diligence policy. ' + search +
    ' Background on the original 2023 regulation and its obligations. '.repeat(100) +
    'HAVE ADOPTED THIS REGULATION: Article 1 Amendments to Regulation (EU) 2023/1542. ' +
    'Article 48 is amended as follows: in paragraph 1, the date ‘18 August 2025’ ' +
    'is replaced by ‘18 August 2027’.';
  const result = inspectSourceExcerpts([doc(B, search)], [B], {
    requestId: 'page-read', passages: [{ url: B, content: page }],
  }, 'The EU battery due diligence obligations took effect on 18 August 2025.');
  assert.match(result.docs[0].snippet, /Battery due diligence obligations/);
  assert.match(result.docs[0].snippet, /Article 48 is amended as follows/);
  assert.match(result.docs[0].snippet, /18 August 2025’ is replaced by ‘18 August 2027/);
  assert.equal(result.docs[0].extractionRequestId, 'page-read');
  assert.deepEqual(result.preservedSearchUrls, []);
});

test('a prepaid-delivery claim selects the matching payment timeline despite an opposite Search lead', () => {
  const url = 'https://www.iras.gov.sg/transition';
  const early = 'Scenario A: Full payment for goods made in 2023. Goods are delivered in 2024. ' +
    'The advance payment amount keeps the earlier tax rate under this transition rule.';
  const late = 'Scenario B: Full payment for goods made in 2024. Goods are delivered in 2025. ' +
    'The later payment amount uses the newer tax rate under this transition rule.';
  const page = 'General rate-change navigation. '.repeat(40) + early +
    'Other invoice guidance. '.repeat(45) + late;
  const first = inspectSourceExcerpts([doc(url, late)], [url], {
    requestId: 'page-read', passages: [{url, content: page}],
  }, 'Goods fully paid in December 2023 but delivered in January 2024 use the newer tax rate.');
  assert.match(first.docs[0].snippet, /Full payment for goods made in 2023/);
  assert.match(first.docs[0].snippet, /advance payment amount keeps the earlier tax rate/);
  // Wider source context may also contain the separately labelled scenario;
  // it must preserve the matching rule verbatim rather than infer its outcome.
  assert.equal(first.docs[0].extractionRequestId, 'page-read');

  const reverse = inspectSourceExcerpts([doc(url, early)], [url], {
    requestId: 'reverse-read', passages: [{url, content: page}],
  }, 'Goods fully paid in January 2024 but delivered in January 2025 use the earlier tax rate.');
  assert.match(reverse.docs[0].snippet, /Full payment for goods made in 2024/);
  assert.match(reverse.docs[0].snippet, /later payment amount uses the newer tax rate/);
});

test('paid for in full locates the earlier-payment exception on an issuing page', () => {
  const page = 'Generic GST rate change for 2024. '.repeat(60) +
    'Scenario 1. Full payment for goods or services made in 2023. ' +
    'Goods or services received on or after 1 Jan 2024. ' +
    'GST will be chargeable at 8% even when delivery is in 2024. ' +
    'Other tax guidance. '.repeat(65) +
    'Scenario 3. Full payment for goods made in 2024. ' +
    'Goods delivered in 2024. GST will be chargeable at 9%.';
  const excerpt = selectSourceExcerpt(page,
    'Goods paid for in full in December 2023 but delivered in January 2024 are taxed at 9% GST.');
  assert.match(excerpt, /Full payment for goods or services made in 2023/);
  assert.match(excerpt, /GST will be chargeable at 8% even when delivery is in 2024/);
  assert.doesNotMatch(excerpt, /Scenario 3/);
});

test('a verbatim Search sentence locates the dated issuer paragraph in a long page', () => {
  const decisive='For employees of small businesses, the right to disconnect does not commence until 26 August 2025.';
  const page='Right to disconnect for small businesses and employers. '.repeat(35) +
    'The right began for non-small employers on 26 August 2024. ' + decisive +
    ' General workplace guidance. '.repeat(35);
  const result=inspectSourceExcerpts([doc(A,decisive)],[A],{
    requestId:'official-extract',passages:[{url:A,content:page}],
  },'The right to disconnect applied to employees of small businesses in 2024.');
  assert.match(result.docs[0].snippet,/does not commence until 26 August 2025/);
  assert.equal(result.docs[0].extractionRequestId,'official-extract');
});

test('separate Search draws of one official URL retain their own dated page passages and request IDs', () => {
  const current = 'Starting in 2026, Canadian graduate students at public institutions do not need a provincial attestation letter.';
  const historical = 'For 2025, Canadian graduate students were included in the national cap and required a provincial attestation letter.';
  const page = current + ' General study permit guidance. '.repeat(45) + historical;
  const docs: EvidenceDoc[] = [
    { ...doc(A, current), searchRequestId: 'open-search' },
    { ...doc(A, historical), searchRequestId: 'scoped-search' },
  ];
  const result = inspectSourceExcerpts(docs, [A], {
    requestId: 'page-read', passages: [{ url: A, content: page }],
  }, 'In 2025, Canadian graduate students were exempt from the national study-permit cap and attestation letter.');
  assert.equal(result.docs.length, 2);
  assert.match(result.docs[0].snippet, /Starting in 2026/);
  assert.match(result.docs[1].snippet, /For 2025/);
  // Overlap is permitted: dates remain attached to their actual source text,
  // and each original Search draw retains its own provenance.
  assert.deepEqual(result.docs.map(value => value.searchRequestId), ['open-search', 'scoped-search']);
  assert.deepEqual(result.docs.map(value => value.extractionRequestId), ['page-read', 'page-read']);
  assert.deepEqual(result.extractedUrls, [A]);
  assert.deepEqual(result.preservedSearchUrls, []);
});

test('a page read cannot erase a more specific Search excerpt', () => {
  const search = 'No field of study requirement for bachelor’s degree graduates.';
  const result = inspectSourceExcerpts([doc(A, search)], [A], {
    requestId: 'extract-2', passages: [{ url: A,
      content: 'Canada PGWP field of study requirement. '.repeat(40) }],
  }, 'In Canada, all bachelor’s degree graduates must meet a field of study requirement.');
  assert.equal(result.docs[0].snippet, search);
  assert.equal(result.docs[0].extractionRequestId, undefined);
  assert.deepEqual(result.extractedUrls, [A]);
  assert.deepEqual(result.preservedSearchUrls, [A]);
  assert.deepEqual(result.failedUrls, []);
});

test('wider official context preserves both named ETA rules from the source page', () => {
  const search = 'ETA 1.3. A lawful Irish resident travelling within the Common Travel Area does not need an ETA. ' +
    'ETA 1.6. A person aged 16 or over may be required to show proof of that residence.';
  const page = 'UK Electronic Travel Authorisation guidance. '.repeat(12) +
    'ETA 1.3. A lawful Irish resident travelling within the Common Travel Area does not need an ETA. ' +
    'Other application requirements and definitions. '.repeat(35) +
    'ETA 1.6. A person aged 16 or over may be required to show proof of that residence.';
  const result = inspectSourceExcerpts([doc(A, search)], [A], {
    requestId: 'eta-extract', passages: [{ url: A, content: page }],
  }, 'Under UK ETA 1.3 and 1.6, a lawful Irish resident travelling within the Common Travel Area is exempt and a person aged 16 or over may need to show proof.');
  assert.match(result.docs[0].snippet, /ETA 1\.3\. A lawful Irish resident/);
  assert.match(result.docs[0].snippet, /ETA 1\.6\. A person aged 16 or over/);
  assert.ok(page.includes(result.docs[0].snippet));
  assert.equal(result.docs[0].extractionRequestId, 'eta-extract');
  assert.deepEqual(result.preservedSearchUrls, []);
});

test('a multilingual page read retains the decisive source-language passage in wider context', () => {
  const search = 'Bestemmelsen om merverdiavgift for elbiler: fritaket gjelder de første 300 000 kronene ved kjøp av elektriske personkjøretøy med batteripakke.';
  const unrelated = 'Publikasjoner for ansatte og bedrifter. Andre avgiftsregler for institusjoner. '.repeat(15);
  const result = inspectSourceExcerpts([doc(A, search)], [A], {
    requestId: 'extract-norwegian', passages: [{ url: A, content: unrelated + search + unrelated }],
  }, 'Norway abolished every electric-car VAT exemption in 2026.');
  assert.ok(result.docs[0].snippet.includes(search));
  assert.ok((unrelated + search + unrelated).includes(result.docs[0].snippet));
  assert.equal(result.docs[0].extractionRequestId, 'extract-norwegian');
  assert.deepEqual(result.preservedSearchUrls, []);
});

test('Search and Extract reserve the same budget before concurrent network calls', async () => {
  const fetcher = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ results: [], request_id: 'test' }); };
  try {
    const client = new TavilyClient(1, 'offline-key');
    const results = await Promise.allSettled([client.search('claim'), client.extract([A], 'claim')]);
    assert.equal(calls, 1);
    assert.equal(client.callsUsed, 1);
    assert.equal(results[0].status, 'fulfilled');
    assert.ok(results[1].status === 'rejected' && results[1].reason instanceof TavilyBudgetExceeded);
  } finally { globalThis.fetch = fetcher; }
});

test('aborted extraction spends no call and empty batches never reach the API', async () => {
  const client = new TavilyClient(1, 'offline-key');
  await assert.rejects(client.extract([A], 'claim', { signal: AbortSignal.abort() }));
  await assert.rejects(client.extract([], 'claim'));
  assert.equal(client.callsUsed, 0);
});

async function verify(mode: 'default' | 'success' | 'partial' | 'failed' | 'budget') {
  const originalFetch = globalThis.fetch;
  const nebius = process.env.NEBIUS_API_KEY, tavily = process.env.TAVILY_API_KEY;
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const calls: string[] = [], events: VerifyEvent[] = [];
  let submitted = '';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('tavily')) {
      const endpoint = String(url).split('/').at(-1)!;
      calls.push(endpoint);
      if (endpoint === 'search') return Response.json({ request_id: 'search-1', results: [
        { url: A, title: 'Notice', score: .9, content: 'Original Search excerpt.' },
        { url: B, title: 'Notice B', score: .8, content: 'Search fallback B.' },
      ] });
      assert.equal(body.query, undefined);
      assert.deepEqual(body.urls, [A, B]);
      assert.equal(body.chunks_per_source, undefined);
      assert.equal(body.extract_depth, 'basic');
      if (mode === 'failed') return new Response('PRIVATE_UPSTREAM_BODY', { status: 503 });
      return Response.json({ request_id: 'extract-1', usage: { credits: 0 }, results: [
        { url: A, raw_content: 'Decisive extracted source passage.' + 'x'.repeat(1600) },
        ...(mode === 'partial' ? [] : [{ url: B, raw_content: 'Decisive passage B.' }]),
      ], failed_results: mode === 'partial' ? [{ url: B, error: 'Unavailable' }] : [] });
    }
    const name = body.tool_choice.function.name;
    if (name === 'record_verdict') submitted = body.messages.at(-1).content;
    const args = name === 'record_assertions' ? { assertions: [{ text: 'Fixed claim.', search_query: 'fixed query' }] }
      : name === 'record_screening' ? { judgements: [0, 1].map(index => ({ index, relevant: true, leaning: 'supports' })) }
      : { verdict: 'supported', confidence: .8, cited_urls: [A], rationale: 'Matches evidence.' };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] });
  };
  try {
    for await (const event of runVerification('Fixed claim.', {
      inspectSources: mode !== 'default', tavilyBudget: mode === 'budget' ? 1 : 6,
    })) events.push(event);
    const finished = events.find(e => e.type === 'done');
    assert.ok(finished?.type === 'done');
    return { result: finished.result, events, calls, submitted };
  } finally {
    globalThis.fetch = originalFetch;
    if (nebius === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = nebius;
    if (tavily === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = tavily;
  }
}

test('default pipeline does not extract or invent an extraction trail', async () => {
  const { result, calls, submitted } = await verify('default');
  assert.deepEqual(calls, ['search']);
  assert.equal(result.provenance?.sourceInspection, undefined);
  assert.match(submitted, /Original Search excerpt/);
});

test('optional source passages reach actual adjudication and downloadable evidence with their request ID', async () => {
  const { result, calls, submitted, events } = await verify('success');
  assert.deepEqual(calls, ['search', 'extract']);
  assert.equal(result.stats.tavilyCalls, 2);
  assert.deepEqual(result.tavilyRequestIds, ['search-1', 'extract-1']);
  const exact = result.provenance!.adjudicationEvidence.a1[0];
  assert.ok(exact.snippet.length > 900 && exact.snippet.length <= 2400);
  assert.equal(exact.extractionRequestId, 'extract-1');
  assert.ok(submitted.includes(exact.snippet));
  assert.ok(!submitted.includes('Original Search excerpt.'));
  assert.equal(result.provenance!.sourceInspection!.a1.status, 'done');
  const stages = events.filter(e => e.type === 'stage' && e.stage === 'extract');
  assert.equal(stages.length, 2);
  const report = liveReport(result, { a1: result.provenance!.adjudicationEvidence.a1 });
  assert.match(reportMarkdown(report), /Tavily Extract/);
  assert.equal(JSON.parse(JSON.stringify(report)).sourceInspection.a1.requestId, 'extract-1');
});

for (const mode of ['partial', 'failed', 'budget'] as const) {
  test(`${mode} source inspection retains usable Search evidence and closes progress`, async () => {
    const { result, calls, submitted, events } = await verify(mode);
    assert.equal(result.overall, 'supported');
    assert.match(submitted, /Search fallback B/);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_UPSTREAM_BODY'));
    assert.equal(result.provenance!.sourceInspection!.a1.status,
      mode === 'budget' ? 'skipped_budget' : mode === 'failed' ? 'failed' : 'partial');
    assert.equal(calls.length, mode === 'budget' ? 1 : 2);
    assert.ok(events.some(e => e.type === 'stage' && e.stage === 'extract' && e.status === 'done'));
  });
}

test('request validation cannot enable inspection using a truthy string', async () => {
  const response = await POST(new Request('http://localhost/api/verify', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: 'Claim.', inspectSources: 'false' }) }));
  assert.equal(response.status, 400);
});
