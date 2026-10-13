import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryGovernmentSearchDomains, countOfficial, isCountryGovernmentSource, isOfficialSource, officialFirst } from '../sources';

test('searchable government domains exclude a bare top-level suffix', () => {
  assert.deepEqual(countryGovernmentSearchDomains('QA'), ['gov.qa']);
  assert.deepEqual(countryGovernmentSearchDomains('AE'), ['gov.ae', 'u.ae']);
  assert.deepEqual(countryGovernmentSearchDomains('US'), []);
  assert.deepEqual(countryGovernmentSearchDomains('OM'), []);
  assert.deepEqual(countryGovernmentSearchDomains('SA'), ['gov.sa']);
  assert.deepEqual(countryGovernmentSearchDomains('KE'), ['go.ke']);
  assert.deepEqual(countryGovernmentSearchDomains('PH'), ['gov.ph']);
  assert.deepEqual(countryGovernmentSearchDomains('NG'), ['gov.ng']);
});

test('German finance ministry outside bund.de is recognized without trusting all German sites', () => {
  assert.deepEqual(countryGovernmentSearchDomains('DE'), ['bund.de', 'bundesfinanzministerium.de']);
  const url = 'https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html';
  assert.equal(isOfficialSource(url), true);
  assert.equal(isCountryGovernmentSource(url, 'DE'), true);
  assert.equal(isCountryGovernmentSource(url, 'FR'), false);
  assert.equal(isOfficialSource('https://www.bundesfinanzministerium.de.attacker.test/policy'), false);
  assert.equal(isOfficialSource('https://notbundesfinanzministerium.de/policy'), false);
  assert.equal(isOfficialSource('https://example.de/bundesfinanzministerium.de/policy'), false);
});

test('new government research domains accept real agency hosts but not lookalikes', () => {
  for (const [country, host] of [
    ['SA', 'mep.gov.sa'], ['KE', 'immigration.go.ke'],
    ['PH', 'dti.gov.ph'], ['NG', 'environment.gov.ng'],
  ]) {
    assert.equal(isCountryGovernmentSource(`https://${host}/policy`, country), true);
    assert.equal(isCountryGovernmentSource(`https://${host}.example.test/policy`, country), false);
    assert.equal(isCountryGovernmentSource(`https://example.test/${host}/policy`, country), false);
  }
  assert.equal(isCountryGovernmentSource('https://mep.gov.sa/policy', 'KE'), false);
});

test('country-government hint does not promote another country or a spoofed host', () => {
  assert.equal(isCountryGovernmentSource('https://gta.gov.qa/en/news/example', 'QA'), true);
  assert.equal(isCountryGovernmentSource('https://www.gov.uk/government/news/qatar', 'QA'), false);
  assert.equal(isCountryGovernmentSource('https://gta.gov.qa.evil.example/news', 'QA'), false);
  assert.equal(isCountryGovernmentSource('https://www.gov.uk/government/news/example', 'GB'), true);
  assert.equal(isCountryGovernmentSource('https://www.canada.ca/en/news.html', 'CA'), true);
  assert.equal(isCountryGovernmentSource('https://www.federalregister.gov/documents/x', 'US'), true);
  assert.equal(isCountryGovernmentSource('https://u.ae/en/information-and-services/finance-and-investment/customs-duty', 'AE'), true);
  assert.equal(isCountryGovernmentSource('https://u.ae.example.test/customs', 'AE'), false);
});

test('isOfficialSource matches on the parsed host, not a substring', () => {
  assert.equal(isOfficialSource('https://www.federalregister.gov/documents/x'), true);
  assert.equal(isOfficialSource('https://www.gov.uk/guidance/x'), true);
  // A lookalike host that merely contains an official suffix must not pass.
  assert.equal(isOfficialSource('https://www.gov.uk.example.com/x'), false);
  assert.equal(isOfficialSource('https://blog.example.com/gov.uk'), false);
  assert.equal(isOfficialSource('not a url'), false);
});

test('Qatar government domain is recognized without accepting lookalikes', () => {
  assert.equal(isOfficialSource('https://gta.gov.qa/en/media-center/news/example'), true);
  assert.equal(isOfficialSource('https://gta.gov.qa.evil.example/news'), false);
});

test('countOfficial counts only the official ones', () => {
  assert.equal(countOfficial([
    'https://www.federalregister.gov/a',
    'https://example.com/b',
    'https://www.canada.ca/c',
  ]), 2);
  assert.equal(countOfficial([]), 0);
});

