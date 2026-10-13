/**
 * Canada immigration pipeline — IRCC news releases.
 *
 * V4 note: built from the shared `buildIndexPipeline` factory.
 *
 * 2026-10-10: this pipeline had not fetched successfully in 173 days, and
 * even when it did it only ever kept a meta-record of an index page — it
 * had no `deepItems`, so Canada contributed no policy records at all. The
 * page it watched (…/immigration-refugees-citizenship/news.html) still
 * answers 200 in a browser but carries no article links: canada.ca loads
 * that list from an API.
 *
 * That API is the Government of Canada's own news service, and the project
 * already trusts it — the news registry reads the same endpoint for the
 * same department. So this now reads the Atom form of it and, like the UK
 * and German pipelines, turns the entries into deep items instead of a
 * single meta-record.
 *
 * Why the fetch failed for 173 days is NOT established. The page answers
 * from a browser, so a datacentre-IP or user-agent block is the obvious
 * suspicion, but it is a suspicion; the API request is lighter and is what
 * the site itself expects, which is reason enough to prefer it.
 */

import { parseFeed } from '@/lib/feeds/atom-parser';
import { looksLikeNavLabel } from '../helpers/html-extractor';
import type { DeepItem, ParsedSignal, PipelineDefinition, SourceContext } from '../framework';
import { buildIndexPipeline } from '../helpers/factory';
import { fetchAndDeepExtract } from '../helpers/deep-fetcher';
import { makeDeepBudget } from '../helpers/deep-budget';

const base = buildIndexPipeline({
  key: 'canada-immigration',
  label: 'Canada IRCC — news releases',
  canonicalSlug: 'ircc-news-releases',
  defaultTitle: 'IRCC news releases',
  defaultSummary:
    'News releases from Immigration, Refugees and Citizenship Canada, read from the Government of Canada news API.',
});

/** Up to this many items per run. */
const MAX_ITEMS = 10;
const DEEP_FETCH_CAP = 3;

export function extractIndexItems(
  xml: string,
): Array<{ url: string; title: string; inlineSummary: string }> {
  const out: Array<{ url: string; title: string; inlineSummary: string }> = [];
  for (const entry of parseFeed(xml)) {
    if (!entry.link || !entry.title) continue;
    if (looksLikeNavLabel(entry.title)) continue;
    out.push({
      url: entry.link,
      title: entry.title,
      inlineSummary: (entry.summary ?? '').slice(0, 400),
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export const canadaImmigrationPipeline: PipelineDefinition = {
  ...base,
  async deepItems(
    _ctx: SourceContext,
    _signal: ParsedSignal,
    normalized: string,
  ): Promise<DeepItem[]> {
    const index = extractIndexItems(normalized);
    const items: DeepItem[] = [];
    // Bounds the fetching, so a slow source degrades to index-level data
    // instead of the function being killed before endRun. See deep-budget.ts.
    const budget = makeDeepBudget();
    for (let i = 0; i < index.length; i++) {
      const ix = index[i];
      const item: DeepItem = {
        url: ix.url,
        title: ix.title,
        summary: ix.inlineSummary,
        guidanceType: 'news',
        extractedText: `${ix.title}. ${ix.inlineSummary}`.slice(0, 1500),
      };
      if (i < DEEP_FETCH_CAP && budget.allows()) {
        const dr = await fetchAndDeepExtract(ix.url, { timeoutMs: budget.timeoutFor(15_000) });
        if (dr.ok && dr.extraction) {
          const ex = dr.extraction;
          item.effectiveDate = ex.effectiveDate;
          item.policyType = ex.policyType;
          item.numericValues = ex.numericValues;
          item.extractedText = ex.cleanBody.slice(0, 6_000);
        }
      }
      items.push(item);
    }
    return items;
  },
};
