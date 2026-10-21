import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COST_CHECKPOINT_ACTION } from '../../src/lib/verify/cost-checkpoint';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { getPrisma } from '../../src/lib/db/client';
import { JUDGE_RUN_ACTION, JUDGE_RUN_ENTITY, JudgeRunAllowanceExhausted, reserveJudgeVerificationRun, reserveSharedVerificationRun, VerificationRunQuotaExceeded } from '../../src/lib/verify/admission';
import { reserveSharedCountryResearch, CountryResearchQuotaExceeded } from '../../src/lib/research/quota';
import { requireDisposableDatabase } from './disposable-database';
import { sharedModelBudgetStore, ModelBudgetStopped, MODEL_BUDGET_ENTITY } from '../../src/lib/verify/spend';
import { readSharedVerificationAvailability } from '../../src/lib/verify/availability-server';
import { POST as verifyPost } from '../../src/app/api/verify/route';
import { POST as researchPost } from '../../src/app/api/explore/research/route';
import { createJudgeSession, JUDGE_COOKIE } from '../../src/lib/auth/judge';
import { GET as availabilityGet } from '../../src/app/api/verify/availability/route';

// This test writes reservations. Only an explicitly disposable, empty local
// CI database is accepted; it never deletes existing rows or calls providers.
requireDisposableDatabase();

