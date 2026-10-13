import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { adminCookieValue, ADMIN_COOKIE } from '../admin';
import { GET as auditGet } from '../../../app/api/freshness/audit/route';
import { GET as reviewGet } from '../../../app/api/freshness/review/route';
import { GET as statusGet } from '../../../app/api/freshness/status/route';
import { GET as pipelineGet } from '../../../app/api/pipeline/route';
import { GET as contributionGet, POST as contributionPost } from '../../../app/api/contributions/route';

// All DB calls resolve against a synthetic in-memory Prisma object. No real URL/key/log is read.
const env = process.env as Record<string, string | undefined>;
const originalEnv = Object.fromEntries(['NODE_ENV', 'ADMIN_PASSWORD', 'CRON_SECRET', 'DATABASE_URL'].map(k => [k, env[k]]));
const shared = globalThis as unknown as { prisma?: PrismaClient };
const originalPrisma = shared.prisma;
const originalFetch = globalThis.fetch;
const EMAIL = 'PRIVATE_PERSON@example.invalid';
const PRIVATE = 'OFFLINE_PRIVATE_DIAGNOSTIC';
const date = new Date('2026-10-11T00:00:00Z');
const auditRow = {
  id: 'audit-1', entityType: 'contribution', entityId: 'contribution-1', actionType: 'contribution_received',
  actorType: 'user', actorId: EMAIL, confidence: 'unverified', createdAt: date,
  summary: `${PRIVATE} ${EMAIL}`, sourceUrl: `https://example.invalid/?token=${PRIVATE}`,
  previousValue: { identity: EMAIL }, newValue: { secret: PRIVATE }, futurePrivateColumn: PRIVATE,
};
const contribution = {
  id: 'contribution-1', contributionType: 'correction', countryId: 1, domain: 'climate', title: 'Offline policy',
  body: 'Synthetic review text', sourceUrl: 'https://www.gov.uk', submitterName: PRIVATE, submitterEmail: EMAIL,
  status: 'submitted', createdAt: date, updatedAt: date, country: { iso2: 'GB', name: 'United Kingdom' },
  futurePrivateColumn: PRIVATE,
};
const reviewRow = {
  id: 'review-1', targetType: 'contribution', targetId: 'contribution-1', contributionId: 'contribution-1',
  priority: 3, confidence: 'unverified', recommendedAction: 'triage', status: 'pending',
  createdAt: date, updatedAt: date, summary: `${PRIVATE} ${EMAIL}`,
  contribution, actions: [{ reviewer: EMAIL, notes: PRIVATE }], resolutionTrace: { email: EMAIL }, futurePrivateColumn: PRIVATE,
};
const runRow = {
  id: 'run-1', pipelineKey: 'canada-immigration', status: 'failed', changeDetected: false, changeType: null,
  startedAt: date, completedAt: date, itemsProcessed: 0, itemsChanged: 0, itemsFlagged: 0,
  errorMessage: `${PRIVATE} ${EMAIL}`, summary: `${PRIVATE} ${EMAIL}`, failureType: 'network_error', monitoredSource: null,
};
let reads = 0;
let failReads = false;
let auditWrites: Record<string, unknown>[] = [];
let selectSeen: Record<string, unknown>[] = [];
function project(row: Record<string, unknown>, args?: { select?: Record<string, unknown> }) {
  reads++;
  if (failReads) throw new Error(`${PRIVATE} ${EMAIL}`);
  if (!args?.select) return row;
  selectSeen.push(args.select);
  return Object.fromEntries(Object.keys(args.select).filter(k => args.select![k] === true).map(k => [k, row[k]]));
}
function scalar(value: unknown) {
  reads++;
  if (failReads) throw new Error(`${PRIVATE} ${EMAIL}`);
  return value;
}
beforeEach(() => {
  env.NODE_ENV = 'production'; env.ADMIN_PASSWORD = 'offline-private-password';
  env.CRON_SECRET = 'offline-cron'; env.DATABASE_URL = 'postgresql://offline.invalid/offline';
  reads = 0; failReads = false; auditWrites = []; selectSeen = [];
  globalThis.fetch = async () => { throw new Error('OFFLINE: network forbidden'); };
  shared.prisma = {
    auditLog: {
      findMany: async (args: { select?: Record<string, unknown> }) => [project(auditRow, args)],
      create: async ({ data }: { data: Record<string, unknown> }) => { auditWrites.push(data); return { id: 'audit-new', ...data }; },
    },
    reviewQueueItem: {
      findMany: async (args: { select?: Record<string, unknown> }) => [project(reviewRow, args)],
      count: async () => scalar(1), create: async () => ({ id: 'review-new' }),
    },
    contribution: { findMany: async () => { scalar(null); return [contribution]; }, create: async () => contribution },
    country: { findFirst: async () => ({ id: 1 }) },
    pipelineRun: { findMany: async () => [project(runRow)], findFirst: async () => project(runRow) },
    monitoredSource: { count: async () => scalar(1), findMany: async () => scalar([]), findFirst: async () => scalar(null) },
    policy: { count: async () => scalar(1) },
  } as unknown as PrismaClient;
});
after(() => {
  for (const [k, v] of Object.entries(originalEnv)) { if (v === undefined) delete env[k]; else env[k] = v; }
  shared.prisma = originalPrisma;
  globalThis.fetch = originalFetch;
});
async function request(path: string, mode = 'admin', query = '') {
  const headers: Record<string, string> = {};
  if (mode === 'admin') headers.cookie = `${ADMIN_COOKIE}=${await adminCookieValue()}`;
  if (mode === 'forged') headers.cookie = `${ADMIN_COOKIE}=ok`;
  if (mode === 'malformed') headers.cookie = `${ADMIN_COOKIE}=%E0%A4%A`;
  if (mode === 'cron') headers.authorization = 'Bearer offline-cron';
  return new Request(`http://localhost${path}${query}`, { headers });
}
const routes = [
  ['/api/freshness/audit', auditGet], ['/api/freshness/review', reviewGet],
  ['/api/freshness/status', statusGet], ['/api/pipeline', pipelineGet], ['/api/contributions', contributionGet],
] as const;
for (const [path, handler] of routes) {
  for (const mode of ['anonymous', 'forged', 'cron', 'malformed']) {
    test(`${path}: ${mode} cannot read DB or receive private fields`, async () => {
      const response = await handler(await request(path, mode));
      assert.equal(response.status, 401);
      assert.equal(reads, 0);
      assert.ok(!await response.text().then(text => text.includes(EMAIL) || text.includes(PRIVATE)));
      assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
    });
  }
  test(`${path}: production admin disabled stays closed even without DB`, async () => {
    delete env.ADMIN_PASSWORD; delete env.DATABASE_URL;
    const response = await handler(await request(path, 'forged'));
    assert.equal(response.status, 401); assert.equal(reads, 0);
  });
  test(`${path}: authorized metadata is available and non-cacheable`, async () => {
    const response = await handler(await request(path));
    assert.equal(response.status, 200); assert.ok(reads > 0);
    assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/);
    assert.match(response.headers.get('vary') ?? '', /Cookie/i);
    const data = await response.text();
    assert.ok(!data.includes(EMAIL)); assert.ok(!data.includes(PRIVATE));
  });
  test(`${path}: authorized database errors never echo raw diagnostics`, async () => {
    failReads = true;
    const response = await handler(await request(path));
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.ok(!text.includes(PRIVATE) && !text.includes(EMAIL));
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  });
}
test('audit metadata uses an allowlist DB select, redacts actorId, omits arbitrary JSON/context', async () => {
  const response = await auditGet(await request('/api/freshness/audit'));
  const data = await response.json();
  assert.equal(data.entries[0].actorId, '[redacted]');
  assert.equal(data.entries[0].actionType, 'contribution_received');
  for (const field of ['previousValue', 'newValue', 'summary', 'sourceUrl', 'futurePrivateColumn']) {
    assert.equal(Object.hasOwn(data.entries[0], field), false);
  }
  assert.ok(selectSeen.length);
  assert.ok(!Object.hasOwn(selectSeen[0], 'actorId'));
});
test('review list never reads/returns joined contributor identity, reviewer notes or future private columns', async () => {
  const response = await reviewGet(await request('/api/freshness/review'));
  const data = await response.json();
  assert.equal(data.items[0].status, 'pending');
  for (const field of ['contribution', 'actions', 'summary', 'resolutionTrace', 'futurePrivateColumn']) {
    assert.equal(Object.hasOwn(data.items[0], field), false);
    assert.ok(!Object.hasOwn(selectSeen[0], field));
  }
});
test('new community submission audit actor does not duplicate submitter email', async () => {
  const response = await contributionPost(new Request('http://localhost/api/contributions', {
    method: 'POST', body: JSON.stringify({ type: 'correction', country: 'GB', category: 'climate',
      title: 'Offline policy', description: 'Synthetic text', sourceUrl: 'https://www.gov.uk', email: EMAIL }),
  }));
  assert.equal(response.status, 201);
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0].actorId, 'anonymous');
  assert.ok(!JSON.stringify(auditWrites).includes(EMAIL));
});
test('rotated admin cookie loses access without querying audit', async () => {
  const req = await request('/api/freshness/audit');
  env.ADMIN_PASSWORD = 'offline-rotated';
  const response = await auditGet(req);
  assert.equal(response.status, 401); assert.equal(reads, 0);
});
