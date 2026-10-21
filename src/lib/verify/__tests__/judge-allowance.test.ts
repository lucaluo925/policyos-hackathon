import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredJudgeRunCap, JudgeRunAllowanceExhausted, reserveJudgeVerificationRun } from '../admission';
import { availabilityFromSnapshot, verificationAccessFailure, type AvailabilitySnapshot } from '../availability';
import { readSharedVerificationAvailability } from '../availability-server';
import type { PrismaClient } from '@prisma/client';

const now = new Date('2026-12-01T18:00:00Z');
const expiry = Date.parse('2026-12-15T20:00:00Z');
const row = (microUsd: number, state = 'settled') => ({ microUsd, state, capMicroUsd: 4_980_000 });
const recent = (n: number) => Array.from({ length: n }, (_, i) => new Date(now.getTime() - (i + 1) * 60_000));
function snapshot(patch: Partial<AvailabilitySnapshot> = {}): AvailabilitySnapshot {
  return { now, runCap: 12, assertionCap: 12, runDates: [], assertionDates: [],
    budget: { capMicroUsd: 4_980_000, expiresAt: expiry, reservationMicroUsd: 1_500_000, rows: [row(220_504)] }, ...patch };
}

test('a judge session is not stopped by the public rolling 24-hour caps', () => {
  const full = snapshot({ runDates: recent(12), assertionDates: recent(12) });
  assert.equal(availabilityFromSnapshot(full).status, 'daily_limit', 'public visitor at the daily cap');
  assert.equal(availabilityFromSnapshot({ ...full, judge: { used: 40, cap: 300 } }).status, 'available');
});

test('the judge campaign allowance is a fixed ceiling with no rolling reset or retry time', () => {
  const status = availabilityFromSnapshot(snapshot({ judge: { used: 300, cap: 300 } }));
  assert.equal(status.status, 'judge_limit');
  assert.equal(status.retryAt, undefined);
  const failure = verificationAccessFailure(status)!;
  assert.equal(failure.httpStatus, 503);
  assert.equal(failure.retryAfterSeconds, undefined);
});

test('model budget and expiry still stop a judge session first', () => {
  const budget = snapshot().budget!;
  const spent = { ...budget, rows: Array.from({ length: 3 }, () => row(1_500_000, 'reserved')) };
  assert.equal(availabilityFromSnapshot(snapshot({ budget: spent, judge: { used: 0, cap: 300 } })).status, 'budget_limit');
  assert.equal(availabilityFromSnapshot(snapshot({ now: new Date(expiry), judge: { used: 0, cap: 300 } })).status, 'expired');
});

test('invalid judge allowance numbers fail closed', () => {
  for (const judge of [{ used: -1, cap: 300 }, { used: 0, cap: 0 }, { used: NaN, cap: 300 }]) {
    assert.equal(availabilityFromSnapshot(snapshot({ judge })).status, 'unavailable');
  }
});

test('judge reservation counts the whole campaign and refuses at the cap without reserving', async () => {
  let reserved = 0;
  await reserveJudgeVerificationRun('campaign-1', 300, async work => {
    await work({ count: async () => 299, reserve: async () => { reserved++; } });
  });
  assert.equal(reserved, 1);
  await assert.rejects(reserveJudgeVerificationRun('campaign-1', 300, async work => {
    await work({ count: async () => 300, reserve: async () => { reserved++; } });
  }), JudgeRunAllowanceExhausted);
  assert.equal(reserved, 1);
});

test('judge reservation retries serialization conflicts and propagates database failure', async () => {
  let attempts = 0;
  await reserveJudgeVerificationRun('campaign-1', 300, async work => {
    if (++attempts === 1) throw Object.assign(new Error('write conflict'), { code: 'P2034' });
    await work({ count: async () => 0, reserve: async () => {} });
  });
  assert.equal(attempts, 2);
  await assert.rejects(reserveJudgeVerificationRun('campaign-1', 300, async () => {
    throw new Error('database unavailable');
  }), /database unavailable/);
  await assert.rejects(reserveJudgeVerificationRun('bad id!', 300, async () => {}), /Invalid judge allowance campaign/);
});

test('the judge cap has no default and rejects out-of-range values', () => {
  const previous = process.env.VERIFY_JUDGE_RUN_CAP;
  try {
    for (const value of [undefined, '', '0', '-1', 'abc', '1.5', '1001']) {
      if (value === undefined) delete process.env.VERIFY_JUDGE_RUN_CAP;
      else process.env.VERIFY_JUDGE_RUN_CAP = value;
      assert.throws(configuredJudgeRunCap, /VERIFY_JUDGE_RUN_CAP/);
    }
    process.env.VERIFY_JUDGE_RUN_CAP = '300';
    assert.equal(configuredJudgeRunCap(), 300);
  } finally {
    if (previous === undefined) delete process.env.VERIFY_JUDGE_RUN_CAP;
    else process.env.VERIFY_JUDGE_RUN_CAP = previous;
  }
});

test('a judge availability read without a budget campaign is refused', async () => {
  const client = { $transaction: async () => { throw new Error('should not read'); } } as unknown as PrismaClient;
  await assert.rejects(readSharedVerificationAvailability(client, 12, 12, undefined, 300), /needs a model budget campaign/);
});

test('a judge availability read counts campaign reservations and skips public rolling rows', async () => {
  const where: unknown[] = [];
  let used = 7;
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ now }],
    auditLog: {
      findMany: async (args: { where: { actionType: string } }) => {
        where.push(args.where.actionType);
        return args.where.actionType === 'model_call_reserved'
          ? [{ id: 'r1', createdAt: new Date(now.getTime() - 60_000), newValue: row(220_504) }] : [];
      },
      count: async (args: { where: unknown }) => { where.push(args.where); return used; },
    },
  };
  const client = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient;
  const prev = process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED;
  process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED = '0';
  try {
    const status = await readSharedVerificationAvailability(client, 12, 12, { id: 'campaign-1', capMicroUsd: 4_980_000, expiresAt: expiry }, 300);
    assert.ok(!where.includes('verify_run_reserved') && !where.includes('claim_verified'), 'public rolling rows are not read');
    assert.deepEqual(where.find(w => typeof w === 'object'), { entityType: 'claim_verification_judge', entityId: 'campaign-1', actionType: 'verify_run_reserved_judge' });
    assert.equal(status.status, 'available');
    used = 120;
    assert.equal((await readSharedVerificationAvailability(client, 12, 12, { id: 'campaign-1', capMicroUsd: 4_980_000, expiresAt: expiry }, 120)).status, 'judge_limit');
  } finally {
    if (prev === undefined) delete process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED; else process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED = prev;
  }
});
