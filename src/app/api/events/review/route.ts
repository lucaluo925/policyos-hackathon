/**
 * POST /api/events/review — admin decision on a market-linkable policy event.
 *
 * Body: { externalId: string, status: "approved" | "rejected" | "pending", note?: string }
 * Only reviewStatus / reviewNote change; tagger output is never edited here.
 * Every decision writes an AuditLog row.
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured, prisma } from '@/lib/db/client';
import { isAdminRequest } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['approved', 'rejected', 'pending'] as const;
type Decision = (typeof ALLOWED)[number];

export async function POST(request: Request): Promise<Response> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'DATABASE_URL not configured.' }, { status: 503 });
  }

  let body: { externalId?: unknown; status?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const externalId = typeof body.externalId === 'string' ? body.externalId : '';
  const status = ALLOWED.includes(body.status as Decision) ? (body.status as Decision) : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;
  if (!externalId || !status) {
    return NextResponse.json({ error: 'externalId and status (approved|rejected|pending) are required' }, { status: 400 });
  }

  const before = await prisma.policyEvent.findUnique({
    where: { source_externalId: { source: 'federal_register', externalId } },
    select: { id: true, reviewStatus: true, reviewNote: true },
  });
  if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const reviewNote = note ?? before.reviewNote;
  const after = await prisma.policyEvent.update({
    where: { id: before.id },
    data: { reviewStatus: status, reviewNote },
    select: { externalId: true, reviewStatus: true, reviewNote: true },
  });
  await prisma.auditLog.create({
    data: {
      entityType: 'policy_event',
      entityId: before.id,
      actionType: `review_${status}`,
      previousValue: { reviewStatus: before.reviewStatus, reviewNote: before.reviewNote },
      newValue: { reviewStatus: after.reviewStatus, reviewNote: after.reviewNote },
      actorType: 'admin',
      summary: `policy_event ${externalId} → ${status}`,
    },
  });
  return NextResponse.json({ ok: true, event: after });
}
