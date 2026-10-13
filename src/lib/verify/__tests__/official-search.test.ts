import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsOfficialSearch, officialSearchDomains, officialSearchQuery,
  isInSearchScope, scopedHitAddsSection, scopedHitAddsYear, scopedHitAddsBoundary,
  scopedHitAddsDisposition, scopedHitAddsRoute, scopedHitAddsGroup,
  lacksExceptionDisposition } from '../official-search';
import { runVerification } from '../pipeline';
import type { VerifyEvent } from '../types';

test('official search scopes only one explicit jurisdiction and checks the URL host', () => {
  assert.deepEqual(officialSearchDomains('Singapore GST changed in 2024'), ['gov.sg']);
  assert.deepEqual(officialSearchDomains('Canadian graduate study-permit rules in 2025'), ['canada.ca', 'gc.ca']);
  assert.deepEqual(officialSearchDomains('Australian visa settings changed'), ['gov.au']);
  assert.deepEqual(officialSearchDomains('Spain Royal Decree 1155/2024 took effect in 2025'), ['boe.es']);
  assert.deepEqual(officialSearchDomains('Spanish housing policy changed'), ['gob.es']);
  assert.deepEqual(officialSearchDomains('Spain and Singapore signed a treaty'), []);
  assert.deepEqual(officialSearchDomains('Canadian and Australian study permits'), []);
  assert.deepEqual(officialSearchDomains('EU battery passport'), ['europa.eu']);
  assert.deepEqual(officialSearchDomains('U.S. export controls changed'), ['gov']);
  assert.deepEqual(officialSearchDomains('日本数字游民签证最长停留十二个月'), ['go.jp']);
  assert.deepEqual(officialSearchDomains('欧盟电池护照适用于所有电池'), ['europa.eu']);
  assert.deepEqual(officialSearchDomains('日本与新加坡签订协定'), []);
  assert.deepEqual(officialSearchDomains('Japan and Singapore signed a treaty'), []);
  assert.deepEqual(officialSearchDomains('A digital nomad visa lasts a year'), []);
  assert.deepEqual(officialSearchDomains('Norway EV VAT exemption in 2026'), ['skatteetaten.no']);
  assert.deepEqual(officialSearchDomains('Norway climate target in 2026'), ['regjeringen.no']);
  assert.deepEqual(officialSearchDomains('挪威电动车增值税起征点'), ['skatteetaten.no']);
  assert.deepEqual(officialSearchDomains('Hong Kong plastic shopping bag minimum charge'), ['epd.gov.hk']);
  assert.deepEqual(officialSearchDomains('香港塑胶袋收费豁免'), ['epd.gov.hk']);
  assert.deepEqual(officialSearchDomains('Hong Kong climate action plan'), ['gov.hk']);
  assert.deepEqual(officialSearchDomains('Malaysia e-Invoicing annual turnover'), ['hasil.gov.my']);
  assert.deepEqual(officialSearchDomains('Malaysia climate policy'), ['gov.my']);
  assert.deepEqual(officialSearchDomains('Slovenia changed its migration policy'), ['gov.si']);
  assert.deepEqual(officialSearchDomains('斯洛文尼亚移民政策变化'), ['gov.si']);
  assert.deepEqual(officialSearchDomains('Ireland opened an immigration scheme in 2026'), ['gov.ie', 'irishimmigration.ie']);
  assert.deepEqual(officialSearchDomains('Ireland and the UK changed border rules'), []);
  assert.deepEqual(officialSearchDomains('Australia right to disconnect for small businesses in 2024'), ['fairwork.gov.au']);
  assert.equal(needsOfficialSearch('Hong Kong plastic shopping bag minimum charge',
    [{ url: 'https://www.eeb.gov.hk/consultation.pdf', snippet: 'Plastic bag consultation.' }],
    ['epd.gov.hk']), true);
  assert.equal(needsOfficialSearch('Hong Kong plastic shopping bag minimum charge',
    [{ url: 'https://www.epd.gov.hk/epd/english/environmentinhk/waste/pro_responsibility/psb_index.html',
      snippet: 'Plastic shopping bag charge.' }], ['epd.gov.hk']), false);
  assert.equal(isInSearchScope('https://www.iras.gov.sg/page', ['gov.sg']), true);
  assert.equal(isInSearchScope('https://www.skatteetaten.no/rettskilder', ['skatteetaten.no']), true);
  assert.equal(isInSearchScope('https://gov.sg.evil.example/page', ['gov.sg']), false);
  assert.equal(isInSearchScope('http://www.iras.gov.sg/page', ['gov.sg']), false);
});

