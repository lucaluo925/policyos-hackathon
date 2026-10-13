import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEEP_PHASE_BUDGET_MS, MIN_FETCH_MS, makeDeepBudget } from '../helpers/deep-budget';

/** Controllable clock, so the tests do not sleep. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('a fresh budget allows a fetch and offers the preferred timeout', () => {
  const c = fakeClock();
  const b = makeDeepBudget(35_000, c.now);
  assert.equal(b.allows(), true);
  assert.equal(b.timeoutFor(15_000), 15_000);
  assert.equal(b.remaining(), 35_000);
  assert.equal(b.elapsed(), 0);
});

test('the timeout is capped by what is left, not by what was asked for', () => {
  const c = fakeClock();
  const b = makeDeepBudget(35_000, c.now);
  c.advance(27_000);
  assert.equal(b.remaining(), 8_000);
  assert.equal(b.timeoutFor(15_000), 8_000);
});

test('an exhausted budget allows nothing and never goes negative', () => {
  const c = fakeClock();
  const b = makeDeepBudget(35_000, c.now);
  c.advance(40_000);
  assert.equal(b.remaining(), 0);
  assert.equal(b.allows(), false);
  assert.equal(b.timeoutFor(15_000), 0);
});

test('a fetch is not started on a scrap of budget', () => {
  const c = fakeClock();
  const b = makeDeepBudget(35_000, c.now);
  c.advance(35_000 - (MIN_FETCH_MS - 1));
  assert.equal(b.allows(), false, 'just under the minimum must not start');
  assert.equal(b.allows(1), true, 'an explicit smaller minimum still may');
});

test('exactly the minimum left is allowed', () => {
  const c = fakeClock();
  const b = makeDeepBudget(35_000, c.now);
  c.advance(35_000 - MIN_FETCH_MS);
  assert.equal(b.allows(), true);
});

test("uk-climate's eight items cannot outrun the budget", () => {
  // 8 x 15s = 120s of fetching against maxDuration 60. With the budget the
  // phase stops instead of the function being killed.
  const c = fakeClock();
  const b = makeDeepBudget(DEEP_PHASE_BUDGET_MS, c.now);
  let fetched = 0;
  for (let i = 0; i < 8; i++) {
    if (!b.allows()) break;
    const t = b.timeoutFor(15_000);
    fetched++;
    c.advance(t); // worst case: every fetch uses its whole timeout
  }
  assert.ok(fetched < 8, `expected the phase to stop early, fetched ${fetched}`);
  assert.ok(b.elapsed() <= DEEP_PHASE_BUDGET_MS, `elapsed ${b.elapsed()} exceeded the budget`);
});

test('fast fetches still get through all the items', () => {
  const c = fakeClock();
  const b = makeDeepBudget(DEEP_PHASE_BUDGET_MS, c.now);
  let fetched = 0;
  for (let i = 0; i < 8; i++) {
    if (!b.allows()) break;
    b.timeoutFor(15_000);
    fetched++;
    c.advance(900); // a healthy source
  }
  assert.equal(fetched, 8);
});

test('the default budget leaves room under a 60s function limit', () => {
  assert.ok(DEEP_PHASE_BUDGET_MS < 60_000);
  assert.ok(60_000 - DEEP_PHASE_BUDGET_MS >= 20_000);
});
