/**
 * EU trade pipeline (V6 deep) — European Commission DG Trade news.
 *
 * Walks the DG Trade news index and, for up to 3 items per run, follows
 * each news link to fetch the full article page. Deep-extracts policy
 * type, numeric values (tariff %, currency/tonne), and action verbs so
 * the runner can mint high-confidence PolicyVersions when material
 * content is present.
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
  key: 'eu-trade',
  label: 'European Commission — DG Trade news (deep)',
  canonicalSlug: 'ec-dg-trade-news',
  defaultTitle: 'European Commission — DG Trade news index',
  defaultSummary:
    'European Commission DG Trade news and announcements. Top items are followed and deep-extracted.',
});

// V10: exclude language-selector / locale-switcher anchors that the page
// uses for translations (e.g. /news_bg = Bulgarian mirror). Only anchors
// pointing to `/news_en/<slug>` with a non-empty slug OR absolute URLs to
// specific DG Trade pages count as real items.
const LANGUAGE_SELECTOR_RE = /\/news_(?!en\/)[a-z]{2}(?:$|\/)/i;
const LOCALE_PATH_RE = /\/(?:language|locale)\//i;
const MIN_TITLE_LEN = 18;
const POLICY_KEYWORDS = /\b(tariff|trade|sanction|investment|fta|agreement|wto|tariff|anti-?dumping|export|customs|protection|commission|deal)\b/i;

export function extractIndexItems(html: string): Array<{ url: string; title: string; inlineSummary: string }> {
  const doc = stripSiteChrome(html);
  const out: Array<{ url: string; title: string; inlineSummary: string }> = [];
  const re =
    /<a[^>]*href="((?:https?:\/\/(?:policy\.trade\.ec\.europa\.eu|ec\.europa\.eu|single-market-economy\.ec\.europa\.eu)[^"]+)|(?:\/(?:news_en|en\/news|commission\/presscorner)\/[^"]+))"[^>]*>([\s\S]{10,400}?)<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    let href = m[1];
    if (!href.startsWith('http')) {
      if (href.startsWith('/news_en')) href = `https://policy.trade.ec.europa.eu${href}`;
      else if (href.startsWith('/commission/')) href = `https://ec.europa.eu${href}`;
      else href = `https://policy.trade.ec.europa.eu${href}`;
    }
    // V10 noise filters:
    if (LANGUAGE_SELECTOR_RE.test(href)) continue; // /news_bg, /news_fr, etc.
    if (LOCALE_PATH_RE.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title || title.length < MIN_TITLE_LEN) continue;
    if (looksLikeNavLabel(title)) continue;
    const inlineSummary = inlineSummaryFrom(doc, m.index, { maxChars: 400, windowChars: 800, untilNextAnchor: true, drop: [title] });
    // Require at least one policy-relevant keyword in title or summary.
    if (!POLICY_KEYWORDS.test(title) && !POLICY_KEYWORDS.test(inlineSummary)) continue;
    out.push({ url: href, title, inlineSummary });
    if (out.length >= 8) break;
  }
  return out;
}

const DEEP_FETCH_CAP = 3;

export const euTradePipeline: PipelineDefinition = {
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
          item.guidanceType = ex.policyType === 'proposal' ? 'proposal' : 'news';
          item.numericValues = ex.numericValues;
          item.extractedText = ex.cleanBody.slice(0, 6_000);
        }
      }
      items.push(item);
    }
    return items;
  },
};