test('Spanish decree scoped search targets the issuing gazette without repeating the asserted date', () => {
  const claim = "Spain's Royal Decree 1155/2024 took effect on 20 May 2025.";
  const query = officialSearchQuery(claim, 'Royal Decree 1155/2024 took effect 20 May 2025');
  assert.equal(query, 'Real Decreto 1155/2024 disposición final entrada en vigor fecha publicación');
  assert.ok(!query.includes('20 May 2025'));
  assert.equal(officialSearchQuery(claim, 'Royal Decree 1155/2024 published on 20 November 2024'),
    'Real Decreto 1155/2024 BOE fecha de publicación texto original');
  assert.equal(needsOfficialSearch(claim, [
    {url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2024-24099',
      snippet: 'Publicado 20 noviembre 2024. Entrada en vigor 20 mayo 2025.'},
  ], ['boe.es'], "Spain's Royal Decree 1155/2024 took effect on 20 May 2025."), false);
});

test('French invoice search uses the tax authority and neutral issuer vocabulary', () => {
  const claim = 'French businesses subject to VAT must receive electronic invoices in 2026.';
  assert.deepEqual(officialSearchDomains(claim), ['impots.gouv.fr']);
  assert.deepEqual(officialSearchDomains('France housing policy changed'), ['gouv.fr']);
  assert.deepEqual(officialSearchDomains('France and Canada electronic invoicing'), []);
  const query = officialSearchQuery(claim, 'French invoices receive 2026');
  assert.match(query, /facturation électronique/);
  assert.match(query, /assujetties TVA/);
  assert.doesNotMatch(query, /2026|2027|September|septembre/);
});

test('Spanish decree inspection sends a neutral reranking query and preserves distant BOE dates', async () => {
  const previous = {nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY};
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const boe = 'https://www.boe.es/buscar/act.php?id=BOE-A-2024-24099';
  const secondary = 'https://example.com/commentary';
  const clause = 'Disposición final cuarta. Entrada en vigor. El presente Real Decreto y el Reglamento entrarán en vigor a los 6 meses de su publicación.';
  const metadata = 'Texto original, publicado el 20/11/2024, en vigor a partir del 20/05/2025.';
  let extractBody: Record<string, unknown> | null = null;
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    const body = JSON.parse(String(init?.body));
    if (endpoint.endsWith('/search')) return Response.json({request_id: body.include_domains ? 'boe-search' : 'open-search',
      results: body.include_domains
        ? [{url: boe, title: 'Real Decreto 1155/2024', score: .95, content: clause}]
        : [{url: secondary, title: 'Commentary', score: .9, content: 'The Spanish immigration regulation changed.'}]});
    if (endpoint.endsWith('/extract')) {
      extractBody = body;
      return Response.json({request_id: 'boe-extract', results: [{url: boe,
        raw_content: clause + ' Contexto del reglamento. '.repeat(16) + ' [...] ' +
          'Normas para extranjeros. '.repeat(17) + ' [...] ' + metadata}]});
    }
    const name = body.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? {assertions: [{text: 'Spanish Royal Decree 1155/2024 took effect on 20 May 2025.',
        search_query: 'Royal Decree 1155/2024 took effect 20 May 2025'}]}
      : name === 'record_screening'
        ? {judgements: [0, 1].map(index => ({index, relevant: true, leaning: 'supports'}))}
        : {verdict: 'supported', confidence: .9, cited_urls: [boe], rationale: 'The source dates and rule agree.'};
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {
      tool_calls: [{function: {name, arguments: JSON.stringify(args)}}],
    }}]});
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(
      "Spain's Royal Decree 1155/2024 on immigration took effect on 20 May 2025.",
      {inspectSources: true, tavilyBudget: 3, fetch: transport})) events.push(event);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.type === 'done');
    const captured = extractBody as Record<string, unknown> | null;
    assert.ok(captured);
    assert.equal(captured.query, 'Real Decreto 1155/2024 disposición final entrada en vigor fecha publicación');
    assert.equal(captured.chunks_per_source, 5);
    const passage = done.result.provenance?.adjudicationEvidence.a1.find(doc => doc.url === boe)?.snippet ?? '';
    assert.match(passage, /entrarán en vigor a los 6 meses/);
    assert.match(passage, /20\/11\/2024, en vigor a partir del 20\/05\/2025/);
    assert.deepEqual(done.result.assertions[0].citedUrls, [boe]);
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('Norwegian EV VAT scoped query uses Tax Administration terms without an answer amount', () => {
  assert.equal(officialSearchQuery('Norway electric-car purchase VAT benefit in 2026',
    'Norway electric car VAT benefit 2026'), 'merverdiavgift elbil fritak 2026');
  assert.equal(officialSearchQuery('Norway VAT on food in 2026', 'Norway food VAT 2026'),
    'Norway food VAT 2026');
  assert.equal(officialSearchQuery('UK electric car VAT in 2026', 'UK EV VAT 2026'),
    'UK EV VAT 2026');
});

