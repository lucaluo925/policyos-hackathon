import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { getPrisma } from '../../src/lib/db/client';
import { reserveSharedVerificationRun, VerificationRunQuotaExceeded } from '../../src/lib/verify/admission';
import { reserveSharedCountryResearch, CountryResearchQuotaExceeded } from '../../src/lib/research/quota';
import { requireDisposableDatabase } from './disposable-database';

// This test writes reservations. Only an explicitly disposable, empty local
// CI database is accepted; it never deletes existing rows or calls providers.
requireDisposableDatabase();

const exec = promisify(execFile);
async function burst(mode: 'verify' | 'research', time: string) {
  // Independent processes have independent Prisma pools, as separate hosted
  // instances do. A shared in-memory counter cannot make this test pass.
  return Promise.all(Array.from({ length: 8 }, async () => {
    const { stdout } = await exec(process.execPath,
      ['--import', 'tsx', 'tests/integration/quota-worker.ts', mode, time],
      { timeout: 60_000 });
    const result = stdout.match(/^QUOTA_RESULT:(admitted|denied|conflict)$/m)?.[1];
    assert.ok(result, 'worker must report an explicit admission outcome');
    return result;
  }));
}

test('real PostgreSQL enforces verifier and research caps across processes', { timeout: 120_000 }, async t => {
  const db = getPrisma();
  try {
    assert.equal(await db.auditLog.count(), 0, 'requires a fresh database; refuses to alter existing audit data');
    const now = new Date();
    const since = new Date(now.getTime() - 86_400_000);
    const verifyWhere = { entityType: 'claim_verification', actionType: 'verify_run_reserved' };
    await db.auditLog.create({ data: {
      ...verifyWhere, entityId: 'expired-test-reservation',
      createdAt: new Date(since.getTime() - 60_000),
    } });
    const verifier = await burst('verify', now.toISOString());
    const admitted = verifier.filter(outcome => outcome === 'admitted').length;
    assert.ok(admitted >= 1 && admitted <= 3, 'at least one succeeds; concurrent requests never exceed cap 3');
    assert.equal(await db.auditLog.count({ where: { ...verifyWhere, createdAt: { gte: since } } }), admitted);
    // Refill any slots rejected by bounded serialization retries. Completed
    // audit rows are deliberately absent: even unfinished attempts consume cap.
    for (let i = admitted; i < 3; i++) await reserveSharedVerificationRun(now, 3);
    await assert.rejects(reserveSharedVerificationRun(now, 3), VerificationRunQuotaExceeded);
    assert.equal(await db.auditLog.count({ where: verifyWhere }), 4, 'three current plus one expired; denial writes nothing');
    assert.equal(await db.auditLog.count({ where: { actionType: 'claim_verified' } }), 0);

    const day = now.toISOString().slice(0, 10);
    const researchWhere = { entityType: 'country_research', entityId: day, actionType: 'tavily_search_reserved' };
    await db.auditLog.createMany({ data: Array.from({ length: 59 }, () => ({ ...researchWhere })) });
    const research = await burst('research', day);
    assert.equal(research.filter(outcome => outcome === 'admitted').length, 1, 'only one remaining research slot can be consumed');
    await assert.rejects(reserveSharedCountryResearch(day, 'must not reserve'), CountryResearchQuotaExceeded);
    assert.equal(await db.auditLog.count({ where: researchWhere }), 60);
    t.diagnostic(JSON.stringify({ verifier, research, paidProviderCalls: 0 }));
  } finally {
    await db.$disconnect();
  }
});
