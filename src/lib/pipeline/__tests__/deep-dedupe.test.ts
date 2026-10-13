import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepItemHash, deepRunDegraded } from '../helpers/deep-dedupe';
import type { DeepItem } from '../framework';

const base: DeepItem = {
  url: 'https://www.uscis.gov/policy-manual/updates/20260410',
  title: 'Policy Manual Update: Chapter 3',
  summary: 'Clarifies evidence requirements for employment-based petitions.',
  extractedText: 'USCIS is updating Chapter 3 to clarify evidence requirements.',
  policyType: 'guidance',
  guidanceType: 'operational_guidance',
  effectiveDate: '2026-04-10',
  numericValues: { fee_usd: 2805, days: 15 },
};

test('same content hashes identically across runs', () => {
  assert.equal(deepItemHash(base), deepItemHash({ ...base }));
});

test('whitespace and reflow are not a content change', () => {
  const reflowed: DeepItem = {
    ...base,
    title: '  Policy Manual Update:\n  Chapter 3 ',
    extractedText: 'USCIS is updating Chapter 3\tto clarify   evidence requirements.',
  };
  assert.equal(deepItemHash(reflowed), deepItemHash(base));
});

test('numericValues key order does not change the hash', () => {
  const reordered: DeepItem = { ...base, numericValues: { days: 15, fee_usd: 2805 } };
  assert.equal(deepItemHash(reordered), deepItemHash(base));
});

test('a changed number is a content change', () => {
  const moved: DeepItem = { ...base, numericValues: { fee_usd: 2905, days: 15 } };
  assert.notEqual(deepItemHash(moved), deepItemHash(base));
});

test('changed body text is a content change', () => {
  const moved: DeepItem = { ...base, extractedText: `${base.extractedText} Effective immediately.` };
  assert.notEqual(deepItemHash(moved), deepItemHash(base));
});

test('a retyped item is a content change', () => {
  assert.notEqual(deepItemHash({ ...base, policyType: 'regulation' }), deepItemHash(base));
  assert.notEqual(deepItemHash({ ...base, guidanceType: 'legal_announcement' }), deepItemHash(base));
});

test('two different items on the same page do not collide', () => {
  const other: DeepItem = { ...base, url: `${base.url}-b`, title: 'Policy Manual Update: Chapter 4' };
  assert.notEqual(deepItemHash(other), deepItemHash(base));
});

test('absent optional fields are stable, not random', () => {
  const sparse: DeepItem = { url: base.url, title: base.title };
  assert.equal(deepItemHash(sparse), deepItemHash({ url: base.url, title: base.title }));
  assert.notEqual(deepItemHash(sparse), deepItemHash(base));
});

test('field values cannot be shifted across the boundary', () => {
  // Without a separator, {title:"ab", summary:"c"} and {title:"a", summary:"bc"}
  // would hash the same. They must not.
  const a: DeepItem = { url: 'u', title: 'ab', summary: 'c' };
  const b: DeepItem = { url: 'u', title: 'a', summary: 'bc' };
  assert.notEqual(deepItemHash(a), deepItemHash(b));
});

test('hash is a sha256 hex digest', () => {
  assert.match(deepItemHash(base), /^[0-9a-f]{64}$/);
});

/* ── deepRunDegraded ──────────────────────────────────────────────────── */

const acct = (itemsPlanned: number, itemsUnchanged: number, hookFailed = false) =>
  ({ itemsPlanned, itemsUnchanged, hookFailed });

test('a failed hook is degraded whatever the counts say', () => {
  assert.equal(deepRunDegraded(acct(0, 0, true), 0), true);
  assert.equal(deepRunDegraded(acct(12, 12, true), 12), true);
});

test('a pipeline with no deep hook is not degraded', () => {
  assert.equal(deepRunDegraded(acct(0, 0), 0), false);
});

test('every item written is not degraded', () => {
  assert.equal(deepRunDegraded(acct(12, 0), 12), false);
});

test('every item recognised as unchanged is NOT degraded', () => {
  // The whole point of the content-keyed dedup: the index page moved, none of
  // the 12 listed items did. Under the old predicate (written === 0) this
  // healthy run was reported as partial_success.
  assert.equal(deepRunDegraded(acct(12, 12), 0), false);
});

test('nothing accounted for is degraded', () => {
  assert.equal(deepRunDegraded(acct(12, 0), 0), true);
});

test('some written, the rest errored, IS degraded', () => {
  // Behaviour change, deliberately: the old predicate called this success
  // because the written count was above zero, over a run that lost 7 items.
  assert.equal(deepRunDegraded(acct(12, 0), 5), true);
});

test('a mix of written and unchanged that covers every item is not degraded', () => {
  assert.equal(deepRunDegraded(acct(12, 7), 5), false);
});

test('partial recognition with the rest errored is degraded', () => {
  assert.equal(deepRunDegraded(acct(12, 5), 0), true);
});
