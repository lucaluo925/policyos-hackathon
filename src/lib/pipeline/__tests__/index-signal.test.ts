import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunSummary, indexSignalUnchanged, materialChange } from '../index-signal';

/* ── indexSignalUnchanged ─────────────────────────────────────────────── */

test('identical extracted text is unchanged', () => {
  assert.equal(indexSignalUnchanged('Immigration Rules index. HC 1234.', 'Immigration Rules index. HC 1234.'), true);
});

test('whitespace and rewrapping are not a change', () => {
  assert.equal(indexSignalUnchanged('Immigration Rules index.\n  HC 1234.', 'Immigration Rules index. HC 1234.'), true);
});

test('different text is a change', () => {
  assert.equal(indexSignalUnchanged('HC 1234.', 'HC 1234. HC 1235.'), false);
});

test('no previous version is not sameness', () => {
  assert.equal(indexSignalUnchanged(null, 'HC 1234.'), false);
  assert.equal(indexSignalUnchanged(undefined, 'HC 1234.'), false);
  assert.equal(indexSignalUnchanged('', 'HC 1234.'), false);
});

test('an empty extraction is evidence of nothing, not of sameness', () => {
  // Two runs that both extract nothing must not thereby claim the page is
  // verified unchanged.
  assert.equal(indexSignalUnchanged('', ''), false);
  assert.equal(indexSignalUnchanged('   \n  ', '  '), false);
  assert.equal(indexSignalUnchanged('HC 1234.', ''), false);
});

/* ── materialChange ──────────────────────────────────────────────────── */

const inp = (o: Partial<Parameters<typeof materialChange>[0]>) =>
  materialChange({ indexSignalMoved: false, deepItemsWritten: 0, deepItemsPlanned: 0, deepItemsUnchanged: 0, ...o });

test('a moved index signal is a change', () => {
  assert.deepEqual(inp({ indexSignalMoved: true }), { changed: true });
});

test('a written deep item is a change even when the index signal held', () => {
  assert.deepEqual(inp({ deepItemsWritten: 1, deepItemsPlanned: 12, deepItemsUnchanged: 11 }), { changed: true });
});

test('every item unchanged and the signal identical is no change', () => {
  assert.deepEqual(inp({ deepItemsPlanned: 12, deepItemsUnchanged: 12 }), {
    changed: false,
    reason: 'items_all_unchanged',
  });
});

test('items that merely failed leave the run reporting a change', () => {
  // A failure is not evidence of sameness. 5 recognised, 7 lost: we do not
  // know, so we must not claim nothing moved.
  assert.deepEqual(inp({ deepItemsPlanned: 12, deepItemsUnchanged: 5 }), { changed: true });
  assert.deepEqual(inp({ deepItemsPlanned: 12, deepItemsUnchanged: 0 }), { changed: true });
});

test('no deep hook and an identical signal is no change -- the uk-immigration case', () => {
  assert.deepEqual(inp({}), { changed: false, reason: 'signal_identical' });
});

test('no deep hook and a moved signal is a change', () => {
  assert.deepEqual(inp({ indexSignalMoved: true }), { changed: true });
});

/* ── buildRunSummary ─────────────────────────────────────────────────── */

test('a changed run keeps the classifier wording plus the counts', () => {
  const out = buildRunSummary({
    verdict: { changed: true },
    classifierSummary: 'USCIS — Policy Manual Updates (deep): enacted policy text changed.',
    deepItemsWritten: 3,
    deepItemsUnchanged: 9,
    degraded: false,
  });
  assert.match(out, /enacted policy text changed\./);
  assert.match(out, /\(3 changed, 9 unchanged\)/);
});

test('a degraded run says so', () => {
  const out = buildRunSummary({
    verdict: { changed: true },
    classifierSummary: 'x',
    deepItemsWritten: 1,
    deepItemsUnchanged: 0,
    degraded: true,
  });
  assert.match(out, /, degraded\)$/);
});

test('all items unchanged does not repeat the classifier claim', () => {
  const out = buildRunSummary({
    verdict: { changed: false, reason: 'items_all_unchanged' },
    classifierSummary: 'enacted policy text changed.',
    deepItemsWritten: 0,
    deepItemsUnchanged: 12,
    degraded: false,
  });
  assert.equal(out, 'Page changed; all 12 listed items unchanged since last check.');
  assert.doesNotMatch(out, /enacted/);
});

test('the two no-change cases stay distinguishable', () => {
  const items = buildRunSummary({
    verdict: { changed: false, reason: 'items_all_unchanged' },
    classifierSummary: 'x', deepItemsWritten: 0, deepItemsUnchanged: 12, degraded: false,
  });
  const signal = buildRunSummary({
    verdict: { changed: false, reason: 'signal_identical' },
    classifierSummary: 'x', deepItemsWritten: 0, deepItemsUnchanged: 0, degraded: false,
  });
  assert.notEqual(items, signal);
  assert.doesNotMatch(signal, /listed items/);
});

test('the uk-immigration case no longer claims guidance was updated', () => {
  const out = buildRunSummary({
    verdict: { changed: false, reason: 'signal_identical' },
    classifierSummary: 'GOV.UK — Immigration Rules: operational guidance updated.',
    deepItemsWritten: 0,
    deepItemsUnchanged: 0,
    degraded: false,
  });
  assert.doesNotMatch(out, /operational guidance updated/);
  assert.equal(out, 'Page bytes changed; extracted content identical to last check.');
});
