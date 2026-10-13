import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../../src/lib/db/client';
import { persistVerification } from '../../src/lib/verify/review-sink';
import { verificationSnapshot } from '../../src/lib/verify/archive';
import { archivedResult } from '../../src/lib/verify/__tests__/fixtures/verification';
import { GET } from '../../src/app/api/verify/records/[id]/route';
import { ADMIN_COOKIE, adminCookieValue } from '../../src/lib/auth/admin';
import { requireDisposableDatabase } from './disposable-database';

requireDisposableDatabase();
const exec = promisify(execFile);

test('PostgreSQL saves exact evidence, keeps repeat runs distinct and rolls back incomplete writes', async t => {
  const db = getPrisma();
  const holder = globalThis as unknown as { prisma?: PrismaClient };
  const oldPassword = process.env.ADMIN_PASSWORD;
  const auditWhere = { entityType: 'claim_verification', actionType: 'claim_verified' };
  try {
    assert.equal(await db.verificationRun.count(), 0, 'requires fresh evidence tables; no cleanup of existing data');
    assert.equal(await db.reviewQueueItem.count(), 0);
    const beforeAudits = await db.auditLog.count({ where: auditWhere });
    const first = await persistVerification(archivedResult);
    assert.ok(first.verificationRunId);
    assert.equal(first.persisted.length, 2);
    const reviews = await db.reviewQueueItem.findMany({ where: { verificationRunId: first.verificationRunId } });
    assert.equal(reviews.length, 2);
    assert.ok(reviews.every(r => r.confidence === 'low' && r.targetType === 'claim_verification'));
    const { stdout } = await exec(process.execPath,
      ['--import', 'tsx', 'tests/integration/verification-read-worker.ts', first.verificationRunId]);
    const saved = stdout.match(/^ARCHIVE_RESULT:(.+)$/m)?.[1];
    assert.ok(saved, 'a new process can read the committed snapshot');
    assert.deepEqual(JSON.parse(saved), verificationSnapshot(archivedResult));

    const second = await persistVerification(archivedResult);
    assert.notEqual(second.verificationRunId, first.verificationRunId, 'same claim does not overwrite an earlier run');
    assert.equal(await db.verificationRun.count(), 2);
    const before = { reviews: await db.reviewQueueItem.count(), archives: await db.verificationRun.count(),
      audits: await db.auditLog.count({ where: auditWhere }) };

    // Inject a failure after real inserts, inside a real PostgreSQL transaction.
    // The production persistence function still owns the transaction boundary.
    let auditCalls = 0;
    const failing = db.$extends({ query: { auditLog: { async create({ args, query }) {
      if (args.data.actionType === 'claim_verified' && ++auditCalls === 2) throw new Error('injected second audit failure');
      return query(args);
    } } } });
    holder.prisma = failing as unknown as PrismaClient;
    await assert.rejects(persistVerification(archivedResult), /injected second audit failure/);
    holder.prisma = db;
    assert.equal(await db.verificationRun.count(), before.archives);
    assert.equal(await db.reviewQueueItem.count(), before.reviews);
    assert.equal(await db.auditLog.count({ where: auditWhere }), before.audits);
    assert.equal(before.audits - beforeAudits, 4);

    process.env.ADMIN_PASSWORD = 'disposable-ci-reviewer';
    const context = { params: Promise.resolve({ id: first.verificationRunId }) };
    const url = `http://localhost/api/verify/records/${first.verificationRunId}`;
    assert.equal((await GET(new Request(url), context)).status, 401);
    const response = await GET(new Request(url, { headers: {
      cookie: `${ADMIN_COOKIE}=${await adminCookieValue()}`,
    } }), context);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).snapshot, verificationSnapshot(archivedResult));
    assert.match(response.headers.get('cache-control')!, /private.*no-store/);
    t.diagnostic('Real PostgreSQL: exact snapshot read by a separate process; repeat-run separation; atomic rollback; protected download. Provider calls: 0.');
  } finally {
    holder.prisma = db;
    if (oldPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = oldPassword;
    await db.$disconnect();
  }
});
