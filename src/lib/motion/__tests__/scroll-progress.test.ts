import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revealProgress } from '../scroll-progress';

const VH = 800;
const H = 450;

test('nothing is revealed while the element is below the fold', () => {
  assert.equal(revealProgress(VH, H, VH), 0);
  assert.equal(revealProgress(VH * 0.85, H, VH), 0);
});

test('progress never decreases as the element rises', () => {
  const seq = [VH, 600, 400, 200, 0, -200, -400, -600].map((top) =>
    revealProgress(top, H, VH),
  );
  seq.forEach((value, i) => {
    if (i > 0) assert.ok(value >= seq[i - 1], `dropped at index ${i}: ${JSON.stringify(seq)}`);
  });
});

test('progress actually reaches 1 rather than approaching it', () => {
  // The failure this guards against: a curve that asymptotes leaves the last
  // words of every paragraph grey no matter how far the reader scrolls.
  assert.equal(revealProgress(-H, H, VH), 1);
  assert.equal(revealProgress(-1200, H, VH), 1);
});

test('most of a paragraph is lit by the time it reaches the top of the screen', () => {
  assert.ok(revealProgress(0, H, VH) > 0.5);
});

test('a taller paragraph lights more slowly at the same scroll position', () => {
  assert.ok(revealProgress(200, 900, VH) < revealProgress(200, 200, VH));
});

test('degenerate geometry does not produce NaN', () => {
  assert.ok(Number.isFinite(revealProgress(0, 0, 0)));
  assert.ok(Number.isFinite(revealProgress(0, 0, 1)));
});
