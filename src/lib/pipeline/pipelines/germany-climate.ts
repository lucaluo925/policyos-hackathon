/**
 * Germany climate pipeline (V6 deep) — BMUV press / news.
 *
 * Walks BMUV's English news page and follows up to 3 article links per run
 * to extract numeric values (carbon tax, emission targets, renewable
 * percentages), actions, and policy type.
 */

import { inlineSummaryFrom, looksLikeNavLabel, stripSiteChrome } from '../helpers/html-extractor';
import { parseFeed } from '@/lib/feeds/atom-parser';
import type {
  DeepItem,
  ParsedSignal,
  PipelineDefinition,
  SourceContext,
} from '../framework';
import { buildIndexPipeline } from '../helpers/factory';
import { fetchAndDeepExtract } from '../helpers/deep-fetcher';
import { makeDeepBudget } from '../helpers/deep-budget';

const base = buildIndexPipeline({
  key: 'germany-climate',
  label: 'BMUV Germany — Press releases (deep)',
  canonicalSlug: 'bmuv-press-releases',
  defaultTitle: 'BMUV — Press releases / news index',
  defaultSummary:
    'Federal Ministry for the Environment (BMUV) news, covering Germany climate and environmental policy.',
});

/** Up to this many items per run, matching the previous HTML scan. */
const MAX_ITEMS = 8;

export function extractIndexItems(html: string): Array<{ url: string; title: string; inlineSummary: string }> {
  // Feed first.
  //
  // The HTML source this pipeline used was the ministry's English homepage,
  // which carries topic navigation and no updates list: on a complete
  // capture (byteSize 167,550 matches the live page exactly, so nothing was
  // truncated) stripping <nav> alone removed all fifteen candidate anchors,
  // because those links live in the navigation. The entries it had been
  // storing as policies were menu labels.
  //
  // The ministry also renamed: bmuv.de is the former BMUV domain and now
  // redirects to bundesumweltministerium.de (BMUKN). That site publishes an
  // English press-release feed at /en/meldungen.rss — RSS 2.0, 20 items,
  // real headlines with absolute links and pubDates — which parseFeed
  // already handles through its <item> branch.
  const entries = parseFeed(html);
  if (entries.length > 0) {
    const fromFeed: Array<{ url: string; title: string; inlineSummary: string }> = [];
    for (const entry of entries) {
      if (!entry.link || !entry.title) continue;
      if (looksLikeNavLabel(entry.title)) continue;
      fromFeed.push({
        url: entry.link,
        title: entry.title,
        inlineSummary: (entry.summary ?? '').slice(0, 400),
      });
      if (fromFeed.length >= MAX_ITEMS) break;
    }
    return fromFeed;
  }

  // Fallback: an HTML listing, for a source that is not a feed.
  const doc = stripSiteChrome(html);
  const out: Array<{ url: string; title: string; inlineSummary: string }> = [];
  // BMUV anchors look like /en/press/pressreleases/... or /en/topics/...
  const re =
    /<a[^>]+href="((?:https?:\/\/www\.bmuv\.de)?\/en\/[^"]+)"[^>]*>([^<]{15,180})<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    let href = m[1];
    if (!href.startsWith('http')) href = `https://www.bmuv.de${href}`;
    if (seen.has(href)) continue;
    // Skip obvious nav entries
    if (/\/(?:rss|newsletter|subscription|service|contact)\b/i.test(href)) continue;
    seen.add(href);
    const title = m[2].replace(/\s+/g, ' ').trim();
    if (looksLikeNavLabel(title)) continue;
    const inlineSummary = inlineSummaryFrom(doc, m.index, { maxChars: 400, windowChars: 800, untilNextAnchor: true, drop: [title] });
    out.push({ url: href, title, inlineSummary });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

const DEEP_FETCH_CAP = 3;

export const germanyClimatePipeline: PipelineDefinition = {
  ...base,
  async deepItems(_ctx: SourceContext, _signal: ParsedSignal, normalized: string): Promise<DeepItem[]> {
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
