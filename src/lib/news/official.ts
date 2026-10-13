/**
 * Official government updates (RSS/Atom feeds ingested into news_articles
 * with ingestionType='rss_feed'). This is the only news the public site
 * shows — every item links to the government page it came from.
 */
import type { Domain } from '@prisma/client';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';
import { feedLang, resolveFeedItem } from '@/lib/feeds/registry';

export interface OfficialItem {
  id: string;
  title: string;
  description: string | null;
  source: string;
  url: string | null;
  publishedAt: string;
  domain: Domain;
  countries: string[];
  /** Language the title is published in (ISO 639-1). */
  lang: string;
}

export async function getOfficialNews(opts: { country?: string; domain?: Domain; limit?: number } = {}): Promise<OfficialItem[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const rows = await getPrisma().newsArticle.findMany({
      where: {
        ingestionType: 'rss_feed',
        ...(opts.domain ? { domain: opts.domain } : {}),
        ...(opts.country ? { policyLinks: { some: { countryIso: opts.country.toUpperCase() } } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: opts.limit ?? 60,
      include: { policyLinks: { select: { countryIso: true } } },
    });
    const out: OfficialItem[] = [];
    for (const r of rows) {
      const domain = resolveFeedItem(r.feedKey, r.title, r.domain);
      if (!domain || (opts.domain && domain !== opts.domain)) continue;
      out.push({
        id: r.id,
        title: r.title,
        description: r.description,
        source: r.source,
        url: r.url,
        publishedAt: r.publishedAt.toISOString(),
        domain,
        countries: [...new Set(r.policyLinks.map((l) => l.countryIso).filter((c): c is string => !!c))],
        lang: feedLang(r.feedKey),
      });
    }
    return out;
  } catch {
    return [];
  }
}
