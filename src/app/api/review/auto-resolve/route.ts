/**
 * POST or GET /api/review/auto-resolve
 *
 * Runs the V9 review-queue auto-resolution engine. Intended to be invoked
 * by a daily cron, but also safe to hit manually. Returns a structured
 * outcome showing how many items were collapsed, auto-approved, conflicted,
 * or aged out.
 */

import { NextResponse } from 'next/server';
import { isCronOrAdmin } from '@/lib/auth/admin';
import { isDatabaseConfigured } from '@/lib/db';
import { autoResolveReviewQueue } from '@/lib/review/auto-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request) {
  // Cron (Bearer CRON_SECRET) or the admin UI's "Run auto-resolve" button (admin cookie).
  if (!(await isCronOrAdmin(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured.' },
      { status: 503 },
    );
  }
  const startedAt = new Date().toISOString();
  const outcome = await autoResolveReviewQueue();
  return NextResponse.json({ startedAt, outcome });
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
