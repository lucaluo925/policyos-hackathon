/**
 * Source freshness check — DB-backed.
 *
 * Iterates every active monitored source. Sources past their
 * `checkFrequencyHours` window are reported as overdue. When a source has a
 * registered `pipelineKey` in the pipeline registry, this endpoint also
 * triggers that pipeline — so the daily Vercel cron does the actual work,
 * not just the reporting.
 *
 * Protected by CRON_SECRET when set (so Vercel cron can hit it, anonymous
 * curl cannot once the secret is provisioned).
 */

import { NextResponse } from 'next/server';
import {
  isDatabaseConfigured,
  sourceRepo,
} from '@/lib/db';
import { runPipeline } from '@/lib/pipeline/runner';
import { getPipeline } from '@/lib/pipeline/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV !== 'production';
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace to enable source freshness checks.',
      },
      { status: 503 },
    );
  }

  const checkedAt = new Date().toISOString();

  try {
    const [allActive, overdueSources] = await Promise.all([
      sourceRepo.listActiveSources(),
      sourceRepo.getOverdueSources(),
    ]);

    const overdueIds = new Set(overdueSources.map((s) => s.id));

    // Trigger pipeline runs for overdue sources that have a registered pipeline.
    const pipelineOutcomes: Array<{
      sourceId: string;
      pipelineKey: string;
      status: string;
      changeType: string | null;
      runId: string | null;
      error: string | null;
    }> = [];

    for (const source of overdueSources) {
      if (!source.pipelineKey) continue;
      const def = getPipeline(source.pipelineKey);
      if (!def) continue;

      try {
        const outcome = await runPipeline(def, {
          id: source.id,
          countryIso: source.country.iso2,
          pipelineKey: source.pipelineKey,
          sourceUrl: source.sourceUrl,
          sourceName: source.sourceName,
          domain: source.domain,
          lastHash: source.lastHash,
        });
        pipelineOutcomes.push({
          sourceId: source.id,
          pipelineKey: source.pipelineKey,
          status: outcome.status,
          changeType: outcome.classification ?? null,
          runId: outcome.runId ?? null,
          error: outcome.error ?? null,
        });
      } catch (err) {
        pipelineOutcomes.push({
          sourceId: source.id,
          pipelineKey: source.pipelineKey,
          status: 'failed',
          changeType: null,
          runId: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const sources = allActive.map((s) => ({
      id: s.id,
      name: s.sourceName,
      url: s.sourceUrl,
      countryIso: s.country.iso2,
      domain: s.domain,
      lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      status: overdueIds.has(s.id) ? ('overdue' as const) : ('current' as const),
      pipelineKey: s.pipelineKey,
    }));

    return NextResponse.json({
      pipeline: 'source_freshness',
      checkedAt,
      totalActiveSources: allActive.length,
      overdueCount: overdueSources.length,
      pipelinesTriggered: pipelineOutcomes.length,
      pipelineOutcomes,
      sources,
      message: `${overdueSources.length} of ${allActive.length} active sources are overdue; triggered ${pipelineOutcomes.length} pipeline run(s).`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
