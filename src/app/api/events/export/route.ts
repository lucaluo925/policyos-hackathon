/**
 * GET /api/events/export[?relevant=1][&approved=1]
 *
 * CSV export of policy_events for the research layer (event study).
 * Read-only; the data is public Federal Register metadata.
 */

import { isDatabaseConfigured, prisma } from '@/lib/db/client';
import { csvCell } from '@/lib/events/csv';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  'source', 'externalId', 'agency', 'docType', 'publicationDate', 'publicInspectionAt',
  'eventInstant', 'eventTimeSource', 'eventType', 'chinaRelated', 'semisRelated',
  'direction', 'relevant', 'taggerVersion', 'reviewStatus', 'title', 'htmlUrl',
] as const;

export async function GET(req: Request) {
  if (!isDatabaseConfigured()) {
    return new Response('DATABASE_URL not configured', { status: 503 });
  }
  const url = new URL(req.url);
  const where: Record<string, unknown> = {};
  if (url.searchParams.get('relevant') === '1') where.relevant = true;
  if (url.searchParams.get('approved') === '1') where.reviewStatus = { in: ['approved', 'auto_approved'] };

  const rows = await prisma.policyEvent.findMany({ where, orderBy: { eventInstant: 'asc' } });
  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      COLUMNS.map((c) => {
        const v = (r as Record<string, unknown>)[c];
        if (v instanceof Date) return c === 'publicationDate' ? v.toISOString().slice(0, 10) : v.toISOString();
        return csvCell(v);
      }).join(','),
    );
  }
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="policy_events.csv"',
    },
  });
}
