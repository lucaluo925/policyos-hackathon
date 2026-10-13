/**
 * Generic pipeline trigger: GET /api/pipeline/:key
 *
 * Replaces the per-country hand-written route. Looks up the registered
 * PipelineDefinition, resolves its MonitoredSource, and runs it via the
 * shared runner — so every pipeline has identical observability (same
 * shaped response, same audit + snapshot writes).
 *
 * The old /api/pipeline/canada-immigration is kept as a thin alias for
 * backward compatibility.
 */

import { NextResponse } from 'next/server';
import { isCronOrAdmin } from '@/lib/auth/admin';
import { isDatabaseConfigured, sourceRepo } from '@/lib/db';
import { getPipeline } from '@/lib/pipeline/registry';
import { runPipeline } from '@/lib/pipeline/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// V6: deep pipelines can fetch 8+ policy pages; raise to the Vercel max.
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  if (!(await isCronOrAdmin(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { key } = await params;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        pipeline: key,
        executedAt: startedAt,
        durationMs: Date.now() - startMs,
        status: 'skipped',
        error: 'DATABASE_URL not configured.',
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const trigger = url.searchParams.get('trigger') === 'cron' ? 'cron' : 'manual';

  const def = getPipeline(key);
  if (!def) {
    return NextResponse.json(
      { error: `Pipeline not registered: ${key}` },
      { status: 404 },
    );
  }

  try {
    const source = await sourceRepo.getSourceByPipelineKey(key);
    if (!source) {
      return NextResponse.json(
        {
          error: `No MonitoredSource with pipelineKey=${key}. Run \`npm run db:seed\` to provision it.`,
        },
        { status: 500 },
      );
    }

    const outcome = await runPipeline(def, {
      id: source.id,
      countryIso: source.country.iso2,
      pipelineKey: key,
      sourceUrl: source.sourceUrl,
      sourceName: source.sourceName,
      domain: source.domain,
      lastHash: source.lastHash,
    });

    return NextResponse.json(
      {
        pipeline: key,
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
      },
      { status: outcome.status === 'failed' ? 500 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        pipeline: key,
        executedAt: startedAt,
        durationMs: Date.now() - startMs,
        status: 'failed',
        error: message,
      },
      { status: 500 },
    );
  }
}
