import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunStateBadge } from '@/components/RunStateBadge';
import { ABANDONED_AFTER_MS, type RunLike } from '../run-outcome';

/**
 * This component was put into three call sites on /admin without the page
 * ever being seen: /admin sits behind the proxy matcher, and authenticating
 * to production to look at it is not something to do from here. So render it
 * directly instead, over every state the enum and the derivation can produce.
 *
 * createElement rather than JSX because the test glob is *.test.ts.
 */

const DONE = new Date('2026-10-11T03:00:00Z');
const run = (over: Partial<RunLike> = {}): RunLike => ({
  status: 'success',
  startedAt: new Date('2026-10-11T02:59:00Z'),
  completedAt: DONE,
  ...over,
});

const TONES = ['bg-green-500/15', 'bg-blue-500/15', 'bg-yellow-500/15', 'bg-red-500/15'];

function render(r: RunLike, size?: 'xs' | 'sm'): string {
  return renderToStaticMarkup(createElement(RunStateBadge, { run: r, size }));
}

const CASES: Array<[string, RunLike, string]> = [
  ['success', run({ status: 'success' }), 'success'],
  ['partial_success', run({ status: 'partial_success' }), 'partial'],
  ['partial (completed)', run({ status: 'partial' }), 'partial'],
  ['failed', run({ status: 'failed' }), 'failed'],
  ['skipped', run({ status: 'skipped' }), 'skipped'],
  ['running', run({ status: 'partial', completedAt: null, startedAt: new Date(Date.now() - 1_000) }), 'running'],
  ['abandoned', run({ status: 'partial', completedAt: null, startedAt: new Date(Date.now() - ABANDONED_AFTER_MS - 1_000) }), 'did not finish'],
];

for (const [name, r, expectedLabel] of CASES) {
  test(`renders ${name}`, () => {
    const html = render(r);
    assert.ok(html.length > 0, 'rendered nothing');
    assert.ok(html.includes(expectedLabel), `expected label "${expectedLabel}" in: ${html}`);
    const tones = TONES.filter((c) => html.includes(c));
    assert.equal(tones.length, 1, `expected exactly one tone class, got ${JSON.stringify(tones)}`);
    assert.ok(!html.includes('undefined'), `"undefined" leaked into the markup: ${html}`);
  });
}

test('a killed run never renders as "partial"', () => {
  // The whole point: /admin used to print startRun's placeholder in amber.
  const html = render(run({ status: 'partial', completedAt: null, startedAt: new Date(Date.now() - ABANDONED_AFTER_MS - 1) }));
  assert.ok(html.includes('did not finish'));
  assert.ok(!html.includes('>partial<'));
  assert.ok(html.includes('bg-red-500/15'), 'a killed run must not be amber');
});

test('both sizes render and differ only in padding', () => {
  const xs = render(run(), 'xs');
  const sm = render(run(), 'sm');
  assert.ok(xs.includes('text-[10px]'));
  assert.ok(sm.includes('text-xs'));
  assert.notEqual(xs, sm);
});

test('a status outside the enum still renders without crashing', () => {
  // Defensive: the column is an enum, but a hand-written row or a future
  // migration should not take the admin page down.
  const html = render(run({ status: 'something_new' }));
  assert.ok(html.length > 0);
  assert.ok(!html.includes('undefined'), html);
});
