import { isOfficialSource } from './sources';
import { isInSearchScope } from './official-search';
import { deepExtractFromHtml } from '@/lib/pipeline/helpers/deep-extractor';
import type { TavilyExtractResult } from './tavily';
import { ADJUDICATION_EXCERPT_LIMIT, OFFICIAL_ADJUDICATION_EXCERPT_LIMIT,
  type EvidenceDoc } from './types';

const STOPWORDS = new Set(['the', 'and', 'for', 'from', 'with', 'that', 'this', 'into',
  'have', 'has', 'was', 'were', 'are', 'will', 'would', 'must', 'all', 'each', 'any',
  'before', 'after', 'starting', 'initial', 'allows', 'allow', 'under', 'over',
  'month', 'months', 'year', 'years', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'percent', 'percentage']);

function claimTerms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? [])
    .filter(term => !STOPWORDS.has(term)))];
}

/** Clause numbers are evidence locators, not claimed policy values. Include
 * abbreviated lists such as "ETA 1.3 and 1.6" under the same prefix. */
function namedClauses(text: string): string[] {
  const clauses = new Set<string>();
  const pattern = /\b(ETA|sections?|articles?|regulations?|rules?|clauses?|paragraphs?)\s+(\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)(?:\s*(?:,|and|&)\s*(\d+(?:\.\d+)*(?:\([a-z0-9]+\))?))?/gi;
  for (const match of text.matchAll(pattern)) {
    const prefix = match[1].toLowerCase().replace(/s$/, '');
    clauses.add(`${prefix} ${match[2].toLowerCase()}`);
    if (match[3]) clauses.add(`${prefix} ${match[3].toLowerCase()}`);
  }
  return [...clauses];
}

/** Choose an on-topic window from the original page without reranking toward
 * a possibly false date, amount or duration in the assertion itself. */
function sourceMatchedAnchor(content: string, searchExcerpt: string, assertionText: string): { index: number; length: number } | null {
  const claim = new Set(claimTerms(assertionText));
  const page = content.toLowerCase();
  let best: { index: number; length: number; score: number } | null = null;
  for (const part of searchExcerpt.replace(/\[\.\.\.\]/g, '\n').split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = part.trim();
    if (sentence.length < 40 || sentence.length > 350) continue;
    const overlap = claimTerms(sentence).filter(term => claim.has(term)).length;
    // The source may use a broader label than the generated assertion (for
    // example "graduate students" versus "master's applicants"). One shared
    // non-stopword term plus a verbatim page match is enough to locate this
    // particular Search row; screening still decides topical relevance.
    if (overlap < 1) continue;
    const index = page.indexOf(sentence.toLowerCase());
    if (index < 0) continue;
    const score = overlap * 10 + (/\b(?:19|20)\d{2}\b/.test(sentence) ? 3 : 0);
    if (!best || score > best.score) best = { index, length: sentence.length, score };
  }
  return best && { index: best.index, length: best.length };
}

const WRITTEN_DATE = String.raw`\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:19|20)\d{2}`;
const MONTH = String.raw`January|February|March|April|May|June|July|August|September|October|November|December`;
const DATE_EITHER_ORDER = String.raw`(?:\d{1,2}\s+(?:${MONTH})\s+(?:19|20)\d{2}|(?:${MONTH})\s+\d{1,2},?\s+(?:19|20)\d{2})`;

function normalizedWrittenDate(text: string): string | null {
  const dayFirst = text.match(new RegExp(String.raw`^(\d{1,2})\s+(${MONTH})\s+((?:19|20)\d{2})$`, 'i'));
  const monthFirst = text.match(new RegExp(String.raw`^(${MONTH})\s+(\d{1,2}),?\s+((?:19|20)\d{2})$`, 'i'));
  if (dayFirst) return `${Number(dayFirst[1])}-${dayFirst[2].toLowerCase()}-${dayFirst[3]}`;
  if (monthFirst) return `${Number(monthFirst[2])}-${monthFirst[1].toLowerCase()}-${monthFirst[3]}`;
  return null;
}

/** A page may repeat the same date under opposite eligibility conditions.
 * Locate the assertion's *relation* to that date before choosing a short
 * excerpt. This is only a locator; the adjoining source text supplies the
 * actual answer, which may contradict the assertion. */
