/**
 * V5 diagnostic — runs the keyword → submetric mapper against current data
 * and reports fire rates. Does not mutate the DB.
 *
 * Shows three things:
 *   1. Deep-extracted PolicyVersions with their (possibly empty) rule hits
 *   2. RSS feed items re-run through the mapper for their domain — fire
 *      rates show whether the infrastructure *can* match real text, even
 *      if it didn't fire on today's USCIS chapter index.
 *   3. Which rules would fire + with what confidence on sample text.
 */

import { PrismaClient } from '@prisma/client';
import { mapTextToSubmetrics } from '../src/lib/scoring/mapping';

const p = new PrismaClient();

async function main() {
  const feedItems = await p.newsArticle.findMany({
    where: { ingestionType: 'rss_feed' },
    take: 25,
    orderBy: { publishedAt: 'desc' },
    select: { id: true, title: true, description: true, domain: true, source: true },
  });

  let fireCount = 0;
  const ruleFires = new Map<string, number>();
  const examples: Array<{ title: string; rules: string[]; hints: number }> = [];
  for (const it of feedItems) {
    const text = `${it.title}. ${it.description ?? ''}`;
    const m = mapTextToSubmetrics(text, it.domain);
    if (m.mappingRules.length) {
      fireCount++;
      for (const r of m.mappingRules) ruleFires.set(r, (ruleFires.get(r) ?? 0) + 1);
      examples.push({ title: it.title.slice(0, 80), rules: m.mappingRules, hints: m.hints.length });
    }
  }

  const deepVersions = await p.policyVersion.findMany({
    where: { extractionMethod: 'deterministic' },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      summary: true,
      mappingRules: true,
      affectedSubmetrics: true,
      policyType: true,
      policy: { select: { country: { select: { iso2: true } }, domain: true } },
    },
  });
  const withRules = deepVersions.filter((v) => v.mappingRules.length > 0);

  console.log(JSON.stringify({
    feed_mapping: {
      scanned: feedItems.length,
      items_with_rule_matches: fireCount,
      fire_rate_pct: feedItems.length ? ((fireCount / feedItems.length) * 100).toFixed(1) : '0',
      top_rules: [...ruleFires.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      examples: examples.slice(0, 6),
    },
    deep_versions: {
      total_with_extractionMethod: deepVersions.length,
      with_nonempty_mappingRules: withRules.length,
      samples_with_rules: withRules.slice(0, 5).map((v) => ({
        summary: v.summary?.slice(0, 100),
        rules: v.mappingRules,
        submetrics: v.affectedSubmetrics,
        policyType: v.policyType,
        country: v.policy.country.iso2,
      })),
    },
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
