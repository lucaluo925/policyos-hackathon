import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredVerificationRunCap, reserveSharedVerificationRun, VerificationRunQuotaExceeded } from '../admission';

const now = new Date('2026-10-12T18:00:00.000Z');

test('a live run reserves before provider work using a rolling 24-hour window', async () => {
  let reserved = '';
  await reserveSharedVerificationRun(now, 12, async work => {
    await work({
      count: async since => {
        assert.equal(since.toISOString(), '2026-10-11T18:00:00.000Z');
        return 11;
      },
      reserve: async day => { reserved = day; },
    });
  });
  assert.equal(reserved, '2026-10-12');
});

test('the shared run cap denies a further attempt without reserving it', async () => {
  let reservations = 0;
  await assert.rejects(reserveSharedVerificationRun(now, 12, async work => {
    await work({ count: async () => 12, reserve: async () => { reservations++; } });
  }), VerificationRunQuotaExceeded);
  assert.equal(reservations, 0);
});

test('serialization conflicts retry, but a database outage does not bypass admission', async () => {
  let attempts = 0;
  await reserveSharedVerificationRun(now, 12, async work => {
    if (++attempts === 1) throw Object.assign(new Error('write conflict'), { code: 'P2034' });
    await work({ count: async () => 0, reserve: async () => {} });
  });
  assert.equal(attempts, 2);
  await assert.rejects(reserveSharedVerificationRun(now, 12, async () => {
    throw new Error('database unavailable');
  }), /database unavailable/);
});

test('an invalid configured cap fails closed', () => {
  const previous = process.env.VERIFY_DAILY_RUN_CAP;
  try {
    process.env.VERIFY_DAILY_RUN_CAP = '0';
    assert.throws(configuredVerificationRunCap, /positive integer/);
    process.env.VERIFY_DAILY_RUN_CAP = 'abc';
    assert.throws(configuredVerificationRunCap, /positive integer/);
  } finally {
    if (previous === undefined) delete process.env.VERIFY_DAILY_RUN_CAP;
    else process.env.VERIFY_DAILY_RUN_CAP = previous;
  }
});
