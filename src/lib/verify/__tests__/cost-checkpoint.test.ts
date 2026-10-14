import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredCheckpointRequired, historicalCostFromCheckpoint, observedUsdToMicro, prepareCostCheckpoint, type CostAnchorRow } from '../cost-checkpoint';
import { checkpointReviewSql } from '../checkpoint-review-sql';
import { summarizeBudgetLedger } from '../budget-audit';
import { availabilityFromSnapshot } from '../availability';
const cap = 4_980_000, reservation = 1_500_000;
const before = new Date('2026-10-13T18:00:00.000Z'), now = new Date('2026-10-14T18:00:00.000Z');
const observation = { costUsd: '3.25', asOf: '2026-10-14T17:00:00.000Z', periodStart: '2026-10-01T00:00:00.000Z' };
const row = (id: string, amount: number, createdAt = before): CostAnchorRow => ({ id, createdAt,
  newValue: { microUsd: amount, capMicroUsd: cap, state: 'settled' } });
const rows = [row('anchor-a', 100_000), row('anchor-b', 110_000)];
const checkpoint = () => prepareCostCheckpoint(rows, cap, reservation, observation, now);

test('exact decimal observation rounds upward without floating point or truncation', () => {
  assert.equal(observedUsdToMicro('3.25000001'), 3_250_001);
  assert.equal(observedUsdToMicro('3.25'), 3_250_000);
  assert.equal(observedUsdToMicro('0.00000001'), 1);
  for (const value of ['-1', '1e3', 'NaN', 'Infinity', '', ' 3.25', '1.0000000000001']) assert.throws(() => observedUsdToMicro(value));
});
test('checkpoint retains the same call rows/cap and adds observed historical cost once', () => {
  const original = structuredClone(rows);
  const c = checkpoint();
  assert.equal(c.historicalCostMicroUsd, 3_040_000);
  assert.equal(historicalCostFromCheckpoint(rows, [c], cap, reservation, now), 3_040_000);
  const report = summarizeBudgetLedger(rows.map(r => r.newValue), cap, reservation, c.historicalCostMicroUsd);
  assert.equal(report.accountedMicroUsd, 210_000, 'call accounting is not rewritten');
  assert.equal(report.combinedMicroUsd, 3_250_000);
  assert.equal(report.remainingMicroUsd, 1_730_000);
  assert.deepEqual(rows, original);
});
test('future settled calls and retained failed reservations consume the same remaining ceiling', () => {
  const c = checkpoint();
  const future = row('new-call', 240_000, new Date('2026-10-14T18:00:00.000Z'));
  const all = [...rows, future];
  const historical = historicalCostFromCheckpoint(all, [c], cap, reservation, now);
  assert.equal(summarizeBudgetLedger(all.map(r => r.newValue), cap, reservation, historical).nextReservationFits, false);
  const held = { microUsd: reservation, capMicroUsd: cap, state: 'reserved' };
  const report = summarizeBudgetLedger([...rows.map(r => r.newValue), held], cap, reservation, historical);
  assert.equal(report.combinedMicroUsd, 4_750_000);
  assert.equal(report.unsettledReservations, 1);
  assert.equal(report.nextReservationFits, false, 'posting delay cannot release a possibly billed reservation');
});
test('provider observations below conservative call accounting never refund headroom', () => {
  const c = prepareCostCheckpoint(rows, cap, reservation, { ...observation, costUsd: '0.10' }, now);
  assert.equal(c.historicalCostMicroUsd, 0);
  assert.equal(summarizeBudgetLedger(rows.map(r => r.newValue), cap, reservation, c.historicalCostMicroUsd).combinedMicroUsd, 210_000);
});
test('no checkpoint preserves existing admission; an empty/deleted anchor cannot recover funds', () => {
  assert.equal(historicalCostFromCheckpoint(rows, [], cap, reservation, now), 0);
  assert.throws(() => historicalCostFromCheckpoint([], [checkpoint()], cap, reservation, now));
  assert.throws(() => prepareCostCheckpoint([], cap, reservation, observation, now));
});
test('changed, missing, backdated or unsettled historical call rows fail closed', () => {
  for (const changed of [[rows[0]], [row('anchor-a', 99_999), rows[1]],
    [...rows, row('backdated', 1)], [{ ...rows[0], newValue: { microUsd: reservation, capMicroUsd: cap, state: 'reserved' } }, rows[1]]]) {
    assert.throws(() => historicalCostFromCheckpoint(changed, [checkpoint()], cap, reservation, now));
  }
});
test('duplicates, altered cost/cap/hash/version and malformed checkpoints stop admission', () => {
  const c = checkpoint();
  assert.throws(() => historicalCostFromCheckpoint(rows, [c, c], cap, reservation, now));
  for (const value of [null, {}, { ...c, historicalCostMicroUsd: 0 }, { ...c, anchorHash: '0'.repeat(64) },
    { ...c, version: 2 }, { ...c, capMicroUsd: cap + 1 }, { ...c, providerCostMicroUsd: '3.25' }]) {
    assert.throws(() => historicalCostFromCheckpoint(rows, [value], cap, reservation, now));
  }
});
test('statement window must cover anchors and cannot claim a future observation', () => {
  for (const patch of [{ asOf: '2026-10-12T00:00:00.000Z' }, { asOf: '2026-10-15T00:00:00.000Z' },
    { periodStart: '2026-10-14T00:00:00.000Z' }, { asOf: '2026-10-14' }]) {
    assert.throws(() => prepareCostCheckpoint(rows, cap, reservation, { ...observation, ...patch }, now));
  }
});
test('pre-run availability includes the checkpoint without exposing its amounts or hash', () => {
  const result = availabilityFromSnapshot({ now, runCap: 12, assertionCap: 12, runDates: [], assertionDates: [],
    budget: { capMicroUsd: cap, reservationMicroUsd: reservation, expiresAt: now.getTime() + 60_000,
      rows: rows.map(r => r.newValue), historicalCostMicroUsd: 3_300_000 } });
  assert.equal(result.status, 'budget_limit');
  assert.deepEqual(Object.keys(result).sort(), ['budgetExpiresAt', 'checkedAt', 'status']);
});
test('review SQL is guarded append-only data, not a ledger reset or a provider call', () => {
  const sql = checkpointReviewSql('same-campaign', checkpoint());
  assert.match(sql, /SERIALIZABLE/); assert.match(sql, /ledger changed after preview/);
  assert.match(sql, /INSERT INTO audit_logs/); assert.match(sql, /model_cost_checkpoint/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|TRUNCATE)\s+audit_logs/i);
  assert.throws(() => checkpointReviewSql("bad'campaign", checkpoint()));
});


test('required checkpoint deletion or mistyped activation never restores original spending room', () => {
  assert.throws(() => historicalCostFromCheckpoint(rows, [], cap, reservation, now, true));
  assert.equal(historicalCostFromCheckpoint(rows, [checkpoint()], cap, reservation, now, false), 3_040_000, 'disabling the requirement cannot ignore a stored checkpoint');
  const before = process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED;
  try {
    process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED = 'mistyped';
    assert.throws(configuredCheckpointRequired);
    process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED = '1';
    assert.equal(configuredCheckpointRequired(), true);
    delete process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED;
    assert.equal(configuredCheckpointRequired(), false);
  } finally {
    if (before === undefined) delete process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED; else process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED = before;
  }
});
