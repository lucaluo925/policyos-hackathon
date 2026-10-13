import assert from 'node:assert/strict';
import test from 'node:test';
import { researchCountry, InvalidCountryResearchQuery } from '../country';
import { POST } from '@/app/api/explore/research/route';

test('an unconfigured map country can search once and gets traceable, safe leads', async () => {
  const calls: string[] = [];
  const client = {
    search: async (query: string) => {
      calls.push(query);
      return {
        requestId: 'tavily-test-request', elapsedMs: 3,
        hits: [
          { url: 'https://news.example.test/story', title: 'Qatar customs commentary', content: 'Secondary summary', score: 0.9 },
          { url: 'javascript:alert(1)', title: 'Unsafe', content: 'No', score: 1 },
          { url: 'https://www.gov.uk/government/news/example', title: 'Official Qatar tariff update', content: 'Original notice', score: 0.4 },
          { url: 'https://www.gov.uk/government/news/example', title: 'Duplicate Qatar update', content: 'Duplicate', score: 0.3 },
          { url: 'https://news.example.test/generic', title: 'Tariffs and trade policy', content: 'China and United States', score: 0.8 },
          { url: 'https://news.qa/generic', title: 'Worldwide tariffs', content: 'No local context', score: 0.7 },
          { url: 'https://gta.gov.qa/en/news/example', title: 'Customs rule update', content: 'New official schedule', score: 0.2 },
        ],
      };
    },
  };
  const result = await researchCountry('QA', 'trade', client);
  assert.equal(result.countryIso, 'QA');
  assert.equal(result.domain, 'trade');
  assert.equal(result.scope, 'public');
  assert.equal(result.requestId, 'tavily-test-request');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Qatar.*trade tariffs customs/);
  assert.deepEqual(result.items.map(item => item.title), ['Customs rule update', 'Official Qatar tariff update', 'Qatar customs commentary']);
  assert.equal(result.items[0].recognizedOfficialDomain, true);
  assert.equal(result.items[0].countryGovernmentDomain, true);
  assert.equal(result.items[1].recognizedOfficialDomain, true);
  assert.equal(result.items[1].countryGovernmentDomain, false);
  assert.equal(result.items[2].recognizedOfficialDomain, false);
});

test('invalid country and domain never reach the search provider', async () => {
  let calls = 0;
  const client = { search: async () => { calls++; throw new Error('should not run'); } };
  await assert.rejects(researchCountry('ZZ', 'climate', client), InvalidCountryResearchQuery);
  await assert.rejects(researchCountry('QA', 'everything', client), InvalidCountryResearchQuery);
  await assert.rejects(researchCountry('QA', 'trade', client, 'invalid'), InvalidCountryResearchQuery);
  await assert.rejects(researchCountry('OM', 'trade', client, 'country-government'), InvalidCountryResearchQuery);
  assert.equal(calls, 0);
  const response = await POST(new Request('http://localhost/api/explore/research', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country: 'ZZ', domain: 'trade' }),
  }));
  assert.equal(response.status, 400);
  const unavailable = await POST(new Request('http://localhost/api/explore/research', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country: 'OM', domain: 'trade', scope: 'country-government' }),
  }));
  assert.equal(unavailable.status, 400);
});

test('restricted country-government search uses one domain-limited call and rejects an out-of-scope URL', async () => {
  let calls = 0;
  const result = await researchCountry('QA', 'trade', { search: async (_query, opts) => {
    calls++;
    assert.ok(opts);
    assert.deepEqual(opts.includeDomains, ['gov.qa']);
    return { requestId: 'qatar-government', elapsedMs: 1, hits: [
      { url: 'https://www.customs.gov.qa/en/circulars', title: 'Qatar customs circulars', content: 'Official directory of customs decisions', score: 1 },
      { url: 'https://news.example.test/qatar', title: 'Qatar customs analysis', content: 'Secondary article', score: 0.9 },
    ] };
  } }, 'country-government');
  assert.equal(calls, 1);
  assert.equal(result.scope, 'country-government');
  assert.equal(result.requestId, 'qatar-government');
  assert.deepEqual(result.items.map(item => item.title), ['Qatar customs circulars']);
  assert.equal(result.items[0].countryGovernmentDomain, true);
});

