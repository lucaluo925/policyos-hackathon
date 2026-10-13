import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSchedule } from '../review-schedule';

const NOW = new Date('2026-10-10T12:00:00Z').getTime();

test('a future date is still scheduled', () => {
  const r = reviewSchedule('2026-10-20T12:00:00Z', NOW);
  assert.equal(r.state, 'scheduled');
  if (r.state === 'scheduled') {
    assert.equal(r.date, '2026-10-20');
    assert.equal(r.days, 10);
  }
});

test("the fixture's own dates are overdue, which is the case that prompted this", () => {
  // Verbatim from production on 2026-10-10.
  for (const [date, expected] of [
    ['2026-04-19T12:00:00Z', 174],
    ['2026-02-18T12:00:00Z', 234],
    ['2026-03-20T12:00:00Z', 204],
  ] as const) {
    const r = reviewSchedule(date, NOW);
    assert.equal(r.state, 'overdue', date);
    if (r.state === 'overdue') assert.equal(r.days, expected, date);
  }
});

test('today counts as still scheduled, not overdue', () => {
  const r = reviewSchedule(new Date(NOW).toISOString(), NOW);
  assert.equal(r.state, 'scheduled');
  if (r.state === 'scheduled') assert.equal(r.days, 0);
});

test('one millisecond past is overdue, with zero whole days', () => {
  const r = reviewSchedule(new Date(NOW - 1).toISOString(), NOW);
  assert.equal(r.state, 'overdue');
  if (r.state === 'overdue') assert.equal(r.days, 0);
});

test('the date is reported in both states, so a caller can always show it', () => {
  const a = reviewSchedule('2026-10-20T12:00:00Z', NOW);
  const b = reviewSchedule('2026-04-19T12:00:00Z', NOW);
  assert.ok('date' in a && a.date === '2026-10-20');
  assert.ok('date' in b && b.date === '2026-04-19');
});

test('missing or unparseable input is unknown, not overdue', () => {
  for (const bad of [null, undefined, '', 'not a date']) {
    assert.equal(reviewSchedule(bad, NOW).state, 'unknown', String(bad));
  }
});