test('Hong Kong bag-charge scoped query asks for the implemented scheme, not the asserted amount', () => {
  assert.equal(officialSearchQuery(
    "Hong Kong's enhanced plastic shopping bag scheme raised the minimum charge to HK$2.",
    'Hong Kong plastic bag charge minimum HK$2 non-exempt bags',
  ), 'Enhanced Plastic Shopping Bag Charging Scheme current phase charging level Hong Kong');
  assert.equal(officialSearchQuery(
    "Hong Kong's enhanced plastic shopping bag scheme exempts unpackaged food.",
    'Hong Kong plastic bag free exemption unpackaged food',
  ), 'Hong Kong plastic bag free exemption unpackaged food');
});

test('Australian disconnect scoped search asks the Ombudsman for coverage without assuming the claimed year', () => {
  const claim="Australia's right to disconnect applied to small businesses from 26 August 2024.";
  assert.equal(officialSearchQuery(claim,'Australia disconnect small business 2024'),
    'Fair Work Ombudsman right to disconnect small business commencement');
  assert.equal(officialSearchQuery('Australia right to disconnect started in 2024','Australia disconnect 2024'),
    'Fair Work Ombudsman right to disconnect commencement coverage');
});

test('Malaysian e-Invoice scoped search asks the tax authority for its timeline without an asserted threshold', () => {
  const query = officialSearchQuery('Malaysia e-Invoicing applies below RM3 million from 1 January 2026',
    'Malaysia e-Invoicing RM3 million 1 January 2026');
  assert.equal(query, 'Malaysia HASiL e-Invoice implementation timeline annual revenue exemption');
  assert.ok(!query.includes('RM3'));
});

test('a named legal section missing from a government excerpt triggers a scoped search', () => {
  const claim = "All provisions of South Africa's Climate Change Act, including section 27, commenced in 2025.";
  const url = 'https://www.gov.za/documents/climate-change-act';
  const short = 'Commencement 17 March 2025, excluding Sections 12(6), 13(1), 13(2)';
  const complete = short + ', 27 and 28.';
  const unrelated = 'Carbon budgets Section 27 requires ministerial allocation.';
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: short }], ['gov.za']), true);
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: unrelated }], ['gov.za']), true);
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: complete }], ['gov.za']), false);
  assert.equal(scopedHitAddsSection(claim, short, complete), true);
  assert.equal(scopedHitAddsSection(claim, complete, short), false);
  assert.equal(officialSearchQuery(claim, 'South Africa Climate Change Act commencement'),
    'South Africa Climate Change Act commencement section 27 commencement status');
});