const exec = promisify(execFile);
async function burst(mode: 'verify' | 'research' | 'budget' | 'checkpoint-budget', time: string) {
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
    const modelBudget = { id: 'ci-shared-budget', capMicroUsd: 4_980_000, expiresAt: Date.now() + 300_000 };
    const modelBurst = await burst('budget', day);
    const budgetWhere = { entityType: MODEL_BUDGET_ENTITY, entityId: modelBudget.id };
    const reservations = await db.auditLog.findMany({ where: budgetWhere });
    assert.ok(reservations.length >= 1 && reservations.length <= 3);
    for (let i = reservations.length; i < 3; i++) await sharedModelBudgetStore.reserve(modelBudget);
    await assert.rejects(sharedModelBudgetStore.reserve(modelBudget), ModelBudgetStopped);
    await sharedModelBudgetStore.settle(reservations[0].id, 5867);
    await assert.rejects(sharedModelBudgetStore.settle(reservations[0].id, 0), ModelBudgetStopped, 'cannot refund a settled call twice');
    await sharedModelBudgetStore.reserve(modelBudget);
    await assert.rejects(sharedModelBudgetStore.reserve(modelBudget), ModelBudgetStopped);
    const ledger = await db.auditLog.findMany({ where: budgetWhere });
    assert.equal(ledger.reduce((sum, row) => sum + (row.newValue as { microUsd: number }).microUsd, 0), 4_505_867);
    await assert.rejects(sharedModelBudgetStore.reserve({ ...modelBudget, capMicroUsd: 50_000_000 }), ModelBudgetStopped, 'changing the cap cannot silently reset an existing campaign');
    const beforeAudit = await db.auditLog.findMany({ orderBy: { id: 'asc' } });
    const audit = await exec(process.execPath, ['--import', 'tsx', 'scripts/verify-budget-audit.ts'], {
      timeout: 30_000,
      env: { ...process.env,
        VERIFY_MODEL_BUDGET_ID: modelBudget.id, VERIFY_MODEL_BUDGET_USD: '4.98',
        VERIFY_MODEL_BUDGET_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(),
        VERIFY_DAILY_RUN_CAP: '12', VERIFY_DAILY_ASSERTION_CAP: '12', NEXT_PUBLIC_STATIC_DEMO_MODE: '0',
      },
    }).then(result => ({ ...result, code: 0 }), (error: { stdout: string; stderr: string; code: number }) => error);
    assert.equal(audit.code, 2, 'positive remaining balance cannot cover another full reservation');
    assert.equal(audit.stderr, '');
    const auditReport = JSON.parse(audit.stdout);
    assert.equal(auditReport.ledger.accountedMicroUsd, 4_505_867);
    assert.equal(auditReport.ledger.unsettledReservations, 3);
    assert.equal(auditReport.ledger.nextReservationFits, false);
    assert.equal(auditReport.rolling24Hours.runs, 3);
    assert.equal(auditReport.rolling24Hours.assertions, 0);
    assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), beforeAudit,
      'operator audit must not alter any ledger, run or assertion rows');
    const availability = await readSharedVerificationAvailability(db, 12, 12, modelBudget);
    assert.equal(availability.status, 'budget_limit');
    assert.equal(availability.retryAt, undefined, 'funding does not reset daily');
    assert.deepEqual(Object.keys(availability).sort(), ['budgetExpiresAt', 'checkedAt', 'status']);
    assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), beforeAudit,
      'public availability check must not reserve, settle or alter ledger/quota rows');
    const settings: Record<string, string> = {
      NEBIUS_API_KEY: 'isolated-ci-only', TAVILY_API_KEY: 'isolated-ci-only',
      VERIFY_REQUIRE_SHARED_QUOTA: '1', NEXT_PUBLIC_STATIC_DEMO_MODE: '0',
      VERIFY_MODEL_BUDGET_ID: modelBudget.id, VERIFY_MODEL_BUDGET_USD: '4.98',
      VERIFY_MODEL_BUDGET_EXPIRES_AT: new Date(modelBudget.expiresAt).toISOString(),
      VERIFY_DAILY_RUN_CAP: '12', VERIFY_DAILY_ASSERTION_CAP: '12',
    };
    const prior = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
    const fetchBefore = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = async () => { networkCalls++; throw new Error('No provider calls permitted in isolated CI'); };
    try {
      Object.assign(process.env, settings);
      const statusResponse = await availabilityGet(new Request('http://localhost/api/verify/availability'));
      assert.equal(statusResponse.headers.get('Cache-Control'), 'no-store');
      assert.equal((await statusResponse.json()).status, 'budget_limit');
      const denied = await verifyPost(new Request('http://localhost/api/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: 'CI denied-capacity test' }),
      }));
      assert.equal(denied.status, 503);
      assert.equal((await denied.json()).code, 'budget_limit');
      assert.equal(denied.headers.get('Retry-After'), null);
      // Same original ledger/caps: judge auth is not an alternate funding bucket.
      process.env.VERIFY_JUDGE_ACCESS_ENABLED = '1';
      process.env.VERIFY_JUDGE_ACCESS_SECRET = 'disposable-ci-judge-code-at-least-32-characters';
      try {
        for (const post of [verifyPost, researchPost]) {
          const blocked = await post(new Request('http://localhost/api/test', { method: 'POST', body: '{}' }));
          assert.equal(blocked.status, 401);
        }
        assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), beforeAudit, 'anonymous judge denial writes no model, run or research quota rows');
        const session = createJudgeSession(process.env.VERIFY_JUDGE_ACCESS_SECRET)!;
        const judgeRequest = () => new Request('http://localhost/api/verify', {
          method: 'POST', headers: { cookie: `${JUDGE_COOKIE}=${session.value}`, origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: 'CI judge funding denial' }),
        });
        // Judge allowance has no default: a missing cap fails closed before any reservation.
        delete process.env.VERIFY_JUDGE_RUN_CAP;
        const unconfigured = await verifyPost(judgeRequest());
        assert.equal(unconfigured.status, 503);
        assert.equal((await unconfigured.json()).code, 'unavailable', 'missing judge allowance must fail closed');
        process.env.VERIFY_JUDGE_RUN_CAP = '120';
        const authenticated = await verifyPost(judgeRequest());
        assert.equal(authenticated.status, 503);
        assert.equal((await authenticated.json()).code, 'budget_limit', 'judge session cannot bypass the same budget');
      } finally {
        delete process.env.VERIFY_JUDGE_ACCESS_ENABLED; delete process.env.VERIFY_JUDGE_ACCESS_SECRET; delete process.env.VERIFY_JUDGE_RUN_CAP;
      }
      assert.equal(networkCalls, 0);
      assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), beforeAudit,
        'a known funding denial must not consume a run slot or model reservation');
    } finally {
      globalThis.fetch = fetchBefore;
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
    t.diagnostic(JSON.stringify({ verifier, research, modelBurst, paidProviderCalls: 0 }));
  } finally {
    await db.$disconnect();
  }
});


