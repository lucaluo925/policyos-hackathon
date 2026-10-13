import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persistVerification } from '../review-sink';
import type { VerificationResult } from '../types';

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
  const committed: { reviews: Array<{ id: string }>; audits: Array<{ actionType: string }> } = {
    reviews: [], audits: [],
  };
  let failSecondAudit = true;
  holder.prisma = {
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const pending = { reviews: [] as Array<{ id: string }>, audits: [] as Array<{ actionType: string }> };
      const tx = {
        reviewQueueItem: { create: async () => {
          const row = { id: `review-${pending.reviews.length + 1}` };
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
      return outcome;
    },
  };
  process.env.DATABASE_URL = 'postgresql://test@localhost/test';

  try {
    await assert.rejects(persistVerification(result), /audit unavailable/);
    assert.equal(committed.reviews.length, 0);
    assert.equal(committed.audits.length, 0);

    failSecondAudit = false;
    const outcome = await persistVerification(result);
    assert.equal(outcome.persisted.length, 2);
    assert.equal(committed.reviews.length, 2);
    assert.deepEqual(committed.audits.map((row) => row.actionType), ['claim_verified', 'claim_verified']);
    assert.ok(outcome.persisted.every((row) => !row.gate.canChangeScore));
  } finally {
    holder.prisma = previousClient;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
