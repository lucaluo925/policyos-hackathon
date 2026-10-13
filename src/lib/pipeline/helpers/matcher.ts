/**
 * Shared policy matcher.
 *
 * Given a source context + parsed signal, find an existing Policy to attach
 * a new version to, or emit a create-shell request. The previous matcher
 * only ever "createPolicy" with a fixed slug; this one tries, in order:
 *
 *   1. Exact match by Policy.officialSourceUrl == source.sourceUrl
 *      (strongest — same URL → same policy)
 *   2. Match by fixed canonical slug ({pipelineKey}) per-country (stable
 *      across runs; avoids duplicate policies for the same source).
 *   3. Fuzzy title-similarity (case-insensitive substring match) against
 *      policies in the same country+domain.
 *   4. Fall back to createPolicy.
 *
 * A match counts as "high-confidence" only if it came from rule 1 or 2; rule
 * 3 is logged as `matchConfidence: 'medium'` so the runner can decide to
 * escalate to review.
 */

import { prisma } from '@/lib/db/client';
import type { Domain } from '@prisma/client';
import type { MatchedPolicy, ParsedSignal, SourceContext } from '../framework';

export interface ExtendedMatch extends MatchedPolicy {
  matchMethod: 'exact_url' | 'canonical_slug' | 'fuzzy_title' | 'new';
  matchConfidence: 'high' | 'medium' | 'low';
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaccard-like token overlap; 0..1. */
function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(' ').filter((w) => w.length > 3));
  const tb = new Set(normalizeTitle(b).split(' ').filter((w) => w.length > 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

export async function matchExistingPolicy(
  ctx: SourceContext,
  signal: ParsedSignal,
  opts: {
    canonicalSlug: string;
    defaultTitle: string;
    defaultSummary?: string;
  },
): Promise<ExtendedMatch> {
  // 1. Exact URL match on official_source_url.
  const country = await prisma.country.findFirst({
    where: { OR: [{ iso2: ctx.countryIso.toUpperCase() }, { iso3: ctx.countryIso.toUpperCase() }] },
    select: { id: true },
  });
  if (!country) {
    return {
      matchMethod: 'new',
      matchConfidence: 'low',
      createPolicy: {
        slug: opts.canonicalSlug,
        title: signal.title ?? opts.defaultTitle,
        summary: signal.summary ?? opts.defaultSummary,
      },
    };
  }

  const byUrl = await prisma.policy.findFirst({
    where: {
      countryId: country.id,
      domain: ctx.domain as Domain,
      officialSourceUrl: ctx.sourceUrl,
    },
    select: { id: true },
  });
  if (byUrl) {
    return { matchMethod: 'exact_url', matchConfidence: 'high', policyId: byUrl.id };
  }

  // 2. Canonical slug match — stable per-pipeline per-country.
  const bySlug = await prisma.policy.findFirst({
    where: { countryId: country.id, slug: opts.canonicalSlug },
    select: { id: true },
  });
  if (bySlug) {
    return { matchMethod: 'canonical_slug', matchConfidence: 'high', policyId: bySlug.id };
  }

  // 3. Fuzzy title match, only when we have a decent title.
  if (signal.title && signal.title.length >= 8) {
    const candidates = await prisma.policy.findMany({
      where: { countryId: country.id, domain: ctx.domain as Domain },
      select: { id: true, title: true },
      take: 50,
    });
    let best: { id: string; score: number } | null = null;
    for (const c of candidates) {
      const score = titleSimilarity(signal.title, c.title);
      if (score > (best?.score ?? 0)) best = { id: c.id, score };
    }
    if (best && best.score >= 0.65) {
      return {
        matchMethod: 'fuzzy_title',
        matchConfidence: best.score >= 0.85 ? 'high' : 'medium',
        policyId: best.id,
      };
    }
  }

  // 4. New canonical policy shell.
  return {
    matchMethod: 'new',
    matchConfidence: 'medium',
    createPolicy: {
      slug: opts.canonicalSlug,
      title: signal.title ?? opts.defaultTitle,
      summary: signal.summary ?? opts.defaultSummary,
    },
  };
}