test('new map jurisdictions make bounded government-domain calls and discard cross-country hits', async () => {
  for (const [country, domain, suffix, officialUrl, wrongUrl] of [
    ['SA', 'climate', 'gov.sa', 'https://mep.gov.sa/en/climate-policy', 'https://environment.gov.ng/climate-policy'],
    ['KE', 'immigration', 'go.ke', 'https://immigration.go.ke/visa-policy', 'https://dti.gov.ph/visa-policy'],
    ['PH', 'trade', 'gov.ph', 'https://dti.gov.ph/trade-policy', 'https://mep.gov.sa/trade-policy'],
    ['NG', 'climate', 'gov.ng', 'https://environment.gov.ng/climate-policy', 'https://immigration.go.ke/climate-policy'],
  ] as const) {
    let calls = 0;
    const result = await researchCountry(country, domain, { search: async (_query, opts) => {
      calls++;
      assert.deepEqual(opts?.includeDomains, [suffix]);
      return { requestId: `${country}-government`, elapsedMs: 1, hits: [
        { url: officialUrl, title: `${country} ${domain} policy`, content: 'Government policy page', score: 1 },
        { url: wrongUrl, title: `${country} ${domain} policy`, content: 'Another jurisdiction', score: 0.9 },
      ] };
    } }, 'country-government');
    assert.equal(calls, 1);
    assert.deepEqual(result.items.map(item => item.url), [officialUrl]);
    assert.equal(result.items[0].countryGovernmentDomain, true);
  }
});

test('a government host cap keeps concrete agreement pages ahead of a homepage and index', async () => {
  const result = await researchCountry('CH', 'trade', { search: async () => ({
    requestId: 'swiss-host-order', elapsedMs: 1, hits: [
      { url: 'https://www.seco.admin.ch/en/relations', title: 'Swiss-US trade relations', content: '', score: 1 },
      { url: 'https://www.seco.admin.ch/en/home', title: 'State Secretariat for Economic Affairs SECO', content: 'Trade policy and tariffs', score: 0.9 },
      { url: 'https://www.seco.admin.ch/en/uk-agreement', title: 'Free trade agreement Switzerland - United Kingdom UK', content: '', score: 0.8 },
      { url: 'https://www.seco.admin.ch/en/china-agreement', title: 'Switzerland and China conclude negotiations on free trade agreement', content: '', score: 0.7 },
    ],
  }) }, 'country-government');
  assert.deepEqual(result.items.map(item => item.title), [
    'Free trade agreement Switzerland - United Kingdom UK',
    'Switzerland and China conclude negotiations on free trade agreement',
  ]);
});

test('a topical government excerpt does not turn navigation titles into policy leads', async () => {
  const result = await researchCountry('PH', 'trade', { search: async () => ({
    requestId: 'philippines-navigation', elapsedMs: 1, hits: [
      { url: 'https://www.tariffcommission.gov.ph/', title: 'Home', content: 'Trade tariff rules and orders', score: 1 },
      { url: 'https://www.tariffcommission.gov.ph/history', title: 'TC History', content: 'Trade tariff commission history', score: 0.9 },
      { url: 'https://www.tariffcommission.gov.ph/eo-25', title: 'Executive Order 25', content: 'Trade tariff schedule', score: 0.8 },
    ],
  }) }, 'country-government');
  assert.deepEqual(result.items.map(item => item.title), ['Executive Order 25']);
});

test('country matching does not confuse Oman with Romania or a generic tariff page', async () => {
  const result = await researchCountry('OM', 'trade', { search: async () => ({
    requestId: 'country-filter', elapsedMs: 1, hits: [
      { url: 'https://example.test/romania', title: 'Romania customs update', content: '', score: 0.8 },
      { url: 'https://example.test/tariffs', title: 'Tariffs worldwide', content: '', score: 0.8 },
      { url: 'https://example.test/oman', title: 'Oman customs update', content: '', score: 0.8 },
    ],
  }) });
  assert.deepEqual(result.items.map(item => item.title), ['Oman customs update']);
});

test('administrative names distinguish the Koreas and Congos in query and result filtering', async () => {
  const queries: string[] = [];
  const search = async (query: string) => {
    queries.push(query);
    return { requestId: 'ambiguous-country', elapsedMs: 1, hits: [
      { url: 'https://news.example.test/north', title: 'North Korea trade update', content: '', score: 1 },
      { url: 'https://news.example.test/south', title: 'South Korea trade update', content: '', score: 1 },
      { url: 'https://news.example.test/drc', title: 'DR Congo customs update', content: '', score: 1 },
      { url: 'https://news.example.test/roc', title: 'Republic of the Congo customs update', content: '', score: 1 },
      { url: 'https://news.example.test/vague', title: 'Congo customs update', content: '', score: 1 },
    ] };
  };
  const kr = await researchCountry('KR', 'trade', { search });
  const kp = await researchCountry('KP', 'trade', { search });
  const cd = await researchCountry('CD', 'trade', { search });
  const cg = await researchCountry('CG', 'trade', { search });
  assert.match(queries[0], /^South Korea government/);
  assert.match(queries[1], /^North Korea government/);
  assert.match(queries[2], /^Democratic Republic of the Congo government/);
  assert.match(queries[3], /^Republic of the Congo government/);
  assert.deepEqual(kr.items.map(item => item.title), ['South Korea trade update']);
  assert.deepEqual(kp.items.map(item => item.title), ['North Korea trade update']);
  assert.deepEqual(cd.items.map(item => item.title), ['DR Congo customs update']);
  assert.deepEqual(cg.items.map(item => item.title), ['Republic of the Congo customs update']);
});