test('an official page from a different year does not satisfy a dated assertion', () => {
  const claim = "In 2025, Canadian master's and doctoral study-permit applicants were exempt from the cap and attestation letter.";
  const url = 'https://www.canada.ca/en/immigration-refugees-citizenship/graduate-student.html';
  const current = 'Starting in 2026, graduate students at public institutions do not need an attestation letter.';
  const historical = 'For 2025, graduate students were allocated places under the cap and required an attestation letter.';
  const assertion = "In 2025, master's and doctoral applicants were exempt from the national study-permit cap.";
  assert.equal(needsOfficialSearch(claim, [{url, snippet: current}], ['canada.ca'], assertion), true);
  assert.equal(needsOfficialSearch(claim, [{url, snippet: historical}], ['canada.ca'], assertion), false);
  assert.equal(scopedHitAddsYear(assertion, current, historical), true);
  assert.equal(scopedHitAddsYear(assertion, historical, current), false);
  assert.equal(scopedHitAddsYear('A graduate cap applies.', current, historical), false);
  assert.equal(needsOfficialSearch('Singapore tax rate in 2024 and 2026', [
    {url: 'https://www.nccs.gov.sg/one', snippet: 'The rate was S$25 in 2024.'},
    {url: 'https://www.nea.gov.sg/two', snippet: 'The rate became S$45 in 2026.'},
  ], ['gov.sg']), true);
  assert.equal(needsOfficialSearch('Singapore tax rate in 2024 and 2026', [
    {url: 'https://www.nccs.gov.sg/one', snippet: 'The rate was S$25 in 2024 and S$45 in 2026.'},
  ], ['gov.sg']), false);
});

test('a dated official overview without the named policy cohort triggers scoped search', () => {
  const claim = "Australia's Group 1 entities must prepare sustainability reports for financial years beginning on or after 1 January 2025.";
  const url = 'https://www.asic.gov.au/regulatory-resources/sustainability-reporting';
  const overview = 'The largest entities report for financial years beginning on or after 1 January 2025.';
  const scoped = 'Group 1 entities must report for financial years commencing on or after 1 January 2025.';
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: overview }], ['gov.au']), true);
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: scoped }], ['gov.au']), false);
  assert.equal(scopedHitAddsGroup(claim, overview, scoped), true);
  assert.equal(scopedHitAddsGroup(claim, scoped, overview), false);
  assert.equal(scopedHitAddsGroup('Australia reporting changed in 2025', overview, scoped), false);
});

test('a second issuer excerpt naming a cohort reaches adjudication with its search origin', async () => {
  const previous = {nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY};
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const claim = "Australia's Group 1 entities must prepare sustainability reports for financial years beginning on or after 1 January 2025.";
  const url = 'https://www.asic.gov.au/regulatory-resources/sustainability-reporting';
  const searches: Array<Record<string, unknown>> = [];
  let adjudicationPrompt = '';
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    const body = JSON.parse(String(init?.body));
    if (endpoint.endsWith('/search')) {
      searches.push(body);
      const scoped = Boolean(body.include_domains);
      return Response.json({request_id: scoped ? 'asic-scoped' : 'asic-overview', results: [{
        url, title: 'Sustainability reporting', score: .94,
        content: scoped
          ? 'Group 1 entities must prepare sustainability reports for financial years commencing on or after 1 January 2025.'
          : 'The largest entities prepare sustainability reports for financial years commencing on or after 1 January 2025.',
      }]});
    }
    if (endpoint.endsWith('/extract')) return Response.json({request_id: 'asic-empty-extract', results: []});
    const name = body.tool_choice.function.name;
    if (name === 'record_verdict') adjudicationPrompt = body.messages.at(-1).content;
    const args = name === 'record_assertions'
      ? {assertions: [{text: claim, search_query: 'Australia sustainability reporting Group 1 start date'}]}
      : name === 'record_screening'
        ? {judgements: [0, 1].map(index => ({index, relevant: true, leaning: 'supports'}))}
        : {verdict: 'supported', confidence: .8, cited_urls: [url], rationale: 'The issuer passage names the cohort and date.'};
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {
      tool_calls: [{function: {name, arguments: JSON.stringify(args)}}],
    }}]});
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(claim,
      {inspectSources: true, tavilyBudget: 3, fetch: transport})) events.push(event);
    const evidence = events.find(event => event.type === 'evidence');
    const done = events.find(event => event.type === 'done');
    assert.ok(evidence?.type === 'evidence');
    assert.ok(done?.type === 'done');
    assert.deepEqual(searches.map(search => search.include_domains ?? null), [null, ['gov.au']]);
    assert.deepEqual(evidence.docs.map(doc => doc.searchRequestId), ['asic-overview', 'asic-scoped']);
    assert.match(adjudicationPrompt, /Group 1 entities must prepare/);
    assert.equal(done.result.stats.tavilyCalls, 3);
    assert(done.result.provenance?.adjudicationEvidence.a1.some(doc =>
      doc.url === url && doc.searchRequestId === 'asic-scoped' && /Group 1/.test(doc.snippet)));
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('a changeover-year page does not settle a different before-date entitlement', () => {
  const claim = 'In the United Kingdom, waiting days that fell before 6 April 2026 are paid under the new rule.';
  const assertion = 'Waiting days that occurred before 6 April 2026 are paid under the new rule.';
  const url = 'https://www.gov.uk/guidance/example';
  const unrelated = 'Waiting days are abolished from 6 April 2026. Sickness absence starting before 6 April 2026 may continue after that date.';
  const relevant = 'Employees are not paid for waiting days that occurred before 6 April 2026.';
  assert.equal(needsOfficialSearch(claim, [{url, snippet: unrelated}], ['gov.uk'], assertion), true);
  assert.equal(needsOfficialSearch(claim, [{url, snippet: relevant}], ['gov.uk'], assertion), false);
  assert.equal(scopedHitAddsBoundary(assertion, unrelated, relevant), true);
  assert.equal(scopedHitAddsBoundary(assertion, relevant, unrelated), false);
});

