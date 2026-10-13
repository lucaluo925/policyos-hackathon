/**
 * GET /api/feeds/latest — returns the most recent feed-ingested news items.
 *
 * This is the DB-backed counterpart to the seeded curated dataset rendered
 * by /news. It only returns rows with `ingestionType='rss_feed'` so the UI
 * can show live official updates distinctly and honestly.
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured, getPrisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ items: [] });
  }
  const prisma = getPrisma();
  const items = await prisma.newsArticle.findMany({
    where: { ingestionType: 'rss_feed' },
    orderBy: { publishedAt: 'desc' },
    take: 25,
  });
  return NextResponse.json({
    items: items.map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description,
      source: it.source,
      url: it.url,
      publishedAt: it.publishedAt.toISOString(),
      domain: it.domain,
      provenance: it.provenance,
    })),
  });
}
