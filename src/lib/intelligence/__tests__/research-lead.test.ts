import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeResearchLead, readResearchLead, bindResearchLead, researchLeadForReport, verificationHref, linkedResearchLead } from '../research-lead';
import { truncateClaim } from '../../verify/claim-text';
const now = Date.parse('2026-10-12T00:00:00Z');
const selected = { claim: 'Policy headline', sourceUrl: 'https://example.org/article' };
test('only a current lead matching the entry headline is consumed', () => {
  const lead = makeResearchLead(selected, now)!;
  assert.deepEqual(readResearchLead(JSON.stringify(lead), selected.claim, now), lead);
  assert.equal(readResearchLead(JSON.stringify(lead), 'An unrelated headline', now), null);
});
test('malformed, expired, future and legacy untimed context fail closed', () => {
  for (const raw of ['invalid', JSON.stringify(selected), JSON.stringify(makeResearchLead(selected, now - 25 * 3600000)), JSON.stringify(makeResearchLead(selected, now + 120000))]) {
    assert.equal(readResearchLead(raw, selected.claim, now), null);
  }
});
test('lead context rejects unsafe URLs and does not create source credentials', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'https://user:secret@example.org/article']) assert.equal(makeResearchLead({ ...selected, sourceUrl }, now), null);
});
test('run context is an immutable copy bound to the exact completed claim', () => {
  const lead = makeResearchLead(selected, now)!;
  const bound = bindResearchLead(lead, 'The precise claim', now)!;
  lead.sourceUrl = 'https://example.org/later';
  assert.equal(researchLeadForReport(bound, 'The precise claim')?.sourceUrl, selected.sourceUrl);
  assert.equal(researchLeadForReport(bound, 'Another completed claim'), null);
  assert.equal(bindResearchLead(lead, ' ', now), null);
});

test('copied or new-tab verification links retain the source without browser storage', () => {
  const sourceUrl = 'https://example.gov/doc?id=42&name=政策#exceptions';
  const url = new URL(verificationHref('Policy & effective date?', sourceUrl), 'https://policyos.example');
  const lead = linkedResearchLead(url.searchParams.get('claim')!, url.searchParams.get('source'), now)!;
  assert.equal(lead.claim, 'Policy & effective date?');
  assert.equal(lead.sourceUrl, new URL(sourceUrl).href);
  assert.equal(lead.selectedAt, new Date(now).toISOString());
  const bound = bindResearchLead(lead, 'A precise edited claim', now)!;
  assert.equal(researchLeadForReport(bound, 'A precise edited claim')?.sourceUrl, lead.sourceUrl);
  assert.equal(researchLeadForReport(bound, 'Unrelated report'), null);
});

test('unsafe or missing link sources are explicit and cannot inherit stale stored context', () => {
  for (const source of [undefined, null, '', 'javascript:alert(1)', 'https://user:password@example.org/', 'x'.repeat(2049)]) {
    const url = new URL(verificationHref(selected.claim, source), 'https://policyos.example');
    assert.equal(url.searchParams.has('source'), true);
    assert.equal(url.searchParams.get('source'), '');
    assert.equal(linkedResearchLead(selected.claim, url.searchParams.get('source'), now), null);
  }
});

test('link prefill and its source context use the same bounded claim', () => {
  const headline = 'This is a long official announcement title '.repeat(30);
  const url = new URL(verificationHref(headline, selected.sourceUrl), 'https://policyos.example');
  assert.equal(url.searchParams.get('claim'), truncateClaim(headline));
  assert.equal(linkedResearchLead(headline, selected.sourceUrl, now)?.claim, url.searchParams.get('claim'));
});