test('a general official transition summary does not erase a warehouse-release condition', () => {
  const claim = 'In the United Kingdom, steel released from a customs warehouse after 1 July 2026 can qualify for an exemption under a contract entered into before 14 March 2026.';
  const summary = 'Steel under contract before 14 March 2026 can be exempt from 1 July 2026.';
  const detail = summary + ' Goods released from a customs warehouse after 1 July 2026 can use the exemption if imported under that contract.';
  const url = 'https://www.gov.uk/government/publications/steel-measure';
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: summary }], ['gov.uk']), true);
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: detail }], ['gov.uk']), false);
  assert.equal(scopedHitAddsRoute(claim, summary, detail), true);
  assert.equal(scopedHitAddsRoute(claim, detail, summary), false);
});

test('a dated course table does not settle a field-of-study exemption', () => {
  const claim = 'A Canadian college graduate who applied for a study permit before 1 November 2024 is exempt from the PGWP field-of-study requirement.';
  const assertion = claim;
  const url = 'https://www.canada.ca/en/immigration/field-of-study.html';
  const table = 'Your program is eligible if you submitted your study permit application Before November 1, 2024.';
  const rule = 'If you submitted your study permit application before November 1, 2024, you do not need to meet the field-of-study requirement.';
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: table }], ['canada.ca'], assertion), true);
  assert.equal(needsOfficialSearch(claim, [{ url, snippet: rule }], ['canada.ca'], assertion), false);
  assert.equal(lacksExceptionDisposition(table, assertion), true);
  assert.equal(scopedHitAddsDisposition(assertion, table, rule), true);
});