test('reviewed cost checkpoint is append-only and enforces the same cap across processes', { timeout: 120_000 }, async t => {
  const db = getPrisma();
  const directory = await mkdtemp(join(tmpdir(), 'policyos-cost-ci-'));
  const budget = { id: 'ci-checkpoint-budget', capMicroUsd: 4_980_000, expiresAt: Date.now() + 300_000 };
  const where = { entityType: MODEL_BUDGET_ENTITY, entityId: budget.id };
  const now = Date.now();
  try {
    await db.auditLog.createMany({ data: [100_000, 110_000].map((microUsd, i) => ({
      ...where, actionType: 'model_call_reserved', createdAt: new Date(now - (120 - i * 60) * 1000),
      newValue: { microUsd, capMicroUsd: budget.capMicroUsd, state: 'settled' },
    })) });
    const anchors = await db.auditLog.findMany({ where, orderBy: { id: 'asc' } });
    const beforePreview = await db.auditLog.findMany({ orderBy: { id: 'asc' } });
    const statement = join(directory, 'observation.json');
    await writeFile(statement, JSON.stringify({ costUsd: '3.25', asOf: new Date(now - 30_000).toISOString(), periodStart: new Date(now - 86400000).toISOString() }), { mode: 0o600 });
    const preview = await exec(process.execPath, ['--import', 'tsx', 'scripts/verify-cost-checkpoint-preview.ts', '--statement-file', statement], {
      env: { ...process.env, VERIFY_MODEL_BUDGET_ID: budget.id, VERIFY_MODEL_BUDGET_USD: '4.98', VERIFY_MODEL_BUDGET_EXPIRES_AT: new Date(budget.expiresAt).toISOString() }, timeout: 30_000,
    });
    assert.equal(preview.stderr, '');
    const packet = JSON.parse(preview.stdout);
    assert.equal(packet.kind, 'review-only-cost-checkpoint');
    assert.equal(packet.checkpoint.historicalCostMicroUsd, 3_040_000);
    assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), beforePreview, 'preview cannot write any ledger or quota row');
    const block = packet.reviewSql.match(/DO \$checkpoint\$[\s\S]+?\$checkpoint\$;/)?.[0];
    assert.ok(block, 'must produce a single reviewable append block');
    // Explicitly applying to a guarded disposable fixture only. Production
    // application is a separate owner-approved action, never preview behavior.
    await db.$transaction(tx => tx.$executeRawUnsafe(block), { isolationLevel: 'Serializable' });
    assert.equal(await db.auditLog.count({ where: { ...where, actionType: COST_CHECKPOINT_ACTION } }), 1);
    assert.deepEqual(await db.auditLog.findMany({ where: { id: { in: anchors.map(row => row.id) } }, orderBy: { id: 'asc' } }), anchors);
    await assert.rejects(db.$transaction(tx => tx.$executeRawUnsafe(block), { isolationLevel: 'Serializable' }), /checkpoint already exists/);
    const outcomes = await burst('checkpoint-budget', new Date(now).toISOString());
    assert.equal(outcomes.filter(value => value === 'admitted').length, 1, 'observed historical cost leaves room for one full model reservation');
    await assert.rejects(sharedModelBudgetStore.reserve(budget), ModelBudgetStopped);
    const callRows = await db.auditLog.findMany({ where: { ...where, actionType: 'model_call_reserved' } });
    assert.equal(callRows.length, 3, 'two settled anchors plus one retained call, no invented model entries');
    const held = callRows.find(row => !anchors.some(anchor => anchor.id === row.id))!;
    assert.equal((held.newValue as { microUsd: number }).microUsd, 1_500_000);
    const beforeDenied = await db.auditLog.findMany({ orderBy: { id: 'asc' } });
    const status = await readSharedVerificationAvailability(db, 12, 12, budget);
    assert.equal(status.status, 'budget_limit');
    assert.deepEqual(Object.keys(status).sort(), ['budgetExpiresAt', 'checkedAt', 'status'], 'no financial data in public status');
    assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), beforeDenied);
    assert.deepEqual(await db.auditLog.findMany({ where: { id: { in: anchors.map(row => row.id) } }, orderBy: { id: 'asc' } }), anchors, 'old settled rows remain intact after concurrent admission');
    const requiredBefore = process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED;
    try {
      process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED = '1';
      // Deletion is exclusively in this disposable test database to model an
      // old-backup restore; never delete a real campaign checkpoint.
      await db.auditLog.deleteMany({ where: { ...where, actionType: COST_CHECKPOINT_ACTION } });
      const afterSimulatedRestore = await db.auditLog.findMany({ orderBy: { id: 'asc' } });
      await assert.rejects(sharedModelBudgetStore.reserve(budget), ModelBudgetStopped);
      await assert.rejects(readSharedVerificationAvailability(db, 12, 12, budget), /Required cost checkpoint is missing/);
      assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), afterSimulatedRestore, 'missing required checkpoint cannot reserve or reset the ledger');
    } finally {
      if (requiredBefore === undefined) delete process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED; else process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED = requiredBefore;
    }
    t.diagnostic(JSON.stringify({ outcomes, providerCalls: 0, originalAnchorRowsUnchanged: true }));
  } finally {
    await rm(directory, { recursive: true, force: true });
    await db.$disconnect();
  }
});

