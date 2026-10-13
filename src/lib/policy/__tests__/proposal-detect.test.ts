import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeProposal } from '../proposal-detect';

/* ── The false positives that prompted this ──────────────────────────── */

test('a saved form draft is not a draft policy', () => {
  // Verbatim shape of USCIS-PM B.6 Chapter 6, which the old bare-keyword
  // version typed as `proposal`.
  const t =
    'Users may also create draft benefit requests in their online account. ' +
    'A user can continue adding information to his or her draft before ' +
    'electronically filing the request with USCIS. Draft filings are generally ' +
    'saved in the user’s online account for 30 days.';
  assert.equal(looksLikeProposal(t), false);
});

test('immigration prose about proposed employment is not a proposal', () => {
  for (const t of [
    'The petitioner must establish that the proposed employment meets the requirements.',
    'Evidence concerning the proposed beneficiary and the proposed endeavor.',
    'The officer reviews the proposed itinerary submitted with the petition.',
  ]) {
    assert.equal(looksLikeProposal(t), false, t);
  }
});

test('an incidental "draft" elsewhere does not flip the type', () => {
  assert.equal(looksLikeProposal('Attach a draft letter and a draft translation.'), false);
  assert.equal(looksLikeProposal('The applicant was subject to the military draft.'), false);
});

/* ── What must still be caught ───────────────────────────────────────── */

test('US rulemaking terms of art are proposals', () => {
  for (const t of [
    'DHS published a Notice of Proposed Rulemaking in the Federal Register.',
    'This NPRM would amend 8 CFR 214.',
    'USCIS issued a proposed rule on fee adjustments.',
    'The proposed regulations would take effect next year.',
  ]) {
    assert.equal(looksLikeProposal(t), true, t);
  }
});

test("the EU's own wording is a proposal", () => {
  for (const t of [
    'Proposal for a Regulation of the European Parliament and of the Council',
    'Proposal for a Directive on corporate sustainability due diligence',
    'The Commission tabled a legislative proposal on deforestation.',
  ]) {
    assert.equal(looksLikeProposal(t), true, t);
  }
});

test('consultation vocabulary means not yet in force', () => {
  for (const t of [
    'The department has launched a public consultation.',
    'Consultation on the draft framework closes in March.',
    'The measure is open for comment until 30 June.',
    'Request for comments on the proposed fee schedule.',
    'Call for evidence on hydrogen blending.',
  ]) {
    assert.equal(looksLikeProposal(t), true, t);
  }
});

test('green and white papers, and introduced bills', () => {
  assert.equal(looksLikeProposal('The government published a Green Paper on migration.'), true);
  assert.equal(looksLikeProposal('A bill was introduced in the Bundestag.'), true);
});

test('German-style draft wording in English coverage still matches', () => {
  assert.equal(looksLikeProposal('The cabinet approved a draft law on heating.'), true);
  assert.equal(looksLikeProposal('A draft guidance document was circulated.'), true);
});

/* ── Shape ───────────────────────────────────────────────────────────── */

test('empty and whitespace input is not a proposal', () => {
  assert.equal(looksLikeProposal(''), false);
  assert.equal(looksLikeProposal('   '), false);
});

test('matching is case-insensitive', () => {
  assert.equal(looksLikeProposal('PROPOSED RULE'), true);
  assert.equal(looksLikeProposal('notice of PROPOSED rulemaking'), true);
});
