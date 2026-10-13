/**
 * Audit log API — append-only read endpoint backed by the audit_logs table.
 *
 * Every mutating API route and every pipeline run writes at least one audit
 * row, so this endpoint is the canonical timeline of system activity.
 */

import { privateJson } from '@/lib/auth/private-response';
import { isAdminRequest } from '@/lib/auth/admin';
import { isDatabaseConfigured, auditRepo } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return privateJson({ error: 'unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) {
    return privateJson(
      {
        error:
          'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace to enable the audit log.',
      },
      { status: 503 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get('entityId') ?? undefined;
    const entityType = searchParams.get('entityType') ?? undefined;
    const limitParam = searchParams.get('limit');
    let limit: number | undefined;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1) {
        return privateJson(
          { error: 'Invalid limit parameter. Must be a positive integer.' },
          { status: 400 },
        );
      }
      limit = Math.min(parsed, 500);
    }

    const entries = await auditRepo.listAuditMetadata({
      entityId,
      entityType,
      limit: limit ?? 100,
    });

    return privateJson({
      entries: entries.map(entry => ({ ...entry, actorId: '[redacted]' })),
      count: entries.length,
      filters: {
        entityId: entityId ?? 'all',
        entityType: entityType ?? 'all',
        limit: limit ?? 100,
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
