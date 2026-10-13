/**
 * US immigration — USCIS Policy Manual Updates (V6 deep).
 *
 * V6 upgrade:
 *   - Still walks the updates index and emits per-update DeepItems.
 *   - For up to 5 items per run, follows the link to the actual chapter
 *     page and runs the deep extractor (numeric values, actions, policy
 *     type, effective date) on the full page.
 *   - Enriched DeepItems carry numeric_values + action metadata so the
 *     runner can mint a high-confidence PolicyVersion when numeric +
 *     directional signals are present.
 */

import { inlineSummaryFrom, looksLikeNavLabel, stripSiteChrome } from '../helpers/html-extractor';
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
  key: 'us-immigration',
  label: 'USCIS — Policy Manual Updates (deep)',
  canonicalSlug: 'uscis-policy-manual-updates',
  defaultTitle: 'USCIS Policy Manual Updates',
  defaultSummary:
    'Index of recent USCIS Policy Manual updates. Each update is surfaced as its own PolicyVersion via deep extraction; top items are fetched fully for numeric + action analysis.',
});

/** Parse the USCIS updates index and emit candidate item URLs + inline summary.
 *  V11: also emits the policy-manual PDF alert URLs when present, so the
 *  deep fetcher's PDF path activates. */
export function extractUscisIndexItems(html: string): Array<{ url: string; title: string; inlineSummary: string; effectiveDate?: string; isPdf?: boolean }> {
  const doc = stripSiteChrome(html);
  const out: Array<{ url: string; title: string; inlineSummary: string; effectiveDate?: string; isPdf?: boolean }> = [];
  // Match both HTML chapter links AND direct PDF alerts (.pdf).
  const anchorRegex =
    /<a[^>]+href="(\/policy-manual\/(?:volume|chapter)[^"]+|\/sites\/default\/files\/document\/policy-manual-updates\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  const dateRegex = />\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\s*</i;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = anchorRegex.exec(doc)) !== null) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 8) continue;
    if (looksLikeNavLabel(title)) continue;
    // The listing puts the volume number in its own column, which lands in
    // front of the citation once the anchor text is flattened.
    const cleanTitle = title.replace(/^\d{1,2}\s+(?=USCIS-PM\b)/, '');
    const tail = doc.slice(m.index, Math.min(m.index + 1200, doc.length));
    const dateMatch = tail.match(dateRegex);
    const effectiveDate = dateMatch?.[1];
    const inlineSummary = inlineSummaryFrom(doc, m.index, {
      maxChars: 600,
      drop: [title, effectiveDate],
      untilNextAnchor: true,
    });
    out.push({
      url: `https://www.uscis.gov${href}`,
      title: cleanTitle,
      inlineSummary,
      effectiveDate: effectiveDate ? new Date(effectiveDate).toISOString().slice(0, 10) : undefined,
      isPdf: /\.pdf$/i.test(href),
    });
    if (out.length >= 12) break;
  }
  return out;
}

const DEEP_FETCH_CAP = 5;

export const usImmigrationPipeline: PipelineDefinition = {
  ...base,
  async deepItems(_ctx: SourceContext, _signal: ParsedSignal, normalized: string): Promise<DeepItem[]> {
    const indexItems = extractUscisIndexItems(normalized);
    const items: DeepItem[] = [];
    // Bounds the fetching, so a slow source degrades to index-level data
    // instead of the function being killed before endRun. See deep-budget.ts.
    const budget = makeDeepBudget();
    for (let i = 0; i < indexItems.length; i++) {
      const it = indexItems[i];
      const item: DeepItem = {
        url: it.url,
        title: it.title,
        summary: it.inlineSummary,
        effectiveDate: it.effectiveDate,
        policyType: 'guidance',
        guidanceType: 'operational_guidance',
        extractedText: `${it.title}. ${it.inlineSummary}`.slice(0, 1500),
      };
      // Follow the first N links to enrich with full-page extraction.
      if (i < DEEP_FETCH_CAP && budget.allows()) {
        const dr = await fetchAndDeepExtract(it.url, { timeoutMs: budget.timeoutFor(12_000) });
        if (dr.ok && dr.extraction) {
          const ex = dr.extraction;
          item.effectiveDate = ex.effectiveDate ?? it.effectiveDate ?? item.effectiveDate;
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