test('judge campaign allowance is a fixed PostgreSQL ceiling, separate from public rolling rows', { timeout: 60_000 }, async () => {
  const db = getPrisma();
  const campaign = 'ci-judge-allowance-campaign';
  const where = { entityType: JUDGE_RUN_ENTITY, entityId: campaign, actionType: JUDGE_RUN_ACTION };
  try {
    const publicBefore = await db.auditLog.count({ where: { entityType: 'claim_verification' } });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserveJudgeVerificationRun(campaign, 3)));
    const admitted = results.filter(r => r.status === 'fulfilled').length;
    assert.ok(admitted >= 1 && admitted <= 3, 'concurrent judge reservations never exceed the cap');
    for (const r of results) if (r.status === 'rejected') assert.ok(r.reason instanceof JudgeRunAllowanceExhausted || r.reason?.code === 'P2034');
    for (let i = admitted; i < 3; i++) await reserveJudgeVerificationRun(campaign, 3);
    await assert.rejects(reserveJudgeVerificationRun(campaign, 3), JudgeRunAllowanceExhausted);
    assert.equal(await db.auditLog.count({ where }), 3, 'denial writes nothing; no rolling reset');
    assert.equal(await db.auditLog.count({ where: { entityType: 'claim_verification' } }), publicBefore, 'judge runs do not consume public rolling rows');
    const budget = { id: campaign, capMicroUsd: 4_980_000, expiresAt: Date.now() + 300_000 };
    await db.auditLog.create({ data: { entityType: MODEL_BUDGET_ENTITY, entityId: campaign, actionType: 'model_call_reserved', newValue: { microUsd: 10_000, capMicroUsd: budget.capMicroUsd, state: 'settled' } } });
    const before = await db.auditLog.findMany({ orderBy: { id: 'asc' } });
    assert.equal((await readSharedVerificationAvailability(db, 12, 12, budget, 3)).status, 'judge_limit');
    assert.equal((await readSharedVerificationAvailability(db, 12, 12, budget, 4)).status, 'available');
    assert.deepEqual(await db.auditLog.findMany({ orderBy: { id: 'asc' } }), before, 'availability read writes nothing');
  } finally {
    await db.$disconnect();
  }
});