function dateRelationAnchor(content: string, assertionText: string): { index: number; length: number } | null {
  const pattern = new RegExp(String.raw`\b(on\s+or\s+before|on\s+or\s+after|before|after)\s+(${DATE_EITHER_ORDER})\b`, 'gi');
  const relation = [...assertionText.matchAll(pattern)][0];
  if (!relation) return null;
  const date = normalizedWrittenDate(relation[2]);
  if (!date) return null;
  const direction = relation[1].toLowerCase().replace(/\s+/g, ' ');
  const claim = claimTerms(assertionText);
  let best: { index: number; length: number; score: number } | null = null;
  for (const match of content.matchAll(pattern)) {
    if (match[1].toLowerCase().replace(/\s+/g, ' ') !== direction ||
        normalizedWrittenDate(match[2]) !== date) continue;
    const neighborhood = content.slice(Math.max(0, match.index - 420),
      Math.min(content.length, match.index + match[0].length + 220)).toLowerCase();
    const score = claim.reduce((sum, term) => sum + (neighborhood.includes(term) ? 1 : 0), 0);
    if (!best || score > best.score) best = { index: match.index, length: match[0].length, score };
  }
  return best && { index: best.index, length: best.length };
}

export function hasClaimDateRelation(content: string, assertionText: string): boolean {
  return Boolean(dateRelationAnchor(content, assertionText));
}

/** Tavily discovers the URL; a bounded issuer-host read can recover semantic
 * conditions lost by Tavily's text extraction. Never follow redirects or
 * read arbitrary URLs, and never treat a page whose claim-date relation is
 * still missing as evidence for that relation. */
export async function readIssuerHtml(
  rawUrl: string, assertionText: string, domains: readonly string[],
  opts: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{ excerpt: string; bytes: number } | null> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (!isInSearchScope(rawUrl, domains) || url.username || url.password ||
      (url.port && url.port !== '443') || /\.(?:pdf|xml|zip|docx?)$/i.test(url.pathname)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await (opts.fetch ?? fetch)(rawUrl, {
      headers: { Accept: 'text/html', 'User-Agent': 'PolicyOS/0.1 (+https://policyos-one.vercel.app)' },
      redirect: 'manual',
      signal: opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
    });
    if (!response.ok || !/^text\/html\b|^application\/xhtml\+xml\b/i.test(
      response.headers.get('content-type') ?? '')) return null;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > 250_000) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 250_000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const body = deepExtractFromHtml(new TextDecoder().decode(buffer), rawUrl).cleanBody;
    if (!hasClaimDateRelation(body, assertionText)) return null;
    const excerpt = selectSourceExcerpt(body, assertionText);
    return hasClaimDateRelation(excerpt, assertionText) ? { excerpt, bytes } : null;
  } finally { clearTimeout(timer); }
}

/** A legal amendment may quote the obsolete date in its recital and replace
 * it only in a later operative article. The claimed date locates an explicit
 * replacement; it is never treated as evidence that the claimed date applies. */
function operativeDateReplacementAnchor(
  content: string, assertionText: string,
): { index: number; length: number } | null {
  const dates = new Set([...assertionText.matchAll(new RegExp(WRITTEN_DATE, 'gi'))]
    .map(match => match[0].toLowerCase().replace(/\s+/g, ' ')));
  if (!dates.size) return null;
  const replacements = new RegExp(
    String.raw`\bthe date\s+[‘'"“]?(${WRITTEN_DATE})[’'"”]?\s+is replaced by\s+[‘'"“]?(${WRITTEN_DATE})`, 'gi');
  for (const match of content.matchAll(replacements)) {
    const oldDate = match[1].toLowerCase().replace(/\s+/g, ' ');
    if (!dates.has(oldDate)) continue;
    const lead = content.slice(Math.max(0, match.index - 500), match.index);
    if (!/\b(?:article|section|regulation)\s+\d+\b/i.test(lead) ||
        !/\bamend(?:ed|ments?)\b/i.test(lead)) continue;
    return { index: match.index, length: match[0].length };
  }
  return null;
}

/** Match the timing of an advance payment and later delivery, rather than a
 * nearby example with the opposite payment timing. The years only locate a
 * scenario; the page's actual tax/rule outcome is never inferred from them. */
