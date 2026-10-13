/**
 * V3 verification helper — prints per-table row counts + a few representative
 * ids so we can assert persistence end-to-end.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [
    countries,
    policies,
    versions,
    sources,
    snapshots,
    runs,
    contributions,
    reviewItems,
    reviewActions,
    auditEntries,
    domainScores,
    submetrics,
    scoreChanges,
    news,
  ] = await Promise.all([
    prisma.country.count(),
    prisma.policy.count(),
    prisma.policyVersion.count(),
    prisma.monitoredSource.count(),
    prisma.sourceSnapshot.count(),
    prisma.pipelineRun.count(),
    prisma.contribution.count(),
    prisma.reviewQueueItem.count(),
    prisma.reviewAction.count(),
    prisma.auditLog.count(),
    prisma.domainScore.count(),
    prisma.scoreSubmetric.count(),
    prisma.scoreChangeLog.count(),
    prisma.newsArticle.count(),
  ]);

  const [latestRun, latestSnap, latestContrib, latestReviewAction, latestScore] = await Promise.all([
    prisma.pipelineRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.sourceSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } }),
    prisma.contribution.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.reviewAction.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.scoreChangeLog.findFirst({ orderBy: { createdAt: 'desc' } }),
  ]);

  const out = {
    counts: {
      countries,
      policies,
      policy_versions: versions,
      monitored_sources: sources,
      source_snapshots: snapshots,
      pipeline_runs: runs,
      contributions,
      review_queue: reviewItems,
      review_actions: reviewActions,
      audit_logs: auditEntries,
      domain_scores: domainScores,
      score_submetrics: submetrics,
      score_change_logs: scoreChanges,
      news_articles: news,
    },
    latest_pipeline_run: latestRun
      ? {
          id: latestRun.id,
          pipelineKey: latestRun.pipelineKey,
          status: latestRun.status,
          changeDetected: latestRun.changeDetected,
          changeType: latestRun.changeType,
          startedAt: latestRun.startedAt.toISOString(),
          completedAt: latestRun.completedAt?.toISOString() ?? null,
        }
      : null,
    latest_snapshot: latestSnap
      ? {
          id: latestSnap.id,
          monitoredSourceId: latestSnap.monitoredSourceId,
          contentHash: latestSnap.contentHash,
          byteSize: latestSnap.byteSize,
          fetchStatus: latestSnap.fetchStatus,
          fetchedAt: latestSnap.fetchedAt.toISOString(),
        }
      : null,
    latest_contribution: latestContrib
      ? {
          id: latestContrib.id,
          title: latestContrib.title,
          status: latestContrib.status,
          createdAt: latestContrib.createdAt.toISOString(),
        }
      : null,
    latest_review_action: latestReviewAction
      ? {
          id: latestReviewAction.id,
          reviewQueueId: latestReviewAction.reviewQueueId,
          action: latestReviewAction.action,
          reviewer: latestReviewAction.reviewer,
          createdAt: latestReviewAction.createdAt.toISOString(),
        }
      : null,
    latest_score_change: latestScore
      ? {
          id: latestScore.id,
          domain: latestScore.domain,
          previousScore: latestScore.previousScore,
          newScore: latestScore.newScore,
          delta: latestScore.delta,
          triggeringPolicyId: latestScore.triggeringPolicyId,
          triggeringVersionId: latestScore.triggeringVersionId,
          createdAt: latestScore.createdAt.toISOString(),
        }
      : null,
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
