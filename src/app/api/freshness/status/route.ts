/**
 * System status endpoint — reflects the live DB state, not a build-time cache.
 *
 * Returns recent pipeline runs, monitored-source counts, policy freshness
 * summary (verified / stale / pending review), and review queue counts. Used
 * by the admin dashboard.
 */

import { privateJson } from '@/lib/auth/private-response';
import { isAdminRequest } from '@/lib/auth/admin';
import {
  isDatabaseConfigured,
  getPrisma,
  pipelineRepo,
  sourceRepo,
  policyRepo,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return privateJson({ error: 'unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) {
    return privateJson(
      {
        error:
          'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace to enable the status endpoint.',
      },
      { status: 503 },
    );
  }

  try {
    const prisma = getPrisma();
    const statusAt = new Date().toISOString();
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      recentRuns,
      totalSources,
      activeSources,
      overdueSources,
      totalPolicies,
      verifiedPolicies,
      stalePolicies,
      pendingReview,
      pendingReviewItems,
      approvedReviewItems,
      rejectedReviewItems,
    ] = await Promise.all([
      pipelineRepo.listRecentRuns({ limit: 10 }),
      prisma.monitoredSource.count(),
      prisma.monitoredSource.count({ where: { active: true } }),
      sourceRepo.getOverdueSources(),
      prisma.policy.count(),
      prisma.policy.count({
        where: {
          verificationConfidence: 'high',
          lastVerifiedAt: { gte: sevenDaysAgo },
        },
      }),
      policyRepo.countPoliciesWithStaleStatus(30),
      prisma.policy.count({ where: { nextReviewAt: { lte: new Date() } } }),
      prisma.reviewQueueItem.count({ where: { status: 'pending' } }),
      prisma.reviewQueueItem.count({ where: { status: 'approved' } }),
      prisma.reviewQueueItem.count({ where: { status: 'rejected' } }),
    ]);

    const pipelines = recentRuns.map((run) => ({
      id: run.id,
      pipelineKey: run.pipelineKey,
      status: run.status,
      changeDetected: run.changeDetected,
      changeType: run.changeType,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      itemsProcessed: run.itemsProcessed,
      itemsChanged: run.itemsChanged,
      itemsFlagged: run.itemsFlagged,
      hasError: Boolean(run.errorMessage),
      source: run.monitoredSource
        ? {
            id: run.monitoredSource.id,
            name: run.monitoredSource.sourceName,
            url: run.monitoredSource.sourceUrl,
          }
        : null,
    }));

    return privateJson({
      system: 'PolicyOS Freshness Engine',
      version: '1.0.0',
      statusAt,
      pipelines,
      monitoring: {
        totalSources,
        activeSources,
        overdueChecks: overdueSources.length,
      },
      policies: {
        total: totalPolicies,
        verified: verifiedPolicies,
        stale: stalePolicies,
        pendingReview,
      },
      reviewQueue: {
        pending: pendingReviewItems,
        approved: approvedReviewItems,
        rejected: rejectedReviewItems,
      },
      nextScheduledRuns: {
        canada_immigration: 'Daily at 00:00 UTC (Vercel cron)',
        deep_verification: 'Manual trigger only',
      },
    });
  } catch {
    return privateJson(
      {
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}
