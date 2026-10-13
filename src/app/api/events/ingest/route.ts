/**
 * GET /api/events/ingest[?days=14]
 *
 * Daily cron: pulls the last `days` of Federal Register BIS/USTR documents,
 * tags them with the frozen fr-tagger-v2, resolves public-inspection times
 * for relevant candidates, and upserts into policy_events. New events land
 * with reviewStatus=pending — nothing is auto-approved into the study. This
 * is how the out-of-sample set for research/hypotheses_v2_exploratory.json
 * accumulates.
 *
 * Auth: if CRON_SECRET is set, requires `Authorization: Bearer <CRON_SECRET>`
 * (Vercel Cron sends this automatically).
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured, prisma } from '@/lib/db/client';
import { collectFrEvents } from '@/lib/events/collect';
import { retryingFetcher } from '@/lib/events/federal-register';
import { upsertPolicyEvents } from '@/lib/events/persist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if ((!secret && process.env.NODE_ENV === 'production') ||
      (secret && request.headers.get('authorization') !== `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ status: 'skipped', error: 'DATABASE_URL not configured.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const days = Math.min(60, Math.max(1, Number(url.searchParams.get('days') ?? 14) || 14));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const startMs = Date.now();

  try {
    const { records, piHits } = await collectFrEvents({
      from: ymd(from),
      to: ymd(to),
      fetcher: retryingFetcher,
      delayMs: 100,
    });
    const created = await upsertPolicyEvents(prisma, records);
    const newRelevant = records.filter((r) => r.relevant && created.includes(r.externalId));
    return NextResponse.json({
      status: 'success',
      window: { from: ymd(from), to: ymd(to) },
      documents: records.length,
      relevant: records.filter((r) => r.relevant).length,
      created: created.length,
      newRelevantPendingReview: newRelevant.map((r) => ({
        externalId: r.externalId,
        eventType: r.eventType,
        direction: r.direction,
        eventInstant: r.eventInstant,
        title: r.title,
      })),
      publicInspectionHits: piHits,
      durationMs: Date.now() - startMs,
    });
  } catch (e) {
    return NextResponse.json(
      { status: 'failed', error: (e as Error).message, durationMs: Date.now() - startMs },
      { status: 500 },
    );
  }
}
