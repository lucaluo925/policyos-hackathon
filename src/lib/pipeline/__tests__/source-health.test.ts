import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceHealth, daysSince } from '../source-health';

const NOW = new Date('2026-10-10T18:00:00Z');

test('a source that has never succeeded says so, however recently it was tried', () => {
  // The real KR row: 170 attempts, every one HTTP 404, lastSuccessAt null,
  // and lastCheckedAt stamped today — which is what the page was showing.
  const h = sourceHealth({ lastSuccessAt: null, consecutiveFails: 170 }, NOW);
  assert.equal(h.state, 'never_succeeded');
  assert.match(h.label ?? '', /Never fetched successfully/);
  assert.match(h.label ?? '', /170/);
  assert.equal(h.daysSinceSuccess, null);
});

test('a long-dead source reports how long it has been dead', () => {
  // The real CA row: last success 173 days ago, 58 consecutive failures.
  const h = sourceHealth(
    { lastSuccessAt: new Date('2026-04-20T18:00:00Z'), consecutiveFails: 58 },
    NOW,
  );
  assert.equal(h.state, 'failing');
  assert.equal(h.daysSinceSuccess, 173);
  assert.match(h.label ?? '', /173 days ago/);
});

test('a working source warns about nothing', () => {
  const h = sourceHealth({ lastSuccessAt: NOW, consecutiveFails: 0 }, NOW);
  assert.equal(h.state, 'healthy');
  assert.equal(h.label, null);
});

test('one or two missed checks are not worth a warning', () => {
  // Sites rate-limit and time out; the daily schedule already means the
  // data can be a day old without anything being wrong.
  const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  assert.equal(sourceHealth({ lastSuccessAt: yesterday, consecutiveFails: 1 }, NOW).state, 'healthy');
  assert.equal(sourceHealth({ lastSuccessAt: yesterday, consecutiveFails: 2 }, NOW).state, 'healthy');
  assert.equal(sourceHealth({ lastSuccessAt: yesterday, consecutiveFails: 3 }, NOW).state, 'failing');
});

test('a stale success is a warning even with no run of failures recorded', () => {
  const old = new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000);
  assert.equal(sourceHealth({ lastSuccessAt: old, consecutiveFails: 0 }, NOW).state, 'failing');
});

test('daysSince tolerates missing and unparseable values', () => {
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince('not a date', NOW), null);
  assert.equal(daysSince('2026-10-10T00:00:00Z', NOW), 0);
});
