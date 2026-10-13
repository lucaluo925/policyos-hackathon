/**
 * UK climate pipeline (V6 deep) — GOV.UK DESNZ announcements.
 *
 * Walks the GOV.UK news-and-communications listing filtered to DESNZ and
 * follows up to 3 articles per run to extract numeric + action signals.
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
  key: 'uk-climate',
  label: 'GOV.UK — DESNZ announcements (deep)',
  canonicalSlug: 'govuk-desnz-announcements',
  defaultTitle: 'GOV.UK — DESNZ announcements index',
  defaultSummary:
    'Announcements from the UK Department for Energy Security and Net Zero. Top items are deep-fetched.',
});

/** Up to this many items per run, matching the previous HTML scan. */
const MAX_ITEMS = 10;

export function extractIndexItems(html: string): Array<{ url: string; title: string; inlineSummary: string }> {
  // Feed first, because the same DESNZ search is published as Atom and the
  // project already parses GOV.UK Atom in the news registry.
  //
  // Correction worth keeping: this was first justified by the claim that
  // the HTML listing carried no article links at all. That was wrong. The
  // live page is ~449k characters with its 20 article links starting at
  // ~403k; the stored snapshot is capped at 200k, so reading the stored
  // copy showed only navigation. The HTML scan was working.
  //
  // The feed is kept on its own merits: the same 20 items in ~12k instead
  // of ~449k, titles and summaries as the department publishes them rather
  // than scraped out of a text window, and — directly relevant — a stored
  // snapshot that fits under the cap, so the audit trail contains the
  // items instead of the prefix that caused the wrong call above.
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
  // V11: match HTML news pages PLUS direct PDF uploads so the deep fetcher's
  // PDF path activates. Two passes keeps the regex parseable and auditable.
  const reHtml = /<a[^>]+href="((?:https?:\/\/www\.gov\.uk)?\/government\/(?:news|publications|speeches|statistics)\/[^"]+)"[^>]*>([^<]{15,200})<\/a>/gi;
  const rePdf = /<a[^>]+href="((?:https?:\/\/(?:www\.gov\.uk|assets\.publishing\.service\.gov\.uk))?\/(?:media|government\/uploads)\/[^"]+\.pdf)"[^>]*>([^<]{8,200})<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  for (const re of [reHtml, rePdf]) {
    while ((m = re.exec(doc)) !== null) {
      let href = m[1];
      if (!href.startsWith('http')) {
        href = /\/(?:media|government\/uploads)\//.test(href)
          ? `https://assets.publishing.service.gov.uk${href}`
          : `https://www.gov.uk${href}`;
      }
      if (seen.has(href)) continue;
      seen.add(href);
      const title = m[2].replace(/\s+/g, ' ').trim();
      if (looksLikeNavLabel(title)) continue;
      const inlineSummary = inlineSummaryFrom(doc, m.index, { maxChars: 400, windowChars: 800, untilNextAnchor: true, drop: [title] });
      out.push({ url: href, title, inlineSummary });
      if (out.length >= MAX_ITEMS) break;
    }
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

// Raised from 3 → 6 → 8 so numeric-bearing pages ("£64m for offshore wind")
// get deep-fetched even when they're not the top entries on the listing.
// We also *prioritise* anchors whose inline summary contains a currency sign.
const DEEP_FETCH_CAP = 8;

function prioritiseByCurrency(items: Array<{ url: string; title: string; inlineSummary: string }>) {
  // Items with a £/$/€ amount in their summary go first.
  return [...items].sort((a, b) => {
    const aHas = /[£€$]\s?\d/.test(`${a.title} ${a.inlineSummary}`);
    const bHas = /[£€$]\s?\d/.test(`${b.title} ${b.inlineSummary}`);
    return (bHas ? 1 : 0) - (aHas ? 1 : 0);
  });
}

export const ukClimatePipeline: PipelineDefinition = {
  ...base,
  async deepItems(_ctx: SourceContext, _signal: ParsedSignal, normalized: string): Promise<DeepItem[]> {
    const index = prioritiseByCurrency(extractIndexItems(normalized));
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
