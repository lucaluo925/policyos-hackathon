/**
 * Admin dashboard — reads live from Postgres via Prisma.
 *
 * All data here is dynamic per request. When DATABASE_URL is not configured
 * the page renders a setup banner instead of fake rows, so the admin view
 * never lies about what's backing it.
 *
 * AUTH: belt-and-suspenders alongside `src/proxy.ts`. This page is a
 * server component; it reads the `admin_auth` cookie directly and calls
 * `redirect('/admin/login')` if missing. Even if the proxy is somehow
 * bypassed, no admin HTML is rendered without a valid cookie.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  isDatabaseConfigured,
  getPrisma,
  reviewRepo,
  pipelineRepo,
  auditRepo,
  sourceRepo,
  policyRepo,
  scoreRepo,
} from '@/lib/db';
import { ADMIN_COOKIE, isValidAdminCookie } from '@/lib/auth/admin';
import { PIPELINE_COVERAGE } from '@/lib/pipeline/coverage';
import ReviewQueueActions from './ReviewQueueActions';
import PipelineActions from './PipelineActions';
import LogoutButton from './LogoutButton';
import AutoResolveActions from './AutoResolveActions';
import EventReviewActions from './EventReviewActions';
import { RunStateBadge } from '@/components/RunStateBadge';

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return 'never';
  const then = new Date(date).getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function shortHash(h?: string | null): string {
  return h ? `${h.slice(0, 10)}…` : '—';
}

// ─── Badges ─────────────────────────────────────────────────────────────────


function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    pipeline_run: 'bg-blue-500/15 text-blue-400',
    policy_created: 'bg-blue-500/15 text-blue-400',
    policy_version_added: 'bg-blue-500/15 text-blue-400',
    review_approved: 'bg-green-500/15 text-green-400',
    review_rejected: 'bg-red-500/15 text-red-400',
    contribution_received: 'bg-purple-500/15 text-purple-400',
    score_recomputed: 'bg-gray-500/15 text-gray-400',
    source_checked: 'bg-gray-500/15 text-gray-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[action] ?? 'bg-gray-500/15 text-gray-400'}`}>
      {action.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Empty-state ────────────────────────────────────────────────────────────

function DbNotConfiguredNotice() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <h1 className="text-2xl font-bold mb-3">Freshness Engine Dashboard</h1>
      <div className="p-5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-sm">
        <p className="font-medium text-yellow-400 mb-2">
          Database not configured
        </p>
        <p className="text-muted mb-3">
          This dashboard reads live policy, review, pipeline and audit data
          from Postgres. Provision a database via Vercel Marketplace
          (Neon / Supabase / Prisma Postgres) and set <code className="px-1 bg-surface-2 rounded">DATABASE_URL</code>
          {' '}in project env.
        </p>
        <pre className="p-3 rounded bg-surface-2 text-xs overflow-x-auto">
{`vercel integration add neon
vercel env pull .env.local
npm run db:migrate
npm run db:seed`}
        </pre>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function AdminPage() {
  // Server-side auth guard. Middleware is the primary gate; this is the
  // backup in case the proxy is bypassed. The check happens BEFORE any
  // DB reads or HTML rendering — if the cookie is missing or wrong,
  // redirect() throws and the response is a 307 before any admin data
  // reaches the client.
  const cookieStore = await cookies();
  if (!(await isValidAdminCookie(cookieStore.get(ADMIN_COOKIE)?.value))) {
    redirect('/admin/login?next=%2Fadmin');
  }

  if (!isDatabaseConfigured()) {
    return <DbNotConfiguredNotice />;
  }

  const prisma = getPrisma();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalPolicies,
    verifiedPolicies,
    stalePolicies,
    pendingReviewPolicies,
    totalSources,
    activeSources,
    overdueSources,
    reviewItems,
    pendingReviewCount,
    approvedCount,
    rejectedCount,
    recentRuns,
    auditEntries,
    recentScoreChanges,
    allSources,
    recentFeedItems,
    feedTotal,
    evidenceBacked,
    totalSubmetrics,
  ] = await Promise.all([
    prisma.policy.count(),
    prisma.policy.count({
      where: {
        verificationConfidence: 'high',
        lastVerifiedAt: { gte: sevenDaysAgo },
      },
    }),
    policyRepo.countPoliciesWithStaleStatus(30),
    prisma.policy.count({ where: { nextReviewAt: { lte: now } } }),
    prisma.monitoredSource.count(),
    prisma.monitoredSource.count({ where: { active: true } }),
    sourceRepo.getOverdueSources(),
    reviewRepo.listReviewQueue({ limit: 200 }),
    prisma.reviewQueueItem.count({ where: { status: 'pending' } }),
    prisma.reviewQueueItem.count({ where: { status: 'approved' } }),
    prisma.reviewQueueItem.count({ where: { status: 'rejected' } }),
    pipelineRepo.listRecentRuns({ limit: 6 }),
    auditRepo.listAudit({ limit: 15 }),
    scoreRepo.listScoreChanges({ limit: 5 }),
    prisma.monitoredSource.findMany({ include: { country: true } }),
    prisma.newsArticle.findMany({
      where: { ingestionType: 'rss_feed' },
      orderBy: { publishedAt: 'desc' },
      take: 8,
    }),
    prisma.newsArticle.count({ where: { ingestionType: 'rss_feed' } }),
    prisma.scoreSubmetric.count({ where: { evidenceBackedAt: { not: null } } }),
    prisma.scoreSubmetric.count(),
  ]);

  // V10: extended pending-reason breakdown + health metrics
  const pendingByReason = await prisma.reviewQueueItem.groupBy({
    by: ['finalDecisionReason'],
    _count: true,
    where: { status: 'pending' },
  });
  const forcedResolutionsCount = await prisma.reviewQueueItem.count({
    where: { autoResolution: 'forced_resolution' },
  });

  // V9: auto-resolution outcomes
  const [autoResolutionCounts, resolvedRecently] = await Promise.all([
    prisma.reviewQueueItem.groupBy({
      by: ['status'],
      _count: true,
      where: { status: { in: ['auto_approved', 'escalated', 'expired', 'conflict', 'merged'] } },
    }),
    prisma.reviewQueueItem.count({
      where: {
        status: { in: ['auto_approved', 'escalated', 'expired', 'conflict', 'merged'] },
        // eslint-disable-next-line react-hooks/purity -- async server component: rendered once per request, Date.now() is the request time
        resolvedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  // V6: reliability + deep-extraction metrics
  const [failureBreakdown, deepVersionTotals] = await Promise.all([
    prisma.pipelineRun.groupBy({
      by: ['failureType'],
      _count: true,
      where: { status: 'failed' },
    }),
    prisma.policyVersion.aggregate({
      _count: true,
      where: {
        mappingRules: { isEmpty: false },
      },
    }),
  ]);
  const highConfVersionCount = await prisma.policyVersion.count({
    where: {
      extractionConfidence: 'high',
      numericValues: { not: Prisma.JsonNull },
    },
  });

  // V7: evidence tier breakdown + partial_success counter
  const evidenceTierBreakdown = await prisma.policyVersion.groupBy({
    by: ['evidenceType'],
    _count: true,
    where: { evidenceType: { not: null } },
  });
  const partialSuccessRuns = await prisma.pipelineRun.count({
    where: { status: 'partial_success' },
  });

  const latestRun = recentRuns[0];
  const evidenceBackedPct =
    totalSubmetrics === 0 ? 0 : Math.round((evidenceBacked / totalSubmetrics) * 1000) / 10;

  // Build per-pipeline coverage with latest run per pipeline
  const coverageRows = await Promise.all(
    PIPELINE_COVERAGE.map(async (cov) => {
      const src = allSources.find((s) => s.pipelineKey === cov.pipelineKey);
      const lastRun = await prisma.pipelineRun.findFirst({
        where: { pipelineKey: cov.pipelineKey },
        orderBy: { startedAt: 'desc' },
      });
      return { cov, src, lastRun };
    }),
  );

  // V8: how many sources are currently unstable / have fallbacks registered
  const unstableSources = allSources.filter((s) => !s.isStable).length;
  const fallbackCapable = allSources.filter((s) => (s.fallbackUrls?.length ?? 0) > 0).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* 1. Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Freshness Engine Dashboard</h1>
          <p className="text-muted text-sm mt-1">
            Live policy verification status, review queue, and pipeline health — backed by Postgres.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <span className="px-3 py-1 rounded-lg bg-surface-2 border border-border text-xs text-muted font-medium">
            Internal admin view
          </span>
          <LogoutButton />
        </div>
      </div>

      {/* 2. System Health */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Policies</div>
          <div className="text-2xl font-bold mb-3">{totalPolicies}</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Verified (high, ≤7d)</span>
              <span className="font-medium text-green-400">{verifiedPolicies}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Stale (&gt;30d)</span>
              <span className="font-medium text-orange-400">{stalePolicies}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Pending review</span>
              <span className="font-medium text-yellow-400">{pendingReviewPolicies}</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Sources</div>
          <div className="text-2xl font-bold mb-3">{totalSources}</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Active</span>
              <span className="font-medium text-green-400">{activeSources}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Inactive</span>
              <span className="font-medium text-gray-400">{totalSources - activeSources}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Overdue checks</span>
              <span className="font-medium text-orange-400">{overdueSources.length}</span>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Pipeline Status</div>
          <div className="flex items-center gap-2 mb-3">
            {latestRun ? (
              <>
                <RunStateBadge run={latestRun} />
                <span className="text-xs text-muted">{latestRun.pipelineKey}</span>
              </>
            ) : (
              <span className="text-sm text-muted">No runs</span>
            )}
          </div>
          {latestRun && (
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Started</span>
                <span className="font-medium">{relativeTime(latestRun.startedAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Processed</span>
                <span className="font-medium">{latestRun.itemsProcessed}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Changed / flagged</span>
                <span className="font-medium">
                  {latestRun.itemsChanged} / {latestRun.itemsFlagged}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Review Queue</div>
          <div className="text-2xl font-bold mb-3">{reviewItems.length}</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">Pending</span>
              <span className="font-medium text-yellow-400">{pendingReviewCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Approved</span>
              <span className="font-medium text-green-400">{approvedCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Rejected</span>
              <span className="font-medium text-red-400">{rejectedCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline coverage */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <h2 className="text-xl font-bold">Pipeline Coverage</h2>
          <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">
            {PIPELINE_COVERAGE.length} registered
          </span>
          {(['immigration', 'climate', 'trade'] as const).map((d) => {
            const count = PIPELINE_COVERAGE.filter((c) => c.domain === d).length;
            return (
              <span
                key={d}
                className="text-[10px] px-2 py-0.5 rounded bg-surface-2 border border-border"
              >
                {d}: {count}
              </span>
            );
          })}
        </div>
        <div className="rounded-xl bg-surface border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">Pipeline</th>
                  <th className="text-left px-4 py-3 font-medium">Country · Domain</th>
                  <th className="text-left px-4 py-3 font-medium">Source</th>
                  <th className="text-left px-4 py-3 font-medium">Last run</th>
                  <th className="text-left px-4 py-3 font-medium">Change</th>
                  <th className="text-left px-4 py-3 font-medium">Stability</th>
                  <th className="text-left px-4 py-3 font-medium">Freq / PDFs (V11)</th>
                </tr>
              </thead>
              <tbody>
                {coverageRows.map(({ cov, src, lastRun }) => {
                  const failRatePct = src ? Math.round((src.failureRate ?? 0) * 100) : 0;
                  const stable = src?.isStable ?? true;
                  return (
                    <tr key={cov.pipelineKey} className="border-b border-border/50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{cov.label}</div>
                        <div className="text-[10px] text-muted">{cov.pipelineKey}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {cov.countryIso} · {cov.domain}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate">
                        <a
                          href={cov.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          {cov.sourceName}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                        {lastRun ? relativeTime(lastRun.startedAt) : 'never'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {lastRun ? (
                          <RunStateBadge run={lastRun} />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                        {lastRun?.changeType && (
                          <span className="ml-2 text-[10px] text-muted">{lastRun.changeType}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {!src ? (
                          <span className="text-red-400 text-[10px]">missing</span>
                        ) : stable ? (
                          <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 text-[10px]">
                            stable
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 text-[10px]">
                            unstable · {failRatePct}% fail
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted">
                            every {src?.checkFrequencyHours ?? '?'}h
                            {src && src.baseFrequencyHours !== src.checkFrequencyHours && (
                              <span className="text-orange-400 ml-1" title="Adaptive scheduling active">
                                (base {src.baseFrequencyHours}h)
                              </span>
                            )}
                          </span>
                          {src?.switchedToFallback && (
                            <span className="text-[10px] text-orange-400" title={`Original: ${src.originalPrimaryUrl}`}>
                              on fallback
                            </span>
                          )}
                          {(src?.pdfsProcessed ?? 0) > 0 && (
                            <span className="text-[10px] text-green-400">
                              {src?.pdfsProcessed} PDFs
                            </span>
                          )}
                          {(src?.fallbackUrls?.length ?? 0) > 0 && (
                            <span className="text-[10px] text-muted/60" title={src?.fallbackUrls?.join('\n')}>
                              +{src?.fallbackUrls?.length} fallback{(src?.fallbackUrls?.length ?? 0) > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* V6 Reliability + deep-extraction */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Pipeline reliability (V6)</div>
          <div className="text-2xl font-bold mb-2">
            {failureBreakdown.reduce((a, b) => a + b._count, 0)}
            <span className="text-sm text-muted ml-2">failed runs classified</span>
          </div>
          <div className="space-y-1 text-[11px]">
            {failureBreakdown.length === 0 && (
              <div className="text-muted">No failed runs recorded.</div>
            )}
            {failureBreakdown.map((f) => (
              <div key={f.failureType ?? 'unknown'} className="flex items-center justify-between">
                <span className="text-muted">{f.failureType ?? 'unclassified'}</span>
                <span className="font-medium">{f._count}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted italic mt-2">
            V6 fetcher retries up to 2× with UA rotation; classified failures are persisted for diagnosis.
          </p>
        </div>
        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Deep extraction (V6)</div>
          <div className="text-2xl font-bold mb-2">
            {deepVersionTotals._count}
            <span className="text-sm text-muted ml-2">versions with mapping rules fired</span>
          </div>
          <div className="text-[11px] text-muted">
            High-confidence (numeric + directional) versions:{' '}
            <span className="text-green-400 font-medium">{highConfVersionCount}</span>
          </div>
          <p className="text-[10px] text-muted italic mt-2">
            V6 deep pipelines (US, EU trade, Germany climate, UK climate) fetch full policy pages and parse
            numeric values + action verbs before scoring.
          </p>
        </div>
      </div>

      {/* V11 self-diagnostics */}
      <div className="mb-8 p-5 rounded-xl bg-surface border border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-muted uppercase tracking-wider">System self-diagnostics (V11)</div>
        </div>
        {await (async () => {
          const [stuckItems, pdfSum, switched, avgPendingAge] = await Promise.all([
            prisma.reviewQueueItem.count({
              // eslint-disable-next-line react-hooks/purity -- async server component: rendered once per request, Date.now() is the request time
              where: { status: 'pending', createdAt: { lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
            }),
            prisma.monitoredSource.aggregate({ _sum: { pdfsProcessed: true } }),
            prisma.monitoredSource.count({ where: { switchedToFallback: true } }),
            prisma.$queryRaw<Array<{ avg: number | null }>>`
              SELECT AVG(EXTRACT(EPOCH FROM (NOW() - created_at)))::float AS avg
              FROM review_queue WHERE status = 'pending'
            `,
          ]);
          const avgPendingHrs = avgPendingAge[0]?.avg ? (avgPendingAge[0].avg / 3600).toFixed(1) : '—';
          return (
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <div className={`text-2xl font-bold ${stuckItems > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                  {stuckItems}
                </div>
                <div className="text-[11px] text-muted">Stuck items (&gt;48h)</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{avgPendingHrs}h</div>
                <div className="text-[11px] text-muted">Avg pending age</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${(pdfSum._sum.pdfsProcessed ?? 0) > 0 ? 'text-green-400' : 'text-muted'}`}>
                  {pdfSum._sum.pdfsProcessed ?? 0}
                </div>
                <div className="text-[11px] text-muted">PDFs processed</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${switched > 0 ? 'text-orange-400' : 'text-muted'}`}>
                  {switched}
                </div>
                <div className="text-[11px] text-muted">Sources on fallback (auto-switched)</div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* V8 source stability */}
      <div className="mb-8 p-5 rounded-xl bg-surface border border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-muted uppercase tracking-wider">Source stability (V8)</div>
          <div className="text-[10px] text-muted">
            rolling window: last 10 runs · unstable threshold: ≥50% failure
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-2xl font-bold text-green-400">
              {allSources.length - unstableSources}
            </div>
            <div className="text-[11px] text-muted">Stable sources</div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${unstableSources > 0 ? 'text-orange-400' : 'text-muted'}`}>
              {unstableSources}
            </div>
            <div className="text-[11px] text-muted">Unstable (auto-flagged)</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{fallbackCapable}</div>
            <div className="text-[11px] text-muted">Sources with fallback URLs</div>
          </div>
        </div>
      </div>

      {/* V7 evidence tier breakdown + partial_success counter */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Evidence tiers (V7)</div>
          <div className="space-y-1.5 text-xs mt-2">
            {(['strong', 'medium', 'weak'] as const).map((tier) => {
              const row = evidenceTierBreakdown.find((r) => r.evidenceType === tier);
              const c = row?._count ?? 0;
              const style =
                tier === 'strong'
                  ? 'bg-green-500/15 text-green-400'
                  : tier === 'medium'
                  ? 'bg-yellow-500/15 text-yellow-400'
                  : 'bg-gray-500/15 text-gray-400';
              return (
                <div key={tier} className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${style}`}>{tier}</span>
                  <span className="font-medium">{c} versions</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted italic mt-2">
            <span className="text-green-400">strong</span> = numeric + directional (full magnitude) ·{' '}
            <span className="text-yellow-400">medium</span> = action + keyword (reduced magnitude) ·{' '}
            <span>weak</span> = review only
          </p>
        </div>
        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Graceful degradation (V7)</div>
          <div className="text-2xl font-bold mb-2">
            {partialSuccessRuns}
            <span className="text-sm text-muted ml-2">partial_success runs</span>
          </div>
          <p className="text-[10px] text-muted italic mt-2">
            Index-level snapshot persisted but deep items failed. The source is still being monitored; only the
            per-item extraction is degraded. Fallback URLs are tried automatically.
          </p>
        </div>
      </div>

      {/* Evidence-backed submetrics + feed status */}
      <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Evidence-backed submetrics</div>
          <div className="text-2xl font-bold mb-2">
            {evidenceBacked} / {totalSubmetrics}
            <span className="text-sm text-muted ml-2">({evidenceBackedPct}%)</span>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-2 overflow-hidden mb-2">
            <div
              className="h-full rounded-full bg-green-400"
              style={{ width: `${evidenceBackedPct}%` }}
            />
          </div>
          <p className="text-[10px] text-muted">
            Submetrics flip from “seeded baseline” to “evidence-backed” when a real PolicyVersion nudges them through the scoring engine.
          </p>
        </div>
        <div className="p-5 rounded-xl bg-surface border border-border">
          <div className="text-xs text-muted mb-1 uppercase tracking-wider">Feed ingestion</div>
          <div className="text-2xl font-bold mb-2">{feedTotal}</div>
          <div className="text-[11px] text-muted mb-2">
            items stored from official RSS/Atom feeds · provenance label: <span className="text-foreground">official_feed</span>
          </div>
          {recentFeedItems.length > 0 ? (
            <div className="space-y-1">
              {recentFeedItems.slice(0, 3).map((it) => (
                <div key={it.id} className="text-[11px] truncate">
                  <span className="text-muted">{relativeTime(it.publishedAt)} · </span>
                  <a href={it.url ?? '#'} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {it.title}
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-muted">
              No feed items ingested yet. Trigger via <code className="text-foreground">/api/feeds/ingest</code>.
            </div>
          )}
        </div>
      </div>

      {/* V9 Auto-resolution */}
      <div className="mb-8 p-5 rounded-xl bg-surface border border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-muted uppercase tracking-wider">Auto-resolution (V9)</div>
            <div className="text-[10px] text-muted mt-1">
              rules: repeated_signal · multi_source · time_confirmed (&gt;48h) · conflict_detected · low_confidence_aged_out (5d)
            </div>
          </div>
          <AutoResolveActions />
        </div>
        <div className="grid grid-cols-5 gap-3 text-xs">
          {(['auto_approved', 'escalated', 'conflict', 'merged', 'expired'] as const).map((status) => {
            const row = autoResolutionCounts.find((r) => r.status === status);
            const count = row?._count ?? 0;
            const tone: Record<string, string> = {
              auto_approved: 'text-green-400',
              escalated: 'text-teal-400',
              conflict: 'text-red-400',
              merged: 'text-blue-400',
              expired: 'text-gray-400',
            };
            return (
              <div key={status}>
                <div className={`text-lg font-bold ${tone[status]}`}>{count}</div>
                <div className="text-[11px] text-muted">{status.replace(/_/g, ' ')}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-[10px] text-muted">
          {resolvedRecently} items auto-resolved in the last 7 days · adaptive daily cap: max(5, ⌊pipelines/2⌋) per country/domain · force-resolution guarantee: 72h
        </div>
        {/* V10 pending breakdown */}
        {pendingByReason.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <div className="text-[10px] text-muted uppercase tracking-wider mb-1">
              Pending items by blocking reason (V10)
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {pendingByReason.map((r) => (
                <span
                  key={r.finalDecisionReason ?? 'unresolved'}
                  className="px-2 py-0.5 rounded bg-surface-2 border border-border"
                >
                  {(r.finalDecisionReason ?? 'awaiting signal').replace(/_/g, ' ')}:{' '}
                  <span className="font-medium">{r._count}</span>
                </span>
              ))}
              {forcedResolutionsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30">
                  forced resolutions: {forcedResolutionsCount}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Review Queue */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Review Queue</h2>
        <ReviewQueueActions items={reviewItems.map((r) => ({
          id: r.id,
          targetType: r.targetType,
          status: r.status,
          priority: r.priority,
          confidence: r.confidence,
          summary: r.summary,
          recommendedAction: r.recommendedAction,
          createdAt: r.createdAt.toISOString(),
          contributionTitle: r.contribution?.title ?? null,
          countryName: r.contribution?.country?.name ?? null,
          countryIso: r.contribution?.country?.iso2 ?? null,
          domain: r.contribution?.domain ?? null,
          sourceUrl: r.contribution?.sourceUrl ?? null,
          autoResolution: r.autoResolution,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          occurrenceCount: r.occurrenceCount,
          finalDecisionReason: r.finalDecisionReason,
          nextActionAt: r.nextActionAt?.toISOString() ?? null,
          blockingFactors: r.blockingFactors,
          resolutionTrace: (r.resolutionTrace as Array<{ step: string; reason: string; at: string; rule?: string }> | null) ?? null,
          priorityScore: r.priorityScore ?? 0,
          multiSourceConfidence: r.multiSourceConfidence ?? null,
        }))} />
      </div>

      {/* 3b. Market-linkable policy events awaiting review */}
      {await (async () => {
        const [pending, recent] = await Promise.all([
          prisma.policyEvent.findMany({
            where: { relevant: true, reviewStatus: 'pending' },
            orderBy: { eventInstant: 'desc' },
            take: 50,
          }),
          prisma.policyEvent.findMany({
            where: { relevant: true, reviewStatus: { in: ['approved', 'rejected'] } },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          }),
        ]);
        const toRow = (e: (typeof pending)[number]) => ({
          externalId: e.externalId,
          eventType: e.eventType,
          direction: e.direction,
          eventInstant: e.eventInstant.toISOString(),
          title: e.title,
          htmlUrl: e.htmlUrl,
          reviewStatus: e.reviewStatus,
          reviewNote: e.reviewNote,
          firedRules: ((e.raw as { firedRules?: string[] } | null)?.firedRules ?? []).slice(0, 8),
        });
        return (
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-1">Policy Event Review</h2>
            <p className="text-xs text-muted mb-4">
              Relevant Federal Register events from the daily ingest ({pending.length} pending). Keep only rules whose
              subject is Chinese semiconductors / advanced computing — same standard as the frozen v1 set. Approved events
              feed the out-of-sample test in research/hypotheses_v2_exploratory.json.
            </p>
            <EventReviewActions items={[...pending.map(toRow), ...recent.map(toRow)]} />
          </div>
        );
      })()}

      {/* 4. Audit Log */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Recent Audit Log</h2>
        <div className="rounded-xl bg-surface border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">When</th>
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                  <th className="text-left px-4 py-3 font-medium">Entity</th>
                  <th className="text-left px-4 py-3 font-medium">Summary</th>
                  <th className="text-left px-4 py-3 font-medium">Actor</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-xs text-muted">
                      No audit entries yet.
                    </td>
                  </tr>
                )}
                {auditEntries.map((e) => (
                  <tr key={e.id} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                      {relativeTime(e.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <ActionBadge action={e.actionType} />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="text-muted">{e.entityType}:</span>{' '}
                      <span className="font-medium">{e.entityId.slice(0, 12)}…</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted max-w-md truncate">
                      {e.summary ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-muted whitespace-nowrap">
                      {e.actorType ?? 'system'}
                      {e.actorId ? `:${e.actorId}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 5. Pipeline Runs */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Pipeline Runs</h2>
        <PipelineActions />
        {recentRuns.length === 0 ? (
          <p className="text-sm text-muted">No pipeline runs recorded yet. Click the button above to trigger one.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentRuns.map((run) => (
              <div key={run.id} className="p-4 rounded-xl bg-surface border border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">{run.pipelineKey}</span>
                  <RunStateBadge run={run} />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Started</span>
                    <span className="font-medium">{relativeTime(run.startedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Completed</span>
                    <span className="font-medium">{relativeTime(run.completedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Items processed</span>
                    <span className="font-medium">{run.itemsProcessed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Changed / flagged</span>
                    <span className="font-medium">
                      {run.itemsChanged} / {run.itemsFlagged}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Change type</span>
                    <span className="font-mono">{run.changeType ?? '—'}</span>
                  </div>
                  {run.errorMessage && (
                    <div className="mt-2 px-2 py-1 rounded bg-red-500/10 text-red-400 text-[11px] break-words">
                      {run.errorMessage}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. Score Changes */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Recent Score Changes</h2>
        {recentScoreChanges.length === 0 ? (
          <p className="text-sm text-muted">
            No score changes logged yet. These are written when a high-confidence policy version lands with non-zero impact.
          </p>
        ) : (
          <div className="rounded-xl bg-surface border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">When</th>
                  <th className="text-left px-4 py-3 font-medium">Country / Domain</th>
                  <th className="text-left px-4 py-3 font-medium">Previous</th>
                  <th className="text-left px-4 py-3 font-medium">New</th>
                  <th className="text-left px-4 py-3 font-medium">Δ</th>
                  <th className="text-left px-4 py-3 font-medium">Explanation</th>
                </tr>
              </thead>
              <tbody>
                {recentScoreChanges.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                      {relativeTime(c.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-medium">{c.country.iso2}</span>{' '}
                      <span className="text-muted">/ {c.domain}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">{c.previousScore.toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs font-mono">{c.newScore.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-xs font-mono ${c.delta > 0 ? 'text-green-400' : c.delta < 0 ? 'text-red-400' : 'text-muted'}`}>
                      {c.delta > 0 ? '+' : ''}{c.delta.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted max-w-sm truncate">
                      {c.explanation ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 7. Overdue Sources */}
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">Overdue Source Checks</h2>
        {overdueSources.length === 0 ? (
          <p className="text-sm text-muted">No overdue source checks.</p>
        ) : (
          <div className="rounded-xl bg-surface border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted uppercase tracking-wider">
                    <th className="text-left px-4 py-3 font-medium">Source</th>
                    <th className="text-left px-4 py-3 font-medium">Country</th>
                    <th className="text-left px-4 py-3 font-medium">Domain</th>
                    <th className="text-left px-4 py-3 font-medium">Last checked</th>
                    <th className="text-left px-4 py-3 font-medium">Last hash</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueSources.map((s) => (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-surface-2/30 transition-colors">
                      <td className="px-4 py-3 font-medium max-w-xs truncate">{s.sourceName}</td>
                      <td className="px-4 py-3 text-xs">{s.country.name}</td>
                      <td className="px-4 py-3 text-xs text-muted">{s.domain}</td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                        {relativeTime(s.lastCheckedAt)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted">
                        {shortHash(s.lastHash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
