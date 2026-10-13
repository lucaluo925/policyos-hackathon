/**
 * GET /api/system-status — aggregated, dynamic summary of the live system.
 *
 * Used by the homepage, compare page, and any public-facing trust signal.
 * Everything returned here is computed from the live DB — no hardcoded
 * counters, no V2 legacy numbers.
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured, getPrisma } from '@/lib/db';
import { PIPELINE_COVERAGE } from '@/lib/pipeline/coverage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  if (!isDatabaseConfigured()) {
    // Fallback: report the registry totals but flag DB as not-configured.
    return NextResponse.json({
      ok: false,
      dbConfigured: false,
      pipelineCount: PIPELINE_COVERAGE.length,
      message: 'DATABASE_URL not set; system-status falls back to registry totals.',
    });
  }

  const prisma = getPrisma();
  const [
    totalPipelines,
    activeSources,
    totalSources,
    unstableSources,
    stableSources,
    pipelinesByDomain,
    evidenceBacked,
    evidenceStrong,
    evidenceMedium,
    totalSubmetrics,
    latestRun,
    feedItemsCount,
    latestFeed,
    runsByStatus,
    runsWithFailure,
    highConfVersions,
    distinctCountriesWithPipeline,
  ] = await Promise.all([
    prisma.monitoredSource.count({ where: { pipelineKey: { not: null } } }),
    prisma.monitoredSource.count({ where: { active: true } }),
    prisma.monitoredSource.count(),
    prisma.monitoredSource.count({ where: { isStable: false } }),
    prisma.monitoredSource.count({ where: { isStable: true, active: true } }),
    prisma.monitoredSource.groupBy({
      by: ['domain'],
      _count: true,
      where: { pipelineKey: { not: null } },
    }),
    prisma.scoreSubmetric.count({ where: { evidenceBackedAt: { not: null } } }),
    prisma.policyVersion.count({ where: { evidenceType: 'strong' } }),
    prisma.policyVersion.count({ where: { evidenceType: 'medium' } }),
    prisma.scoreSubmetric.count(),
    prisma.pipelineRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true, pipelineKey: true, status: true, changeType: true } }),
    prisma.newsArticle.count({ where: { ingestionType: 'rss_feed' } }),
    prisma.newsArticle.findFirst({ where: { ingestionType: 'rss_feed' }, orderBy: { publishedAt: 'desc' }, select: { publishedAt: true, title: true, source: true } }),
    prisma.pipelineRun.groupBy({ by: ['status'], _count: true }),
    prisma.pipelineRun.groupBy({ by: ['failureType'], _count: true, where: { failureType: { not: null } } }),
    prisma.policyVersion.count({ where: { extractionConfidence: 'high' } }),
    prisma.monitoredSource.findMany({ where: { pipelineKey: { not: null } }, select: { countryId: true }, distinct: ['countryId'] }),
  ]);

  const domainCounts: Record<string, number> = { climate: 0, trade: 0, immigration: 0 };
  for (const row of pipelinesByDomain) domainCounts[row.domain] = row._count;

  const failuresMap: Record<string, number> = {};
  for (const row of runsByStatus) failuresMap[row.status] = row._count;
  const failureTypeMap: Record<string, number> = {};
  for (const row of runsWithFailure) failureTypeMap[row.failureType ?? 'unclassified'] = row._count;

  // V10 + V11: extended review / resolution metrics + self-diagnostics
  const [pendingByReason, resolutionBreakdown, avgResolveSeconds, forcedCount, capBlockedCount, stuckCount, avgPendingAgeSeconds, pdfTotals, switchedSources] = await Promise.all([
    prisma.reviewQueueItem.groupBy({
      by: ['finalDecisionReason'],
      _count: true,
      where: { status: 'pending' },
    }),
    prisma.reviewQueueItem.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.$queryRaw<Array<{ avg: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))::float AS avg
      FROM review_queue
      WHERE resolved_at IS NOT NULL
        AND created_at >= NOW() - INTERVAL '14 days'
    `,
    prisma.reviewQueueItem.count({ where: { autoResolution: 'forced_resolution' } }),
    prisma.reviewQueueItem.count({ where: { finalDecisionReason: 'blocked_by_daily_cap' } }),
    // V11 self-diagnostics
    prisma.reviewQueueItem.count({
      where: { status: 'pending', createdAt: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
    }),
    prisma.$queryRaw<Array<{ avg: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (NOW() - created_at)))::float AS avg
      FROM review_queue
      WHERE status = 'pending'
    `,
    prisma.monitoredSource.aggregate({
      _sum: { pdfsProcessed: true },
    }),
    prisma.monitoredSource.count({ where: { switchedToFallback: true } }),
  ]);

  const pendingReasonMap: Record<string, number> = {};
  for (const row of pendingByReason) pendingReasonMap[row.finalDecisionReason ?? 'unclassified'] = row._count;
  const resolutionStatusMap: Record<string, number> = {};
  for (const row of resolutionBreakdown) resolutionStatusMap[row.status] = row._count;
  const totalResolved = Object.entries(resolutionStatusMap)
    .filter(([k]) => ['auto_approved', 'escalated', 'expired', 'merged', 'approved', 'conflict'].includes(k))
    .reduce((a, [, v]) => a + v, 0);
  const totalItems = Object.values(resolutionStatusMap).reduce((a, v) => a + v, 0);
  const autoResolutionRate = totalItems === 0 ? 0 : Number(((totalResolved / totalItems) * 100).toFixed(1));

  return NextResponse.json({
    ok: true,
    dbConfigured: true,
    generatedAt: new Date().toISOString(),
    pipelines: {
      total: totalPipelines,
      byDomain: domainCounts,
      countriesCovered: distinctCountriesWithPipeline.length,
    },
    sources: {
      total: totalSources,
      active: activeSources,
      stable: stableSources,
      unstable: unstableSources,
    },
    runs: {
      byStatus: failuresMap,
      byFailureType: failureTypeMap,
      latest: latestRun
        ? {
            pipelineKey: latestRun.pipelineKey,
            status: latestRun.status,
            changeType: latestRun.changeType,
            startedAt: latestRun.startedAt.toISOString(),
          }
        : null,
    },
    evidence: {
      backedSubmetrics: evidenceBacked,
      totalSubmetrics,
      percent: totalSubmetrics > 0 ? Number(((evidenceBacked / totalSubmetrics) * 100).toFixed(2)) : 0,
      strongVersions: evidenceStrong,
      mediumVersions: evidenceMedium,
      highConfVersions,
    },
    feeds: {
      itemsTotal: feedItemsCount,
      latest: latestFeed
        ? {
            publishedAt: latestFeed.publishedAt.toISOString(),
            title: latestFeed.title,
            source: latestFeed.source,
          }
        : null,
    },
    // V10: review-queue health
    review: {
      pendingBreakdown: pendingReasonMap,
      resolutionBreakdown: resolutionStatusMap,
      autoResolutionRate,
      blockedByCap: capBlockedCount,
      forcedResolutions: forcedCount,
      avgResolutionSeconds: avgResolveSeconds[0]?.avg ?? null,
    },
    // V11: self-diagnostics (stuck items, avg queue age, pipeline health, PDFs, auto-switches)
    selfDiagnostics: {
      stuckItems: stuckCount, // pending > 48h
      avgPendingAgeSeconds: avgPendingAgeSeconds[0]?.avg ?? null,
      pipelineHealthScore: Number(
        (
          100 *
          (stableSources / Math.max(1, totalPipelines)) *
          (1 -
            Math.min(
              1,
              Object.values(failureTypeMap).reduce((a, v) => a + v, 0) /
                Math.max(1, Object.values(failuresMap).reduce((a, v) => a + v, 0)),
            )) ** 0.5
        ).toFixed(1),
      ),
      resolutionEfficiency: autoResolutionRate,
      pdfsProcessed: pdfTotals._sum.pdfsProcessed ?? 0,
      sourcesOnFallback: switchedSources,
    },
  });
}
