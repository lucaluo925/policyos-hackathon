/**
 * Pipeline registry listing.
 *
 * GET /api/pipeline — returns every registered pipeline with coverage,
 * last run (if any), and monitored source state. Backs the admin coverage
 * matrix.
 */

import { privateJson } from '@/lib/auth/private-response';
import { isAdminRequest } from '@/lib/auth/admin';
import { isDatabaseConfigured, getPrisma } from '@/lib/db';
import { PIPELINE_COVERAGE } from '@/lib/pipeline/coverage';
import { listPipelines } from '@/lib/pipeline/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return privateJson({ error: 'unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) {
    return privateJson(
      { error: 'DATABASE_URL not configured.' },
      { status: 503 },
    );
  }

  try {
    const prisma = getPrisma();
    const registered = listPipelines();

    const rows = await Promise.all(
      registered.map(async (def) => {
        const coverage = PIPELINE_COVERAGE.find((c) => c.pipelineKey === def.key);
        const source = await prisma.monitoredSource.findFirst({
          where: { pipelineKey: def.key },
          include: { country: true },
        });
        const lastRun = await prisma.pipelineRun.findFirst({
          where: { pipelineKey: def.key },
          orderBy: { startedAt: 'desc' },
        });
        return {
          key: def.key,
          label: def.label,
          countryIso: coverage?.countryIso ?? null,
          domain: coverage?.domain ?? null,
          sourceUrl: coverage?.sourceUrl ?? source?.sourceUrl ?? null,
          sourceName: coverage?.sourceName ?? source?.sourceName ?? null,
          schedule: coverage?.schedule ?? 'manual',
          monitoredSourceId: source?.id ?? null,
          sourceProvisioned: !!source,
          lastCheckedAt: source?.lastCheckedAt?.toISOString() ?? null,
          lastHash: source?.lastHash ?? null,
          lastRun: lastRun
            ? {
                id: lastRun.id,
                status: lastRun.status,
                changeDetected: lastRun.changeDetected,
                changeType: lastRun.changeType,
                startedAt: lastRun.startedAt.toISOString(),
                completedAt: lastRun.completedAt?.toISOString() ?? null,
              }
            : null,
        };
      }),
    );

    return privateJson({
      total: rows.length,
      pipelines: rows,
    });
  } catch {
    return privateJson({ error: 'Internal server error' }, { status: 500 });
  }
}
