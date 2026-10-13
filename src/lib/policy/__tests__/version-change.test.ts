import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collapseUnchanged,
  diffWords,
  hasContentChange,
  DIFF_TOKEN_CAP,
} from '../version-change';

const v = (summary: string, numericValues: unknown = null, policyType: string | null = null) =>
  ({ summary, numericValues, policyType });

test('re-wrapped text is not a change', () => {
  assert.equal(hasContentChange(v('Tariff  set\nat 25%'), v('Tariff set at 25%')), false);
});

test('changed numbers are a change even when the prose is identical', () => {
  const before = v('Tariff set.', { tariff_rate: 10 });
  const after = v('Tariff set.', { tariff_rate: 25 });
  assert.equal(hasContentChange(before, after), true);
});

test('empty, null and absent numeric values are the same absence', () => {
  assert.equal(hasContentChange(v('x', null), v('x', {})), false);
  assert.equal(hasContentChange(v('x', undefined), v('x', null)), false);
});

test('policy type changing is a change', () => {
  assert.equal(hasContentChange(v('x', null, 'proposal'), v('x', null, 'regulation')), true);
});

test('a run of identical versions collapses to one entry', () => {
  // The shape found in production: "Immigration and citizenship Website"
  // carried 102 versions whose summaries were identical to each other.
  const rows = Array.from({ length: 102 }, () => v('news/press index changed.'));
  const groups = collapseUnchanged(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].checks, 102);
  assert.equal(groups[0].firstIndex, 0);
});

test('grouping is by content, not by neighbour', () => {
  // v102 = v101 = v100, then a different v99. Comparing neighbours would
  // mark v100 as a change because it differs from v99, and emit it next to
  // v102 even though the two are identical.
  const rows = [v('A'), v('A'), v('A'), v('B')];
  const groups = collapseUnchanged(rows);
  assert.deepEqual(groups.map((g) => [g.version.summary, g.checks, g.firstIndex]), [
    ['A', 3, 0],
    ['B', 1, 3],
  ]);
});

test('alternating content does not collapse', () => {
  const groups = collapseUnchanged([v('A'), v('B'), v('A')]);
  assert.deepEqual(groups.map((g) => [g.version.summary, g.checks]), [['A', 1], ['B', 1], ['A', 1]]);
});

test('an empty history collapses to nothing', () => {
  assert.deepEqual(collapseUnchanged([]), []);
});

test('diffWords marks only what moved', () => {
  const parts = diffWords('Tariff set at 10 percent', 'Tariff set at 25 percent');
  assert.deepEqual(parts, [
    { type: 'same', text: 'Tariff set at' },
    { type: 'removed', text: '10' },
    { type: 'added', text: '25' },
    { type: 'same', text: 'percent' },
  ]);
});

test('diffWords handles insertion, deletion and an empty side', () => {
  assert.deepEqual(diffWords('a c', 'a b c'), [
    { type: 'same', text: 'a' },
    { type: 'added', text: 'b' },
    { type: 'same', text: 'c' },
  ]);
  assert.deepEqual(diffWords('a b c', 'a c'), [
    { type: 'same', text: 'a' },
    { type: 'removed', text: 'b' },
    { type: 'same', text: 'c' },
  ]);
  assert.deepEqual(diffWords('', 'new text'), [{ type: 'added', text: 'new text' }]);
  assert.deepEqual(diffWords('old text', ''), [{ type: 'removed', text: 'old text' }]);
  assert.deepEqual(diffWords('', ''), []);
});

test('identical text yields one unbroken same run', () => {
  assert.deepEqual(diffWords('same words here', 'same  words here'), [
    { type: 'same', text: 'same words here' },
  ]);
});

test('diffWords reconstructs both sides exactly', () => {
  const before = 'The rate rises from ten to twenty five percent on 1 January';
  const after = 'The rate rises from ten to thirty percent on 1 February';
  const parts = diffWords(before, after);
  const rebuild = (skip: 'added' | 'removed') =>
    parts.filter((p) => p.type !== skip).map((p) => p.text).join(' ');
  assert.equal(rebuild('added'), before);
  assert.equal(rebuild('removed'), after);
});

test('diffWords caps pathological input instead of hanging', () => {
  const long = Array.from({ length: DIFF_TOKEN_CAP * 3 }, (_, i) => `w${i}`).join(' ');
  const parts = diffWords(long, `${long} tail`);
  const words = parts.reduce((n, p) => n + p.text.split(' ').length, 0);
  assert.ok(words <= DIFF_TOKEN_CAP * 2, `expected the cap to bound output, got ${words}`);
});
