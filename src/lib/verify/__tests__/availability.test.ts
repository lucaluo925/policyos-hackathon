import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availabilityFromSnapshot, verificationAccessFailure, type AvailabilitySnapshot } from '../availability';
import { readSharedVerificationAvailability } from '../availability-server';
import type { PrismaClient } from '@prisma/client';

const now = new Date('2026-10-14T18:00:00Z');
const expiry = Date.parse('2026-12-15T20:00:00Z');
const row = (microUsd: number, state = 'settled') => ({ microUsd, state, capMicroUsd: 4_980_000 });
function snapshot(patch: Partial<AvailabilitySnapshot> = {}): AvailabilitySnapshot {
  return { now, runCap: 12, assertionCap: 12, runDates: [], assertionDates: [],
    budget: { capMicroUsd: 4_980_000, expiresAt: expiry, reservationMicroUsd: 1_500_000, rows: [row(220_504)] }, ...patch };
}

test('availability discloses status/time only, never financial counters or ledger rows', () => {
  const original = snapshot();
  const before = structuredClone(original);
  const status = availabilityFromSnapshot(original);
  assert.deepEqual(status, { status: 'available', checkedAt: now.toISOString(), budgetExpiresAt: new Date(expiry).toISOString() });
  assert.deepEqual(original, before);
  assert.equal(verificationAccessFailure(status), null);
});

test('retained failed-call reservations can stop a new call despite a positive balance', () => {
  const budget = snapshot().budget!;
  const status = availabilityFromSnapshot(snapshot({ budget: { ...budget, rows: Array.from({ length: 3 }, () => row(1_500_000, 'reserved')) } }));
  assert.equal(status.status, 'budget_limit');
  assert.equal(status.retryAt, undefined, 'a rolling-day reset does not replenish model money');
  const failure = verificationAccessFailure(status)!;
  assert.equal(failure.httpStatus, 503);
  assert.equal(failure.retryAfterSeconds, undefined);
});

test('a budget at its authorized expiry is closed without a renewal or refund', () => {
  const status = availabilityFromSnapshot(snapshot({ now: new Date(expiry) }));
  assert.equal(status.status, 'expired');
  assert.equal(status.retryAt, undefined);
});

for (const [label, rows] of [
  ['empty', []], ['malformed', [null]], ['wrong cap', [{ ...row(10), capMicroUsd: 5_000_000 }]],
  ['invalid state', [row(10, 'lost')]], ['incorrect held amount', [row(10, 'reserved')]],
] as Array<[string, unknown[]]>) {
  test(`${label} ledger does not masquerade as fresh available funding`, () => {
    assert.equal(availabilityFromSnapshot(snapshot({ budget: { ...snapshot().budget!, rows } })).status, 'unavailable');
  });
}

test('the last cap-count timestamps determine the rolling retry even after overshoot', () => {
  const runDates = Array.from({ length: 14 }, (_, i) => new Date(now.getTime() - (i + 1) * 60_000)).reverse();
  const status = availabilityFromSnapshot(snapshot({ runDates }));
  assert.equal(status.status, 'daily_limit');
  assert.equal(status.retryAt, new Date(now.getTime() - 12 * 60_000 + 86_400_000 + 1).toISOString());
  const failure = verificationAccessFailure(status)!;
  assert.equal(failure.httpStatus, 429);
  assert.equal(failure.retryAfterSeconds, 85_681);
});

test('both run and assertion constraints must have a slot before the proposed retry', () => {
  const runDates = Array.from({ length: 12 }, () => new Date(now.getTime() - 60_000));
  const assertionDates = Array.from({ length: 12 }, () => new Date(now.getTime() - 30_000));
  const status = availabilityFromSnapshot(snapshot({ runDates, assertionDates }));
  assert.equal(status.retryAt, new Date(now.getTime() - 30_000 + 86_400_000 + 1).toISOString());
});

test('a slot after the authorized access deadline is never advertised as a retry', () => {
  const runDates = Array.from({ length: 12 }, () => now);
  const status = availabilityFromSnapshot(snapshot({ runDates,
    budget: { ...snapshot().budget!, expiresAt: now.getTime() + 60_000 },
  }));
  assert.equal(status.status, 'daily_limit');
  assert.equal(status.retryAt, undefined);
  assert.equal(verificationAccessFailure(status)!.retryAfterSeconds, undefined);
});

test('the inclusive 24-hour boundary remains full, then expires without changing records', () => {
  const oldest = new Date(now.getTime() - 86_400_000);
  const runDates = Array.from({ length: 12 }, () => oldest);
  assert.equal(availabilityFromSnapshot(snapshot({ runDates })).status, 'daily_limit');
  assert.equal(availabilityFromSnapshot(snapshot({ now: new Date(now.getTime() + 1), runDates })).status, 'available');
});

test('unknown quota configuration or timestamps fail closed', () => {
  for (const patch of [{ runCap: 0 }, { assertionCap: NaN }, { runDates: [new Date('invalid')] },
    { assertionDates: [new Date(now.getTime() + 1)] }]) {
    assert.equal(availabilityFromSnapshot(snapshot(patch)).status, 'unavailable');
  }
});

test('database read failure propagates; the server wrapper must not grant admission', async () => {
  // No real credentials, providers, database connection or reservations.
  const client = { $transaction: async () => { throw new Error('database read failed'); } } as unknown as PrismaClient;
  await assert.rejects(readSharedVerificationAvailability(client, 12, 12), /database read failed/);
  const failure = verificationAccessFailure({ status: 'unavailable', checkedAt: now.toISOString() })!;
  assert.equal(failure.httpStatus, 503);
  assert.match(failure.error, /No live run was admitted/);
});
