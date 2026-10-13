import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getFreshnessLabel, getLastVerifiedAt } from '../store';

/**
 * The curated dataset is laid out around 2026-04-17: us-c1 is seeded as
 * verified 3 days before it, us-c2 as 18 days before.
 */
const SNAPSHOT = new Date('2026-04-17T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

test('judged at the snapshot date, the seeded gradations hold', () => {
  assert.equal(getFreshnessLabel('us-c1', SNAPSHOT), 'verified');
  assert.equal(getFreshnessLabel('us-c2', SNAPSHOT), 'pending_verification');
});

test('the label goes stale as real time passes — the whole point', () => {
  // This is what the frozen clock prevented: on 2026-10-10 the page was
  // still calling a 176-day-old verification "verified".
  const later = SNAPSHOT + 176 * DAY;
  assert.equal(getFreshnessLabel('us-c1', later), 'potentially_stale');
  assert.equal(getFreshnessLabel('us-c2', later), 'potentially_stale');
});

test('each band is entered at its boundary', () => {
  assert.equal(getFreshnessLabel('us-c1', SNAPSHOT + 5 * DAY), 'recently_reviewed');
  assert.equal(getFreshnessLabel('us-c1', SNAPSHOT + 12 * DAY), 'pending_verification');
  assert.equal(getFreshnessLabel('us-c1', SNAPSHOT + 28 * DAY), 'potentially_stale');
});

test('an unknown policy is unknown rather than fresh', () => {
  assert.equal(getFreshnessLabel('no-such-policy', SNAPSHOT), 'unknown');
  assert.equal(getLastVerifiedAt('no-such-policy'), null);
});

test('the verification date is exposed so a page can state it', () => {
  const at = getLastVerifiedAt('us-c1');
  assert.ok(at, 'expected a date for us-c1');
  assert.equal(at.slice(0, 10), '2026-04-14');
});

test('the default clock is the real one, not the fixture reference date', () => {
  // Guards the regression directly: if NOW creeps back in as the default,
  // us-c1 reads "verified" forever.
  assert.notEqual(getFreshnessLabel('us-c1'), 'verified');
});