test('map research removes generic profiles, wrong-domain climate statements and repeated publishers', async () => {
  const mx = await researchCountry('MX', 'trade', { search: async () => ({
    requestId: 'mexico-topicality', elapsedMs: 1, hits: [
      { url: 'https://en.wikipedia.org/wiki/Mexico', title: 'Mexico', content: 'Population and GDP', score: 1 },
      { url: 'https://www.gob.mx/example', title: 'Customs tariff schedule', content: 'Official schedule', score: 0.5 },
      { url: 'https://news.example.test/profile', title: 'Mexico country profile', content: 'A trade menu is listed', score: 0.5 },
    ],
  }) });
  assert.deepEqual(mx.items.map(item => item.title), ['Customs tariff schedule']);
  assert.equal(mx.items[0].countryGovernmentDomain, true);

  const pe = await researchCountry('PE', 'climate', { search: async () => ({
    requestId: 'peru-climate', elapsedMs: 1, hits: [
      { url: 'https://www.state.gov/peru', title: '2026 Peru Investment Climate Statement', content: 'Business conditions', score: 1 },
      { url: 'https://news.example.test/peru', title: 'Peru climate action plan', content: 'Environmental policy lead', score: 0.5 },
    ],
  }) });
  assert.deepEqual(pe.items.map(item => item.title), ['Peru climate action plan']);

  const cz = await researchCountry('CZ', 'immigration', { search: async () => ({
    requestId: 'czech-publisher-diversity', elapsedMs: 1, hits: [
      { url: 'https://visahq.example.test/a', title: 'Germany border checks with Czechia', content: '', score: 1 },
      { url: 'https://visahq.example.test/b', title: 'Austria border checks with Czechia', content: '', score: 0.9 },
    ],
  }) });
  assert.equal(cz.items.length, 1);
});

test('verified UAE government portal survives a generic-country headline', async () => {
  const result = await researchCountry('AE', 'trade', { search: async () => ({
    requestId: 'uae-official-portal', elapsedMs: 1, hits: [
      { url: 'https://u.ae/en/information-and-services/finance-and-investment/customs-duty', title: 'Customs duty and tariff', content: 'Official government tariff information', score: 1 },
    ],
  }) });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].countryGovernmentDomain, true);
});

test('map research route makes one server-side Tavily call and returns its request ID', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  let calls = 0;
  process.env.TAVILY_API_KEY = 'offline-test-key';
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.method, 'POST');
    const sent = JSON.parse(String(init?.body));
    assert.match(sent.query, /Qatar.*trade tariffs customs/);
    assert.equal(sent.max_results, 5);
    return new Response(JSON.stringify({ request_id: 'offline-tavily-id', results: [
      { url: 'https://gta.gov.qa/en/news/example', title: 'Official Qatar customs news', content: 'Public excerpt' },
    ] }), { status: 200 });
  };
  try {
    const response = await POST(new Request('http://localhost/api/explore/research', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'QA', domain: 'trade', query: 'ignore this' }),
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.requestId, 'offline-tavily-id');
    assert.equal(result.items[0].recognizedOfficialDomain, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
  }
});

test('map government-site route sends Tavily a restricted domain list', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  let calls = 0;
  process.env.TAVILY_API_KEY = 'offline-test-key';
  globalThis.fetch = async (_input, init) => {
    calls++;
    const sent = JSON.parse(String(init?.body));
    assert.deepEqual(sent.include_domains, ['gov.qa']);
    assert.equal(sent.include_domains_mode, 'restrict');
    return new Response(JSON.stringify({ request_id: 'restricted-test-id', results: [
      { url: 'https://www.customs.gov.qa/en/circulars', title: 'Qatar customs circulars', content: 'Official decisions' },
    ] }), { status: 200 });
  };
  try {
    const response = await POST(new Request('http://localhost/api/explore/research', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'QA', domain: 'trade', scope: 'country-government' }),
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.scope, 'country-government');
    assert.equal(result.requestId, 'restricted-test-id');
    assert.equal(result.items[0].countryGovernmentDomain, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
  }
});

test('public multi-instance mode fails closed without a shared database', async () => {
  const old = {
    fetch: globalThis.fetch,
    key: process.env.TAVILY_API_KEY,
    database: process.env.DATABASE_URL,
    vercel: process.env.VERCEL,
  };
  let calls = 0;
  process.env.TAVILY_API_KEY = 'offline-test-key';
  process.env.DATABASE_URL = '';
  process.env.VERCEL = '1';
  globalThis.fetch = async () => { calls++; throw new Error('provider must not be called'); };
  try {
    const response = await POST(new Request('http://localhost/api/explore/research', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'OM', domain: 'climate' }),
    }));
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old.fetch;
    if (old.key === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = old.key;
    if (old.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = old.database;
    if (old.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = old.vercel;
  }
});
