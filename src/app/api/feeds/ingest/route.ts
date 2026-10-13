/**
 * Feed ingestion endpoint.
 *
 *   GET /api/feeds/ingest            — ingest all registered feeds
 *   GET /api/feeds/ingest?key=<feed> — ingest a single feed
 *
 * Writes go to the `news_articles` table with `ingestionType='rss_feed'`
 * and `provenance='official_feed'`, so the news UI can honestly distinguish
 * live government announcements from seeded historical context.
 *
 * Protected by CRON_SECRET when set (Bearer token header).
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import { FEED_REGISTRY, getFeed } from '@/lib/feeds/registry';
import { ingestFeed } from '@/lib/feeds/ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
      { error: 'DATABASE_URL not configured.' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const startedAt = new Date().toISOString();

  if (key) {
    const feed = getFeed(key);
    if (!feed) {
      return NextResponse.json(
        { error: `Unknown feed key: ${key}` },
        { status: 404 },
      );
    }
    const outcome = await ingestFeed(feed);
    return NextResponse.json({ startedAt, feeds: [outcome] });
  }

  // Feeds are independent; run a few at a time so one slow government
  // server doesn't push the whole run past the function time limit.
  const outcomes: Awaited<ReturnType<typeof ingestFeed>>[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < FEED_REGISTRY.length; i += CONCURRENCY) {
    outcomes.push(...(await Promise.all(FEED_REGISTRY.slice(i, i + CONCURRENCY).map((f) => ingestFeed(f)))));
  }
  const totals = outcomes.reduce(
    (acc, o) => {
      acc.fetched += o.fetched;
      acc.inserted += o.inserted;
      acc.updated += o.updated;
      acc.skipped += o.skipped;
      acc.errors += o.errors.length;
      return acc;
    },
    { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 },
  );

  return NextResponse.json({ startedAt, totals, feeds: outcomes });
}
