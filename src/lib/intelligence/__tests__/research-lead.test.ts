import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeResearchLead, readResearchLead, bindResearchLead, researchLeadForReport } from '../research-lead';
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