function prepaymentDeliveryAnchor(
  content: string, assertionText: string,
): { index: number; length: number } | null {
  const claim = assertionText.match(/\b(?:fully paid|paid (?:for )?in full|full payment|payment in full)\b[\s\S]{0,110}?\b((?:19|20)\d{2})\b[\s\S]{0,150}?\b(?:deliver\w*|receiv\w*|provid\w*)\b[\s\S]{0,100}?\b((?:19|20)\d{2})\b/i);
  if (!claim || claim[1] === claim[2]) return null;
  const [paymentYear, deliveryYear] = [claim[1], claim[2]];
  let best: { index: number; length: number; score: number } | null = null;
  for (const match of content.matchAll(/\b(?:full payment|fully paid|paid in full)\b/gi)) {
    const following = content.slice(match.index, match.index + 150);
    // The first year attached to this payment phrase must be the claimed
    // payment year. Do not let a later invoice year masquerade as that date.
    if (following.match(/\b(?:19|20)\d{2}\b/)?.[0] !== paymentYear) continue;
    const scenario = content.slice(match.index, match.index + 650).toLowerCase();
    const deliveryOffset = scenario.indexOf(deliveryYear);
    if (deliveryOffset < 0 || !/\b(?:deliver\w*|receiv\w*|provid\w*)\b/.test(scenario)) continue;
    const score = (deliveryOffset < 260 ? 4 : 1) +
      (/\b(?:chargeable|taxed|subject to|rate)\b/.test(scenario) ? 2 : 0) +
      (/\bgoods\b/.test(scenario) ? 1 : 0);
    if (!best || score > best.score) best = { index: match.index, length: match[0].length, score };
  }
  return best && { index: best.index, length: best.length };
}

export function selectSourceExcerpt(content: string, assertionText = '', searchExcerpt = '',
  limit = ADJUDICATION_EXCERPT_LIMIT): string {
  if (content.length <= limit || !assertionText) {
    return content.slice(0, limit);
  }
  const amendment = operativeDateReplacementAnchor(content, assertionText);
  if (amendment) {
    const context = searchExcerpt && sourceMatchedAnchor(content, searchExcerpt, assertionText);
    if (context && Math.abs(context.index - amendment.index) >= limit) {
      // Keep the original subject and the operative replacement together,
      // with a visible gap marker rather than implying they were contiguous.
      const separator = '\n[...]\n';
      const contextLength = 300;
      const operativeLength = limit - contextLength - separator.length;
      const contextStart = Math.max(0, context.index - 40);
      const operativeStart = Math.max(0, amendment.index - 220);
      return content.slice(contextStart, contextStart + contextLength) + separator +
        content.slice(operativeStart, operativeStart + operativeLength);
    }
  }
  const prepayment = prepaymentDeliveryAnchor(content, assertionText);
  if (prepayment) {
    const start = Math.min(content.length - limit, Math.max(0, prepayment.index - 100));
    return content.slice(start, start + limit);
  }
  if (!amendment) {
    const datedCondition = dateRelationAnchor(content, assertionText);
    if (datedCondition) {
      // Leave room before the date for the qualifying subject/section and
      // after it for the outcome. Centering exactly on the date cut the
      // Canadian study-permit exception from its "do not need" consequence.
      const start = Math.min(content.length - limit,
        Math.max(0, datedCondition.index - Math.floor(limit * 0.42)));
      return content.slice(start, start + limit);
    }
  }
  // A Search excerpt is a lead, not proof. Use it as a locator only when an
  // entire relevant sentence also occurs verbatim on the extracted page.
  const anchor = amendment ||
    (searchExcerpt && sourceMatchedAnchor(content, searchExcerpt, assertionText));
  if (anchor) {
    const last = content.length - limit;
    const start = Math.min(last, Math.max(0,
      anchor.index - Math.floor((limit - anchor.length) / 2)));
    return content.slice(start, start + limit);
  }
  const terms = claimTerms(assertionText);
  if (!terms.length) return content.slice(0, limit);
  const last = Math.max(0, content.length - limit);
  const starts = [...Array.from({ length: Math.floor(last / 300) + 1 }, (_, i) => i * 300), last];
  const windows = starts.map(start => content.slice(start, start + limit).toLowerCase());
  // Navigation and repeated headings often contain generic claim terms. Give
  // a term more weight when it appears in fewer page windows; this steers the
  // excerpt toward a specific exception instead of the first generic heading.
  const weights = terms.map(term => 1 + Math.log((windows.length + 1) /
    (windows.filter(window => window.includes(term)).length + 1)));
  let best = { start: 0, score: -1 };
  for (let index = 0; index < starts.length; index++) {
    const score = terms.reduce((sum, term, termIndex) => sum +
      (windows[index].includes(term) ? weights[termIndex] : 0), 0);
    if (score > best.score) best = { start: starts[index], score };
  }
  return content.slice(best.start, best.start + limit);
}

/** A source-page window must not erase a Search excerpt that carries specific
 * claim terms missing from the selected window. Dates and number words are
 * excluded, so a false value alone cannot force retention. */
