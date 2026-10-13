import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persistVerification } from '../review-sink';
import type { VerificationResult } from '../types';
import { verificationSnapshot } from '../archive';
import { archivedResult } from './fixtures/verification';

const result: VerificationResult = {
  claim: 'Two independently checkable policy dates.',
  assertions: [1, 2].map((number) => ({
    assertion: { id: `a${number}`, text: `Date ${number} is in force.` },
    verdict: 'supported' as const,
    confidence: 0.8,
    citedUrls: [`https://example.gov/${number}`],
    rationale: 'The published notice specifies the date.',
    conflicted: false,
  })),
  overall: 'supported',
  tavilyRequestIds: ['search-1', 'search-2'],
  stats: { retrieved: 2, screenedRelevant: 2, adjudicated: 2, tavilyCalls: 2, modelCalls: 5, elapsedMs: 1000 },
};

test('verification rows and audit entries commit together, including across assertions', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const holder = globalThis as unknown as { prisma?: unknown };
  const previousClient = holder.prisma;
  const committed: { reviews: Array<{ id: string; verificationRunId: string }>; audits: Array<{ actionType: string }>; snapshots: unknown[] } = {
    reviews: [], audits: [], snapshots: [],
  };
  let failSecondAudit = true;
  holder.prisma = {
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const pending = { reviews: [] as Array<{ id: string; verificationRunId: string }>, audits: [] as Array<{ actionType: string }>, snapshots: [] as unknown[] };
      const tx = {
        verificationRun: { create: async ({ data }: { data: { snapshot: unknown } }) => {
          pending.snapshots.push(data.snapshot);
          return { id: 'archive-1' };
        } },
        reviewQueueItem: { create: async ({ data }: { data: { verificationRunId: string } }) => {
          const row = { id: `review-${pending.reviews.length + 1}`, verificationRunId: data.verificationRunId };
          pending.reviews.push(row);
          return row;
        } },
        auditLog: { create: async ({ data }: { data: { actionType: string } }) => {
          if (failSecondAudit && pending.audits.length === 1) throw new Error('audit unavailable');
          pending.audits.push({ actionType: data.actionType });
          return { id: `audit-${pending.audits.length}` };
        } },
      };
      const outcome = await work(tx);
      committed.reviews.push(...pending.reviews);
      committed.audits.push(...pending.audits);
      committed.snapshots.push(...pending.snapshots);
      return outcome;
    },
  };
  process.env.DATABASE_URL = 'postgresql://test@localhost/test';

  try {
    await assert.rejects(persistVerification(result), /audit unavailable/);
    assert.equal(committed.reviews.length, 0);
    assert.equal(committed.audits.length, 0);
    assert.equal(committed.snapshots.length, 0, 'failed second assertion rolls back the snapshot');

    failSecondAudit = false;
    const outcome = await persistVerification(result);
    assert.equal(outcome.persisted.length, 2);
    assert.equal(committed.reviews.length, 2);
    assert.equal(committed.snapshots.length, 1, 'one snapshot shared by all assertions');
    assert.equal(outcome.verificationRunId, 'archive-1');
    assert.ok(committed.reviews.every(row => row.verificationRunId === outcome.verificationRunId));
    assert.deepEqual(committed.audits.map((row) => row.actionType), ['claim_verified', 'claim_verified']);
    assert.ok(outcome.persisted.every((row) => !row.gate.canChangeScore));
  } finally {
    holder.prisma = previousClient;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});

test('snapshot preserves exact Unicode, excerpt attribution and model diagnostics', () => {
  const snapshot = verificationSnapshot(archivedResult);
  assert.equal(snapshot.evidenceScope, 'adjudication_inputs');
  assert.deepEqual(snapshot.result, archivedResult);
  const withoutProvenance = { ...archivedResult, provenance: undefined };
  assert.equal(Object.hasOwn((verificationSnapshot(withoutProvenance).result as object), 'provenance'), false,
    'legacy inputs cannot acquire invented evidence');
});

test('oversized evidence fails before any transaction rather than truncating source text', async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://offline.invalid/test';
  try {
    const large = structuredClone(archivedResult);
    large.provenance!.adjudicationEvidence.a1[0].snippet = '字'.repeat(400_000);
    await assert.rejects(persistVerification(large), /archive size limit/);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
