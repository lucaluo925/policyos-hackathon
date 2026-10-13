import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { GET } from '../../../app/api/verify/records/[id]/route';
import { ADMIN_COOKIE, adminCookieValue } from '../../auth/admin';
import { verificationSnapshot } from '../archive';
import { archivedResult } from './fixtures/verification';

test('saved evidence is admin-only, non-cacheable, exact and safe to download', async t => {
  const names = ['NODE_ENV', 'ADMIN_PASSWORD', 'DATABASE_URL', 'CRON_SECRET'] as const;
  const previous = Object.fromEntries(names.map(k => [k, process.env[k]]));
  const env = process.env as Record<string, string | undefined>;
  const holder = globalThis as unknown as { prisma?: PrismaClient };
  const oldClient = holder.prisma;
  let reads = 0;
  let outcome: 'ok' | 'absent' | 'error' = 'ok';
  holder.prisma = { verificationRun: { findUnique: async (args: { where: { id: string }; select: object }) => {
    reads++;
    assert.equal(args.where.id, 'saved-1');
    assert.deepEqual(args.select, { id: true, createdAt: true, snapshot: true });
    if (outcome === 'error') throw new Error('PRIVATE_DATABASE_DIAGNOSTIC');
    return outcome === 'absent' ? null : { id: 'saved-1', createdAt: new Date('2026-10-13T00:00:02Z'),
      snapshot: verificationSnapshot(archivedResult) };
  } } } as unknown as PrismaClient;
  env.NODE_ENV = 'production'; env.ADMIN_PASSWORD = 'offline-archive-password';
  env.DATABASE_URL = 'postgresql://offline.invalid/test'; env.CRON_SECRET = 'offline-cron';
  const request = (headers: Record<string, string> = {}) => new Request('https://example.invalid/api/verify/records/saved-1', { headers });
  const context = (id = 'saved-1') => ({ params: Promise.resolve({ id }) });
  try {
    await t.test('anonymous, forged, malformed and cron credentials cannot query storage', async () => {
      const attempts: Record<string, string>[] = [{}, { cookie: `${ADMIN_COOKIE}=forged` },
        { cookie: `${ADMIN_COOKIE}=%E0%A4%A` }, { authorization: 'Bearer offline-cron' }];
      for (const headers of attempts) {
        const res = await GET(request(headers), context());
        assert.equal(res.status, 401); assert.equal(reads, 0);
        assert.match(res.headers.get('cache-control')!, /private.*no-store/);
        assert.ok(!(await res.text()).includes('Synthetic'));
      }
    });
    const cookie = { cookie: `${ADMIN_COOKIE}=${await adminCookieValue()}` };
    await t.test('authenticated download retains the exact saved inputs', async () => {
      const res = await GET(request(cookie), context());
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition')!, /attachment; filename="policyos-evidence-saved-1.json"/);
      assert.match(res.headers.get('content-type')!, /application\/json/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.match(res.headers.get('cache-control')!, /private.*no-store/);
      assert.equal(res.headers.get('vary'), 'Cookie');
      assert.deepEqual((await res.json()).snapshot.result, archivedResult);
    });
    await t.test('bad ID, absent record and storage errors are distinct and sanitized', async () => {
      assert.equal((await GET(request(cookie), context('../invalid'))).status, 400);
      outcome = 'absent'; assert.equal((await GET(request(cookie), context())).status, 404);
      outcome = 'error'; const res = await GET(request(cookie), context());
      assert.equal(res.status, 500); assert.ok(!(await res.text()).includes('PRIVATE_DATABASE'));
      delete env.DATABASE_URL;
      assert.equal((await GET(request(cookie), context())).status, 503);
    });
    await t.test('rotated or disabled admin credential does not read storage', async () => {
      const before = reads;
      env.ADMIN_PASSWORD = 'rotated';
      assert.equal((await GET(request(cookie), context())).status, 401);
      delete env.ADMIN_PASSWORD;
      assert.equal((await GET(request(cookie), context())).status, 401);
      assert.equal(reads, before);
    });
  } finally {
    holder.prisma = oldClient;
    for (const k of names) { if (previous[k] === undefined) delete env[k]; else env[k] = previous[k]; }
  }
});