function searchHasMissingSpecificTerms(
  searchExcerpt: string, selectedPageExcerpt: string, fullPage: string, assertionText: string,
): boolean {
  const search = searchExcerpt.toLowerCase();
  const selected = selectedPageExcerpt.toLowerCase();
  const page = fullPage.toLowerCase();
  const requiredClauses = namedClauses(assertionText);
  if (requiredClauses.length) {
    const searchedClauses = new Set(namedClauses(searchExcerpt));
    const selectedClauses = new Set(namedClauses(selectedPageExcerpt));
    const pageClauses = new Set(namedClauses(fullPage));
    if (requiredClauses.some(clause => searchedClauses.has(clause) &&
        !selectedClauses.has(clause) && pageClauses.has(clause))) return true;
  }
  const rareOnPage = (term: string) => {
    let count = 0;
    for (let index = page.indexOf(term); index !== -1; index = page.indexOf(term, index + term.length)) {
      if (++count > 3) return false;
    }
    return count > 0;
  };
  const missingClaimTerms = claimTerms(assertionText).filter(term =>
    search.includes(term) && !selected.includes(term) &&
    (!page.includes(term) || rareOnPage(term)));
  if (missingClaimTerms.length >= 2) return true;

  // An English claim can retrieve a non-English issuing page. In that case
  // English claim terms cannot locate its decisive paragraph. If the chosen
  // window has little overlap with a Search excerpt verified on that same
  // page, keep the original excerpt rather than replacing it with unrelated
  // text. This does not translate or declare the excerpt true.
  const sourceTerms = [...new Set(search.match(/[\p{L}]{5,}/gu) ?? [])]
    .filter(term => !STOPWORDS.has(term) && page.includes(term));
  const shared = sourceTerms.filter(term => selected.includes(term)).length;
  const missingSourceTerms = sourceTerms.filter(term =>
    !selected.includes(term) && rareOnPage(term));
  return sourceTerms.length >= 8 && missingSourceTerms.length >= 3 &&
    shared <= Math.floor(sourceTerms.length / 4);
}

/** Stable, unique, bounded selection from retrieved evidence; never add URLs. */
export function sourceInspectionUrls(docs: readonly EvidenceDoc[]): string[] {
  const urls = [...new Set(docs.map(d => d.url).filter(url => {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
  }))];
  return [...urls.filter(isOfficialSource), ...urls.filter(u => !isOfficialSource(u))].slice(0, 3);
}

/** Failed, blank, redirected, unseen or less-specific page passages preserve Search excerpts. */
export function inspectSourceExcerpts(
  docs: readonly EvidenceDoc[],
  requestedUrls: readonly string[],
  extraction: TavilyExtractResult,
  assertionText = '',
): { docs: EvidenceDoc[]; extractedUrls: string[]; failedUrls: string[];
  preservedSearchUrls: string[] } {
  const allowed = new Set(requestedUrls);
  const fullPages = new Map(extraction.passages.filter(p => allowed.has(p.url) && p.content.trim())
    .map(p => [p.url, p.content]));
  // Search can return different passages from the same URL in separate draws.
  // Locate a page window for each evidence row: selecting once per URL from
  // the first row can erase a later, decisive official passage.
  const passages = docs.map(doc => {
    const page = fullPages.get(doc.url);
    // Tavily separates query-reranked chunks with a visible gap marker. Only
    // these multi-chunk official extracts need a longer window; a normal
    // contiguous page keeps the original tighter locator/provenance behavior.
    const multiChunkOfficial = page !== undefined && isOfficialSource(doc.url) &&
      /\s\[\.\.\.\]\s/.test(page);
    return page === undefined ? null : selectSourceExcerpt(page, assertionText, doc.snippet,
      multiChunkOfficial ? OFFICIAL_ADJUDICATION_EXCERPT_LIMIT : ADJUDICATION_EXCERPT_LIMIT);
  });
  const extractedUrls = requestedUrls.filter(url => fullPages.has(url));
  const preserve = docs.map((doc, index) => {
    const page = fullPages.get(doc.url);
    const selected = passages[index];
    return page !== undefined && selected !== null &&
      !operativeDateReplacementAnchor(selected, assertionText) &&
      !prepaymentDeliveryAnchor(selected, assertionText) &&
      searchHasMissingSpecificTerms(doc.snippet, selected, page, assertionText);
  });
  const preservedSearchUrls = [...new Set(docs.filter((_, index) => preserve[index])
    .map(doc => doc.url))];
  return {
    docs: docs.map((doc, index) => passages[index] !== null && !preserve[index]
      ? { ...doc, snippet: passages[index]!, extractionRequestId: extraction.requestId } : doc),
    extractedUrls,
    failedUrls: requestedUrls.filter(url => !fullPages.has(url)),
    preservedSearchUrls,
  };
}
