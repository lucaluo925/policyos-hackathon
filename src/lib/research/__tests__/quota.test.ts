import assert from 'node:assert/strict';
import test from 'node:test';
import { CountryResearchQuotaExceeded, reserveSharedCountryResearch } from '../quota';

test('shared reservation retries a serialization conflict, then counts one call', async () => {
  let attempts = 0;
  let reservations = 0;
  await reserveSharedCountryResearch('2026-10-12', 'QA:trade', async work => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('serialization conflict'), { code: 'P2034' });
    await work({ count: async () => 59, reserve: async () => { reservations++; } });
  });
  assert.equal(attempts, 2);
  assert.equal(reservations, 1);
});

test('shared cap rejects before recording another paid call', async () => {
  let reservations = 0;
  await assert.rejects(
    reserveSharedCountryResearch('2026-10-12', 'QA:trade', async work => {
      await work({ count: async () => 60, reserve: async () => { reservations++; } });
    }),
    CountryResearchQuotaExceeded,
  );
  assert.equal(reservations, 0);
});