test('earlier page inspection leaves a scoped-search call for the last assertion', async () => {
  const previous = { nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY };
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const scopes: unknown[] = [];
  let extractionCalls = 0;
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    if (endpoint.endsWith('/search')) {
      const request = JSON.parse(String(init?.body)) as { include_domains?: string[] };
      scopes.push(request.include_domains ?? null);
      const index = scopes.length;
      const year = index <= 2 ? '2025' : index <= 3 ? '2026' : '2027';
      const official = index === 2 || index === 3 || index === 5;
      return Response.json({ request_id: `search-${index}`, results: [{
        url: official ? `https://www.gov.uk/guidance/rule-${year}` : `https://example.com/rule-${year}`,
        title: `Rule ${year}`, score: .95, content: `The UK rule for ${year} applies.`,
      }] });
    }
    if (endpoint.endsWith('/extract')) {
      extractionCalls++;
      return Response.json({ request_id: `extract-${extractionCalls}`, results: [] });
    }
    const request = JSON.parse(String(init?.body));
    const name = request.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? { assertions: ['2025', '2026', '2027'].map(year => ({
          text: `The United Kingdom rule for ${year} applies.`, search_query: `UK rule ${year}`,
        })) }
      : name === 'record_screening'
        ? { judgements: [{ index: 0, relevant: true, leaning: 'supports' }] }
        : { verdict: 'insufficient_evidence', confidence: .3, cited_urls: [], rationale: 'Fixture' };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }],
    } }] });
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(
      'The United Kingdom rules for 2025, 2026 and 2027 apply.',
      { inspectSources: true, tavilyBudget: 6, fetch: transport })) events.push(event);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.type === 'done');
    assert.deepEqual(scopes, [null, ['gov.uk'], null, null, ['gov.uk']]);
    assert.equal(extractionCalls, 1);
    assert.equal(done.result.stats.tavilyCalls, 6);
    assert.ok(events.some(event => event.type === 'stage' && event.stage === 'extract' &&
      event.status === 'done' && event.detail?.includes('reserved for later assertions')));
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('scoped search retains a second, more dated passage from the same official URL', async () => {
  const previous = {nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY};
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const url = 'https://www.canada.ca/en/immigration-refugees-citizenship/graduate-student.html';
  const requests: Array<Record<string, unknown>> = [];
  let adjudicationPrompt = '';
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    if (endpoint.endsWith('/search')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      const scoped = Boolean(body.include_domains);
      return Response.json({request_id: scoped ? 'dated-official' : 'wrong-year', results: [{
        url, title: 'Graduate study permits', score: .95,
        content: scoped
          ? 'For 2025, graduate students were included in the national study-permit cap.'
          : 'Starting in 2026, graduate students at public institutions do not need an attestation letter.',
      }]});
    }
    if (endpoint.endsWith('/extract')) return Response.json({request_id: 'page-read', results: [{
      url, raw_content: 'Starting in 2026, graduate students at public institutions do not need an attestation letter.' +
        ' General guidance for study permit applicants. '.repeat(35) +
        'For 2025, graduate students were included in the national study-permit cap and required an attestation letter.',
    }]});
    const body = JSON.parse(String(init?.body));
    const name = body.tool_choice.function.name;
    if (name === 'record_verdict') adjudicationPrompt = body.messages.at(-1).content;
    const args = name === 'record_assertions'
      ? {assertions: [{text: "In 2025, Canadian master's and doctoral study-permit applicants were exempt from the national cap.",
        search_query: '2025 Canada graduate study permit cap exemption'}]}
      : name === 'record_screening'
        ? {judgements: [0, 1].map(index => ({index, relevant: true, leaning: index ? 'refutes' : 'unclear'}))}
        : {verdict: 'refuted', confidence: .8, cited_urls: [url], rationale: 'The 2025 passage includes graduates in the cap.'};
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {
      tool_calls: [{function: {name, arguments: JSON.stringify(args)}}],
    }}]});
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(
      "In 2025, Canadian master's and doctoral study-permit applicants were exempt from the national cap.",
      {inspectSources: true, tavilyBudget: 3, fetch: transport})) events.push(event);
    const evidence = events.find(event => event.type === 'evidence');
    const done = events.find(event => event.type === 'done');
    assert.ok(evidence?.type === 'evidence');
    assert.ok(done?.type === 'done');
    assert.deepEqual(requests.map(request => request.include_domains ?? null),
      [null, ['canada.ca', 'gc.ca']]);
    assert.deepEqual(evidence.docs.map(doc => doc.searchRequestId), ['wrong-year', 'dated-official']);
    assert.equal(done.result.overall, 'refuted');
    assert.equal(done.result.stats.tavilyCalls, 3);
    assert.match(adjudicationPrompt, /Starting in 2026/);
    assert.match(adjudicationPrompt, /For 2025/);
    assert.deepEqual(done.result.provenance?.adjudicationEvidence.a1.map(doc => doc.searchRequestId),
      ['wrong-year', 'dated-official']);
    assert.deepEqual(done.result.provenance?.adjudicationEvidence.a1.map(doc => doc.extractionRequestId),
      ['page-read', 'page-read']);
    assert.match(done.result.provenance!.adjudicationEvidence.a1[1].snippet, /For 2025/);
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('later assertions can inspect a scoped official result already found for the same claim', async () => {
  const previous = {nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY};
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const current = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/graduate.html';
  const historical = 'https://www.canada.ca/en/immigration-refugees-citizenship/news/notices/2025-cap.html';
  const generic = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/pal.html';
  const searchDomains: Array<unknown> = [];
  let searchCount = 0;
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    if (endpoint.endsWith('/search')) {
      const body = JSON.parse(String(init?.body));
      searchDomains.push(body.include_domains ?? null);
      searchCount++;
      const result = searchCount === 1
        ? {url: current, title: 'Current graduate guidance', score: .95,
          content: 'Starting in 2026, graduate students do not need an attestation letter.'}
        : searchCount === 2
          ? {url: historical, title: '2025 graduate allocations', score: .93,
            content: 'In 2025, graduate students are included in the national cap and must provide a provincial attestation letter.'}
          : {url: generic, title: 'Attestation letter guidance', score: .91,
            content: 'As of January 2026, graduate students may be exempt from the attestation letter.'};
      return Response.json({request_id: `search-${searchCount}`, results: [result]});
    }
    if (endpoint.endsWith('/extract')) return Response.json({request_id: 'extract-1', results: []});
    const body = JSON.parse(String(init?.body));
    const name = body.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? {assertions: [
        {text: 'In 2025, Canadian graduate students were exempt from the national cap.',
          search_query: '2025 Canadian graduate cap exemption'},
        {text: 'In 2025, Canadian graduate students were exempt from provincial attestation letters.',
          search_query: '2025 Canadian graduate attestation exemption'},
      ]}
      : name === 'record_screening'
        ? {judgements: [0, 1].map(index => ({index, relevant: true, leaning: index ? 'refutes' : 'unclear'}))}
        : {verdict: 'refuted', confidence: .8, cited_urls: [historical], rationale: 'The 2025 government notice directly addresses graduates.'};
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {
      tool_calls: [{function: {name, arguments: JSON.stringify(args)}}],
    }}]});
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(
      'In 2025, Canadian graduate students were exempt from the national cap and provincial attestation letters.',
      {inspectSources: true, tavilyBudget: 4, fetch: transport})) events.push(event);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.type === 'done');
    assert.deepEqual(searchDomains, [null, ['canada.ca', 'gc.ca'], null]);
    assert.equal(done.result.overall, 'refuted');
    assert.equal(done.result.stats.tavilyCalls, 4);
    assert(done.result.provenance?.adjudicationEvidence.a2.some(doc =>
      doc.url === historical && doc.searchRequestId === 'search-2'));
    assert(done.result.assertions[1].citedUrls.includes(historical));
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('later assertions can reuse an official passage found in the open-web draw', async () => {
  const previous = {nebius: process.env.NEBIUS_API_KEY, tavily: process.env.TAVILY_API_KEY};
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const official = 'https://www.gov.uk/guidance/immigration-rules/eta';
  const other = 'https://example.com/eta-commentary';
  const searchDomains: Array<unknown> = [];
  let searches = 0;
  const transport: typeof fetch = async (input, init) => {
    const endpoint = String(input);
    if (endpoint.endsWith('/search')) {
      const body = JSON.parse(String(init?.body));
      searchDomains.push(body.include_domains ?? null);
      searches++;
      return Response.json({request_id: `search-${searches}`, results: [{
        url: searches === 1 ? official : other,
        title: searches === 1 ? 'UK ETA rules' : 'ETA travel commentary', score: .95,
        content: searches === 1
          ? 'ETA 1.3 exempts lawful Irish residents travelling within the CTA. ETA 1.6 requires proof of residence from people aged 16 or over if requested.'
          : 'Irish residents can travel within the Common Travel Area.',
      }]});
    }
    if (endpoint.endsWith('/extract')) return Response.json({request_id: 'empty-extract', results: []});
    const body = JSON.parse(String(init?.body));
    const name = body.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? {assertions: [
        {text: 'UK ETA 1.3 exempts lawful Irish residents travelling within the CTA.', search_query: 'UK ETA 1.3 Ireland CTA'},
        {text: 'UK ETA 1.6 may require those aged 16 or over to prove lawful Irish residence.', search_query: 'UK ETA 1.6 proof age'},
      ]}
      : name === 'record_screening'
        ? {judgements: [0, 1].map(index => ({index, relevant: true, leaning: 'supports'}))}
        : {verdict: 'supported', confidence: .8, cited_urls: [official], rationale: 'The UK Rules passage states both clauses.'};
    return Response.json({choices: [{finish_reason: 'tool_calls', message: {
      tool_calls: [{function: {name, arguments: JSON.stringify(args)}}],
    }}]});
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification(
      'UK ETA 1.3 exempts lawful Irish residents travelling within the CTA and ETA 1.6 may require proof for ages 16 and over.',
      {inspectSources: true, tavilyBudget: 4, fetch: transport})) events.push(event);
    const done = events.find(event => event.type === 'done');
    assert.ok(done?.type === 'done');
    assert.deepEqual(searchDomains, [null, null]);
    assert.equal(done.result.overall, 'supported');
    assert(done.result.provenance?.adjudicationEvidence.a2.some(doc =>
      doc.url === official && doc.searchRequestId === 'search-1'));
    assert(done.result.assertions[1].citedUrls.includes(official));
  } finally {
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});

