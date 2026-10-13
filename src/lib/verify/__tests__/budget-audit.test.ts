import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeBudgetLedger } from '../budget-audit';

const cap = 4_980_000;
const reservation = 1_500_000;
const settled = (microUsd: number) => ({ microUsd, capMicroUsd: cap, state: 'settled' });

test('audit retains failed-call reservations and does not mistake residual dollars for admission', () => {
  const rows = [settled(220_504), ...Array.from({ length: 3 }, () => ({
    microUsd: reservation, capMicroUsd: cap, state: 'reserved',
  }))];
  const original = JSON.stringify(rows);
  const report = summarizeBudgetLedger(rows, cap, reservation);
  assert.equal(report.accountedMicroUsd, 4_720_504);
  assert.equal(report.remainingMicroUsd, 259_496);
  assert.equal(report.unsettledReservations, 3);
  assert.equal(report.nextReservationFits, false);
  assert.equal(JSON.stringify(rows), original);
});

test('empty campaign is unknown rather than a fresh spending allowance', () => {
  const report = summarizeBudgetLedger([], cap, reservation);
  assert.equal(report.status, 'needs_review');
  assert.equal(report.accountedMicroUsd, null);
  assert.equal(report.nextReservationFits, null);
});

test('malformed or mismatched ledger rows prevent a reassuring partial total', () => {
  for (const bad of [null, {}, settled(-1), settled(0.5), settled(reservation + 1),
    { ...settled(10), capMicroUsd: 5_000_000 }, { ...settled(10), state: 'reserved' },
    { ...settled(10), state: 'refunded' }, { ...settled(10), microUsd: '10' }]) {
    const report = summarizeBudgetLedger([settled(220_504), bad], cap, reservation);
    assert.equal(report.invalidRows, 1);
    assert.equal(report.remainingMicroUsd, null);
    assert.equal(report.nextReservationFits, null);
  }
});

test('exact reservation boundary and over-cap totals are distinct', () => {
  const rows = [settled(1_500_000), settled(1_500_000), settled(480_000)];
  assert.equal(summarizeBudgetLedger(rows, cap, reservation).nextReservationFits, true);
  const over = summarizeBudgetLedger([...rows, settled(1_500_000), settled(1)], cap, reservation);
  assert.equal(over.status, 'over_cap');
  assert.equal(over.remainingMicroUsd, 0);
  assert.equal(over.nextReservationFits, false);
});