test('officialFirst lifts a recognized official-domain citation above commentary', () => {
  // The ordering seen on a live production run: an industry association and
  // a law firm's blog came back ahead of the Federal Register notice both
  // were describing.
  const asReturned = [
    'https://www.autocare.org/government-relations/current-issues/tariffs-and-trade/section-301-china-tariffs',
    'https://www.shapiro.com/tariffs/tariff-news',
    'https://www.federalregister.gov/documents/2018/08/16/2018-17709/notice-of-action',
  ];
  assert.deepEqual(officialFirst(asReturned), [
    'https://www.federalregister.gov/documents/2018/08/16/2018-17709/notice-of-action',
    'https://www.autocare.org/government-relations/current-issues/tariffs-and-trade/section-301-china-tariffs',
    'https://www.shapiro.com/tariffs/tariff-news',
  ]);
});

test('officialFirst is stable within each group and drops nothing', () => {
  const urls = [
    'https://a.example.com/1',
    'https://www.gov.uk/x',
    'https://b.example.com/2',
    'https://www.canada.ca/y',
  ];
  const out = officialFirst(urls);
  assert.equal(out.length, urls.length);
  assert.deepEqual(new Set(out), new Set(urls));
  assert.deepEqual(out, [
    'https://www.gov.uk/x',
    'https://www.canada.ca/y',
    'https://a.example.com/1',
    'https://b.example.com/2',
  ]);
});

test('officialFirst leaves an all-official or all-open list untouched', () => {
  const allOpen = ['https://a.example.com/1', 'https://b.example.com/2'];
  assert.deepEqual(officialFirst(allOpen), allOpen);
  const allOfficial = ['https://www.gov.uk/a', 'https://www.canada.ca/b'];
  assert.deepEqual(officialFirst(allOfficial), allOfficial);
});


test('new-country government domains are recognized without accepting lookalikes', () => {
  for (const host of ['www.seco.admin.ch', 'www.admin.ch', 'www.miti.gov.my', 'www.beehive.govt.nz']) {
    assert.equal(isOfficialSource('https://' + host + '/policy'), true, host);
    assert.equal(isOfficialSource('https://' + host + '.example.com/policy'), false, host);
    assert.equal(isOfficialSource('https://example.com/' + host), false, host);
    assert.equal(isOfficialSource('https://' + host + '@example.com/policy'), false, host);
  }
  assert.deepEqual(officialFirst(['https://commentary.example/1', 'https://www.seco.admin.ch/a', 'https://www.beehive.govt.nz/b']), ['https://www.seco.admin.ch/a', 'https://www.beehive.govt.nz/b', 'https://commentary.example/1']);
});
test('Hong Kong and Norwegian official source hosts exclude lookalikes and path mentions',()=>{
 for(const url of ['https://www.info.gov.hk/gia/general/example.htm','https://www.regjeringen.no/en/whats-new/example/','https://www.skatteetaten.no/rettskilder/']) assert.equal(isOfficialSource(url),true);
 for(const url of ['https://gov.hk.evil.example/article','https://regjeringen.no.evil.example/article','https://skatteetaten.no.evil.example/article','https://evil.example/regjeringen.no','https://info.gov.hk@evil.example/article']) assert.equal(isOfficialSource(url),false);
});
test('Slovenian government source is official only on the real host',()=>{
 assert.equal(isOfficialSource('https://www.gov.si/en/news/2026-10-09-example/'),true);
 assert.equal(isOfficialSource('https://gov.si.evil.example/en/news/example/'),false);
 assert.equal(isOfficialSource('https://evil.example/gov.si/en/news/example/'),false);
});
test('Irish issuer pages are official only on their own hosts',()=>{
 for(const host of ['www.irishimmigration.ie','www.gov.ie']){
  assert.equal(isOfficialSource(`https://${host}/en/news/`),true);
  assert.equal(isOfficialSource(`https://${host}.evil.example/news/`),false);
  assert.equal(isOfficialSource(`https://evil.example/${host}/news/`),false);
 }
});
test('Spanish gazette and ministry hosts exclude lookalikes',()=>{
 for(const host of ['www.boe.es','www.inclusion.gob.es']){
  assert.equal(isOfficialSource(`https://${host}/policy`),true);
  assert.equal(isOfficialSource(`https://${host}.evil.example/policy`),false);
  assert.equal(isOfficialSource(`https://evil.example/${host}/policy`),false);
 }
});
