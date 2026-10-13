/**
 * Canada immigration pipeline endpoint.
 *
 * Delegates to the reusable pipeline framework (src/lib/pipeline) and
 * persists results via Prisma (src/lib/db). When DATABASE_URL is not set,
 * returns a 503 with a clear error rather than silently writing to memory —
 * in V3 we treat "no DB" as a production misconfiguration.
 *
 * Supports ?trigger=cron for the daily Vercel cron job.
 */

import { NextResponse } from 'next/server';
import { isCronOrAdmin } from '@/lib/auth/admin';
import { isDatabaseConfigured, sourceRepo } from '@/lib/db';
import { runPipeline } from '@/lib/pipeline/runner';
import { getPipeline } from '@/lib/pipeline/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PIPELINE_KEY = 'canada-immigration';

export async function GET(request: Request): Promise<Response> {
  if (!(await isCronOrAdmin(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        pipeline: PIPELINE_KEY,
        executedAt: startedAt,
        durationMs: Date.now() - startMs,
        status: 'skipped',
        error:
          'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace (Neon/Supabase/Prisma Postgres) to enable the live pipeline.',
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const trigger = url.searchParams.get('trigger') === 'cron' ? 'cron' : 'manual';

  try {
    const def = getPipeline(PIPELINE_KEY);
    if (!def) {
      return NextResponse.json(
        { error: `Pipeline not registered: ${PIPELINE_KEY}` },
        { status: 500 },
      );
    }

    const source = await sourceRepo.getSourceByPipelineKey(PIPELINE_KEY);
    if (!source) {
      return NextResponse.json(
        {
          error: `No monitored source with pipelineKey=${PIPELINE_KEY}. Run \`npm run db:seed\` to provision it.`,
        },
        { status: 500 },
      );
    }

    const outcome = await runPipeline(def, {
      id: source.id,
      countryIso: source.country.iso2,
      pipelineKey: PIPELINE_KEY,
      sourceUrl: source.sourceUrl,
      sourceName: source.sourceName,
      domain: 'immigration',
      lastHash: source.lastHash,
    });

    return NextResponse.json({
      pipeline: PIPELINE_KEY,
      sourceUrl: source.sourceUrl,
      trigger,
      executedAt: startedAt,
      durationMs: Date.now() - startMs,
      status: outcome.status,
      changeDetected: outcome.changeDetected,
      classification: outcome.classification,
      summary: outcome.summary,
      runId: outcome.runId,
      policyId: outcome.policyId,
      versionId: outcome.versionId,
      reviewItemId: outcome.reviewItemId,
      scoreChangeLogId: outcome.scoreChangeLogId,
      hash: outcome.hash,
      previousHash: outcome.previousHash,
      error: outcome.error,
    }, { status: outcome.status === 'failed' ? 500 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        pipeline: PIPELINE_KEY,
        executedAt: startedAt,
        durationMs: Date.now() - startMs,
        status: 'failed',
        error: message,
      },
      { status: 500 },
    );
  }
}
