import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAIM_MAX_LENGTH, policyClaim, truncateClaim } from '../claim-text';

test('truncateClaim leaves a short claim alone, bar surrounding whitespace', () => {
  assert.equal(truncateClaim('  Canada raised the CRS cutoff.  '), 'Canada raised the CRS cutoff.');
});

test('truncateClaim leaves a claim of exactly the maximum length alone', () => {
  const exact = 'a'.repeat(CLAIM_MAX_LENGTH);
  assert.equal(truncateClaim(exact), exact);
});

test('truncateClaim cuts an over-long claim on a word boundary', () => {
  const claim = `${'word '.repeat(200)}tail`;
  const out = truncateClaim(claim);
  assert.ok(out.length <= CLAIM_MAX_LENGTH, `got ${out.length}`);
  // A boundary cut, so the result must not end mid-word.
  assert.ok(!out.endsWith('wor'), out.slice(-10));
  assert.ok(out.endsWith('word'), out.slice(-10));
});

test('truncateClaim hard-cuts a long run with no spaces to split on', () => {
  // The API accepts length <= CLAIM_MAX_LENGTH, so the hard cut must land on
  // the limit itself and not one character past it.
  const out = truncateClaim('x'.repeat(CLAIM_MAX_LENGTH + 120));
  assert.equal(out.length, CLAIM_MAX_LENGTH);
});

test('truncateClaim is idempotent', () => {
  // Both policyClaim and VerifyClaimLink apply it, so the second pass over an
  // already-truncated claim must not shorten it again.
  const claim = `${'word '.repeat(200)}tail`;
  const once = truncateClaim(claim);
  assert.equal(truncateClaim(once), once);
});

test('policyClaim pairs the country, title and description', () => {
  assert.equal(
    policyClaim('Canada', 'Express Entry', 'Raised the CRS cutoff above 500 in 2026.'),
    'Canada — Express Entry: Raised the CRS cutoff above 500 in 2026.',
  );
});

test('policyClaim falls back to country and title when there is no description', () => {
  for (const empty of [undefined, null, '', '   ']) {
    assert.equal(policyClaim('Canada', 'Express Entry', empty), 'Canada — Express Entry');
  }
});

test('policyClaim respects the length limit the API enforces', () => {
  const out = policyClaim('Canada', 'Express Entry', 'detail '.repeat(300));
  assert.ok(out.length <= CLAIM_MAX_LENGTH, `got ${out.length}`);
});