test('opt-in search keeps open evidence, adds scoped hits, and records each search origin', async () => {
  const previous = { fetch: globalThis.fetch, nebius: process.env.NEBIUS_API_KEY,
    tavily: process.env.TAVILY_API_KEY };
  process.env.NEBIUS_API_KEY = process.env.TAVILY_API_KEY = 'offline-key';
  const searches: Array<Record<string, unknown>> = [];
  const open = 'https://example.org/gst';
  const official = 'https://www.iras.gov.sg/gst';
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/search')) {
      searches.push(body);
      const scoped = Boolean(body.include_domains);
      return Response.json({ request_id: scoped ? 'official-2' : 'open-1', results: scoped
        ? [
          { url: official, title: 'GST rate', score: .96, content: 'Standard GST is 9% from 1 Jan 2024.' },
          { url: 'https://gov.sg.evil.example/forged', title: 'Forged', score: .99, content: 'Forgery' },
        ]
        : [{ url: open, title: 'News', score: .9, content: 'GST changed.' }] });
    }
    if (String(url).endsWith('/extract')) return Response.json({ request_id: 'extract-3',
      results: [{ url: official, raw_content: 'Official GST rate: 9% from 1 Jan 2024.' }] });
    const name = body.tool_choice.function.name;
    const args = name === 'record_assertions'
      ? { assertions: [{ text: 'Singapore GST rate is 9% from 2024.', search_query: 'Singapore GST rate 2024' }] }
      : name === 'record_screening'
        ? { judgements: [0, 1].map(index => ({ index, relevant: true, leaning: 'supports' })) }
        : { verdict: 'supported', confidence: .8, cited_urls: [official], rationale: 'Official passage.' };
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }],
    } }] });
  };
  try {
    const events: VerifyEvent[] = [];
    for await (const event of runVerification('Singapore GST rate is 9% from 2024.',
      { inspectSources: true, tavilyBudget: 3 })) events.push(event);
    const evidence = events.find(event => event.type === 'evidence');
    const done = events.find(event => event.type === 'done');
    assert.ok(evidence?.type === 'evidence');
    assert.ok(done?.type === 'done');
    assert.deepEqual(searches.map(search => search.include_domains ?? null), [null, ['gov.sg']]);
    assert.equal(searches[1].include_domains_mode, 'restrict');
    assert.deepEqual(evidence.docs.map(doc => doc.url), [open, official]);
    assert.deepEqual(evidence.docs.map(doc => doc.searchRequestId), ['open-1', 'official-2']);
    assert.equal(done.result.stats.tavilyCalls, 3);
    assert.deepEqual(done.result.tavilyRequestIds, ['open-1', 'official-2', 'extract-3']);
    assert.equal(done.result.provenance?.adjudicationEvidence.a1[0].searchRequestId, 'official-2');
    assert.equal(done.result.provenance?.adjudicationEvidence.a1[0].extractionRequestId, 'extract-3');
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.nebius === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = previous.nebius;
    if (previous.tavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previous.tavily;
  }
});
