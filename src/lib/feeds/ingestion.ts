/**
 * Feed ingestion driver.
 *
 * Fetches a registered feed, parses entries, and upserts each into
 * `news_articles` keyed by (feed_key, feed_guid). Links each article to its
 * country via PolicyNewsLink.
 *
 * Deduplication: the NewsArticle unique constraint on (feedKey, feedGuid)
 * means running the same feed twice is a safe no-op; updated summaries are
 * patched in place.
 */

import { prisma } from '@/lib/db/client';
import * as auditRepo from '@/lib/db/repositories/audit';
import { parseFeed } from './atom-parser';
import { feedCountries, resolveFeedItem, type FeedRegistryEntry } from './registry';

export interface IngestOutcome {
  feedKey: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  sampleTitles: string[];
}

export async function ingestFeed(feed: FeedRegistryEntry): Promise<IngestOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const outcome: IngestOutcome = {
    feedKey: feed.key,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    sampleTitles: [],
  };

  try {
    const res = await globalThis.fetch(feed.url, {
      headers: {
        'User-Agent': 'PolicyOS/4.0 (+https://policyos-one.vercel.app)',
        Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      outcome.errors.push(`HTTP ${res.status}`);
      return outcome;
    }
    const xml = await res.text();
    const entries = parseFeed(xml);
    outcome.fetched = entries.length;

    for (const entry of entries.slice(0, 25)) {
      if (!Number.isFinite(Date.parse(entry.publishedAt))) { outcome.skipped += 1; continue; }
      const domain = resolveFeedItem(feed.key, entry.title, 'climate');
      if (!domain) {
        outcome.skipped += 1;
        continue;
      }
      try {
        const existing = await prisma.newsArticle.findUnique({
          where: { feedKey_feedGuid: { feedKey: feed.key, feedGuid: entry.guid } },
        });
        if (existing) {
          await prisma.newsArticle.update({
            where: { id: existing.id },
            data: {
              title: entry.title,
              description: entry.summary,
              url: entry.link,
              publishedAt: new Date(entry.publishedAt),
              domain,
            },
          });
          outcome.updated += 1;
        } else {
          const created = await prisma.newsArticle.create({
            data: {
              title: entry.title,
              description: entry.summary,
              source: feed.source,
              url: entry.link,
              publishedAt: new Date(entry.publishedAt),
              domain,
              ingestionType: 'rss_feed',
              provenance: feed.provenance,
              feedKey: feed.key,
              feedGuid: entry.guid,
            },
          });
          await prisma.policyNewsLink.createMany({
            data: feedCountries(feed).map((countryIso) => ({ newsArticleId: created.id, countryIso })),
          });
          outcome.inserted += 1;
          if (outcome.sampleTitles.length < 3) outcome.sampleTitles.push(entry.title);
        }
      } catch (err) {
        outcome.errors.push(err instanceof Error ? err.message : String(err));
        outcome.skipped += 1;
      }
    }

    await auditRepo.append({
      entityType: 'feed',
      entityId: feed.key,
      actionType: 'feed_ingested',
      actorType: 'pipeline',
      actorId: `feed:${feed.key}`,
      sourceUrl: feed.url,
      confidence: 'medium',
      summary: `Ingested ${outcome.inserted} new + ${outcome.updated} updated items from ${feed.source}.`,
      newValue: {
        inserted: outcome.inserted,
        updated: outcome.updated,
        skipped: outcome.skipped,
        fetched: outcome.fetched,
      },
    });
  } catch (err) {
    outcome.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeout);
  }

  return outcome;
}
