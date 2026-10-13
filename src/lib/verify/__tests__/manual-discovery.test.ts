import assert from 'node:assert/strict';
import {test} from 'node:test';
import {currentManualUrl, discoverCurrentManual} from '../manual-discovery';
import {isSourceNavigation, currentInstructionTitle} from '../source-navigation';
import {officialSearchCollections} from '../official-search';

const seed = {url: 'https://www.immigration.govt.nz/opsmanual/11111.htm',
  title: 'E9.9 Example rule (01/07/2019)', snippet: 'Historical rule', retrievalScore: .8, searchRequestId: 'seed-search'};
const title = 'E9.9 Example rule';
const index = `<a href="11111.htm">${seed.title}</a><a href="22222.htm">${title}</a>`;

test('navigation filtering excludes search and contents pages, not actual gazette documents', () => {
  for (const url of ['https://www.impots.gouv.fr/recherche?key=invoice', 'https://gov.uk/search/all',
    'https://www.immigration.govt.nz/opsmanual/toc.htm', 'https://www.immigration.govt.nz/opsmanual']) {
    assert.equal(isSourceNavigation(url), true);
  }
  assert.equal(isSourceNavigation('https://www.boe.es/buscar/act.php?id=BOE-A-2024-1'), false);
  assert.equal(isSourceNavigation('https://www.gov.uk/government/publications/search-and-rescue'), false);
});

test('manual resolver uses the discovered section, unique current index link and issuing host', () => {
  assert.equal(currentInstructionTitle('A current rule applies.', [seed]), title);
  assert.equal(currentInstructionTitle('A rule applied in 2019.', [seed]), null);
  assert.equal(currentManualUrl(index, title), 'https://www.immigration.govt.nz/opsmanual/22222.htm');
  assert.equal(currentManualUrl(`<a href="https://evil.example/22222.htm">${title}</a>`, title), null);
  assert.equal(currentManualUrl(`<a href="https://127.0.0.1/22222.htm">${title}</a>`, title), null);
  assert.equal(currentManualUrl(index + `<a href="33333.htm">${title}</a>`, title), null);
  assert.equal(currentManualUrl(`<a href="11111.htm">${seed.title}</a>`, title), null);
});

test('bounded manual discovery retains actual text and lineage without a fabricated Search hit', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.redirect, 'manual');
    return new Response(calls.length === 1 ? index : `<html><body><h1>${title}</h1><p>Current rule text. Effective 2025.</p></body></html>`,
      {headers: {'content-type':'text/html'}});
  };
  const doc = await discoverCurrentManual('A current rule applies.', seed, {fetch: fetcher});
  assert.ok(doc);
  assert.equal(calls.length, 2);
  assert.match(doc.snippet, /Current rule text/);
  assert.equal(doc.url, calls[1]);
  assert.equal(doc.searchRequestId, undefined);
  assert.equal(doc.extractionRequestId, undefined);
  assert.equal(doc.retrievalScore, 0);
  assert.equal(doc.issuerDiscovery?.seedRequestId, 'seed-search');
  assert.equal(doc.issuerDiscovery?.indexUrl, calls[0]);
});

test('redirects, oversized indices, archived pages and historical claims fail closed', async () => {
  let calls = 0;
  const redirect: typeof fetch = async () => {calls++;return new Response(null, {status:302,headers:{location:'https://evil.example'}});};
  assert.equal(await discoverCurrentManual('Rule applies.', seed, {fetch:redirect}), null);
  assert.equal(calls, 1);
  assert.equal(await discoverCurrentManual('Rule applied in 2019.', seed, {fetch:redirect}), null);
  assert.equal(calls, 1);
  assert.equal(await discoverCurrentManual('Rule applies.', seed, {fetch:async()=>new Response('x'.repeat(600001),{headers:{'content-type':'text/html'}})}), null);
  let count = 0;
  assert.equal(await discoverCurrentManual('Rule applies.', seed, {fetch:async()=>new Response(++count === 1 ? index : `${title}. These are archived immigration instructions that are no longer current`,{headers:{'content-type':'text/html'}})}), null);
});

test('collection routing identifies repositories, never a known answer document', () => {
  assert.deepEqual(officialSearchCollections('New Zealand NZeTA validity'), ['immigration.govt.nz/opsmanual']);
  assert.deepEqual(officialSearchCollections('French electronic invoicing'), ['impots.gouv.fr/professionnel','impots.gouv.fr/internationalenbusiness']);
  assert.deepEqual(officialSearchCollections('Japan visitor visa'), ['go.jp']);
});
