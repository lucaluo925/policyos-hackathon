/**
 * Shared HTML extractor for pipeline parsers.
 *
 * Intentionally dependency-free: we run in the Vercel Node runtime without
 * a DOM, so we use tightly scoped regex extractors. These are heuristic,
 * not a full HTML parser — but they're deterministic, fast, and stable
 * across page restyles that don't touch semantic markup.
 *
 * Outputs a best-effort ParsedSignal plus a normalization pipeline that
 * strips transient noise (scripts, analytics, datetime attrs) before
 * hashing. Normalisation keeps hash comparison meaningful: a page whose
 * only diff is a `datetime="..."` timestamp hashes identically.
 */

import type { ParsedSignal } from '../framework';

// Strip patterns applied in order. Each regex removes noise we don't want
// to hash against.
const NOISE_PATTERNS: Array<[RegExp, string]> = [
  [/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''],
  [/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''],
  [/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ''],
  // Normalize datetime attrs that auto-update but don't reflect content
  [/datetime="[^"]*"/gi, 'datetime=""'],
  [/data-timestamp="[^"]*"/gi, 'data-timestamp=""'],
  // Normalize tracking URLs that rotate on every request
  [/[?&](utm_[^=]+|_ga|_gl)=[^"&\s]*/gi, ''],
  // GOV.UK + USCIS both embed `nonce` attrs that rotate per request
  [/\snonce="[^"]*"/gi, ''],
];

/** Strip noise and collapse whitespace. The output is what gets hashed. */
export function normalizeHtml(raw: string): string {
  let out = raw;
  for (const [pat, repl] of NOISE_PATTERNS) {
    out = out.replace(pat, repl);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function regexFirst(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

/** A numeric character reference, or the literal text if it is out of range. */
function decodeCodePoint(value: number, literal: string): string {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return literal;
  try {
    return String.fromCodePoint(value);
  } catch {
    return literal;
  }
}

export function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Numeric references, which the named list above misses in their
    // zero-padded form: the EU site writes an apostrophe as `&#039;`, and
    // it was reaching the page undecoded.
    .replace(/&#(\d{1,7});/g, (lit, d: string) => decodeCodePoint(Number(d), lit))
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (lit, h: string) => decodeCodePoint(parseInt(h, 16), lit))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Ampersand last: decoded first, `&amp;#39;` would turn into an
    // apostrophe instead of the literal text `&#39;` the page asked for.
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string | null {
  const og = regexFirst(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (og) return stripTags(og);
  const t = regexFirst(html, /<title[^>]*>([^<]+)<\/title>/i);
  return t ? stripTags(t) : null;
}

function extractDescription(html: string): string | null {
  const og = regexFirst(html, /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (og) return stripTags(og);
  const desc = regexFirst(html, /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  return desc ? stripTags(desc) : null;
}

function extractDate(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const m =
      html.match(new RegExp(`<meta\\s+(?:name|property)=["']${key}["']\\s+content=["']([^"']+)["']`, 'i')) ??
      html.match(new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:name|property)=["']${key}["']`, 'i'));
    if (m?.[1]) {
      // Try to coerce to an ISO date substring if possible.
      const iso = m[1].match(/\d{4}-\d{2}-\d{2}/);
      return iso?.[0] ?? m[1].trim();
    }
  }
  return null;
}

function countLinks(html: string): number {
  const matches = html.match(/<a\b[^>]*href=/gi);
  return matches?.length ?? 0;
}

/**
 * Classify content as operational guidance, legal announcement, proposal,
 * or plain news, based on keyword heuristics. Deterministic and auditable.
 * We intentionally keep the keyword list small and specific so it's hard to
 * over-fit.
 */
function detectGuidanceType(title: string, body: string): ParsedSignal['guidanceType'] {
  const haystack = `${title} ${body}`.toLowerCase();

  // Proposal signals take precedence — prevents a proposed bill getting
  // misread as enacted law just because the page uses "regulation" language.
  if (
    /\b(proposal|proposed|draft|consultation|for consultation|public consultation|bill\s*introduced)\b/.test(
      haystack,
    )
  ) {
    return 'proposal';
  }

  if (
    /\b(signed into law|enacted|act of|statute|royal assent|presidential proclamation|gazette notification|official notice)\b/.test(
      haystack,
    )
  ) {
    return 'legal_announcement';
  }

  if (
    /\b(operational (guidance|instruction)|policy manual|program delivery instructions|caseworker guidance|uscis policy manual|immigration rules|hc\s?\d+)\b/.test(
      haystack,
    )
  ) {
    return 'operational_guidance';
  }

  if (/\b(news|press release|announcement|media advisory)\b/.test(haystack)) {
    return 'news';
  }

  return 'index';
}

/** Run all heuristic extractors over the *original* HTML (not the normalised
 *  variant — we want access to attrs and structure). */
export function extractHtmlSignal(
  html: string,
  opts?: { summaryFallback?: string },
): ParsedSignal {
  const title = extractTitle(html);
  const description = extractDescription(html);
  const effective = extractDate(html, ['article:published_time', 'og:updated_time', 'dcterms.modified', 'dcterms.issued']);
  const announced = extractDate(html, ['dcterms.created', 'article:published_time']);
  const linkCount = countLinks(html);

  // Plain-text body slice for keyword-based guidance detection, capped to
  // keep classifier work cheap.
  const bodyText = stripTags(html).slice(0, 20_000);
  const guidanceType = detectGuidanceType(title ?? '', bodyText);

  return {
    title: title ?? undefined,
    summary: description ?? opts?.summaryFallback,
    extractedText: bodyText,
    linkCount,
    announcedDate: announced ?? undefined,
    effectiveDate: effective ?? undefined,
    extractionMethod: 'deterministic',
    guidanceType,
    metadata: {
      hasTitle: !!title,
      hasDescription: !!description,
      bodyBytes: bodyText.length,
    },
  };
}

// ─── Index-listing helpers ────────────────────────────────────────────────
//
// Four pipelines (us-immigration, uk-climate, eu-trade, germany-climate)
// scan an index page for anchors and build a short summary from the markup
// that follows each one. Both halves of that job had a defect, and both are
// fixed here once rather than in four copies.

/**
 * Cut a raw-HTML chunk back so it cannot end inside a tag.
 *
 * Slicing HTML at a fixed character count lands mid-tag often enough to
 * matter. A trailing `<div class="leftnav-menu__link-gr` has no closing
 * `>`, so the tag-stripping regex cannot match it and the fragment survives
 * into what is supposed to be plain text. That is how 4,346 of 6,674 stored
 * version summaries came to contain raw markup.
 */
export function dropTrailingPartialTag(chunk: string): string {
  const lastOpen = chunk.lastIndexOf('<');
  if (lastOpen === -1) return chunk;
  return chunk.lastIndexOf('>') > lastOpen ? chunk : chunk.slice(0, lastOpen);
}

/**
 * Plain-text summary drawn from the markup following an anchor.
 *
 * Order matters: trim the partial tag, strip, and only then apply the
 * character budget — so the budget counts text rather than markup, and no
 * tag can be cut in half by it.
 */
export function inlineSummaryFrom(
  html: string,
  startIndex: number,
  opts: {
    maxChars: number;
    windowChars?: number;
    drop?: Array<string | null | undefined>;
    untilNextAnchor?: boolean;
  },
): string {
  const { maxChars, windowChars = 1200, drop = [], untilNextAnchor = false } = opts;
  let end = Math.min(startIndex + windowChars, html.length);
  if (untilNextAnchor) {
    // In a listing, the text belonging to an entry is the text before the
    // next entry starts. A fixed character window runs straight past that
    // boundary and swallows the following rows, which is how a policy came
    // to be summarised by the titles of the two policies beneath it.
    const ownEnd = html.indexOf('</a>', startIndex);
    const next = html.indexOf('<a', ownEnd === -1 ? startIndex + 1 : ownEnd + 4);
    if (next !== -1 && next < end) end = next;
  }
  const window = html.slice(startIndex, end);
  let text = stripTags(dropTrailingPartialTag(window));
  for (const d of drop) {
    if (d) text = text.replace(d, '');
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars).trim();
}

/**
 * Remove site furniture before scanning for policy links.
 *
 * The anchor regexes match by href shape, which a site's own navigation
 * satisfies perfectly well: the USCIS left-hand menu links to
 * `/policy-manual/volume-*` on every page, and it appears before the
 * updates list, so a parser that takes the first N matches collects twelve
 * menu entries and never reaches a real update. Stripping the chrome first
 * is what makes "first N anchors" mean "first N items".
 *
 * Non-greedy by design: a mis-paired tag costs us one region, never the
 * rest of the document.
 */
const CHROME_PATTERNS: RegExp[] = [
  /<nav\b[^>]*>[\s\S]*?<\/nav>/gi,
  /<header\b[^>]*>[\s\S]*?<\/header>/gi,
  /<footer\b[^>]*>[\s\S]*?<\/footer>/gi,
  /<aside\b[^>]*>[\s\S]*?<\/aside>/gi,
  /<ul\b[^>]*\bclass="[^"]*(?:menu|nav|lang|breadcrumb)[^"]*"[^>]*>[\s\S]*?<\/ul>/gi,
  /<div\b[^>]*\bclass="[^"]*(?:leftnav|site-header|site-footer|language|lang-select|breadcrumb)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
];

export function stripSiteChrome(html: string): string {
  let out = html;
  for (const pat of CHROME_PATTERNS) out = out.replace(pat, ' ');
  return out;
}

/**
 * Second net, for chrome that survives structural stripping because it sits
 * in ordinary markup: language switchers, manual volume indexes, and the
 * subscribe/archive furniture every government site carries.
 *
 * Deliberately shape-based rather than a list of phrases per site — a
 * phrase list goes stale on the next redesign, and we would not find out.
 */
export function looksLikeNavLabel(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/^(?:volume|chapter|part|annex|appendix)\s+[\dIVXLC]+\b/i.test(t)) return true;
  // "es español", "bg български" — a two-letter code followed by its endonym.
  if (/^[a-z]{2}\s+\S+$/.test(t)) return true;
  if (/\b(?:subscribe|unsubscribe|manage account|newsletter|sitemap|accessibility statement|privacy (?:policy|notice)|cookie)\b/i.test(t)) return true;
  if (/^(?:overview|archive|home|contact|search|menu|news and communications)\b/i.test(t)) return true;
  // A bare section label on its own, with nothing specific after it.
  if (/^(?:news|press|presse|newsletter|media|about|sitemap)$/i.test(t)) return true;
  // "Presse | Minist\u00e8res \u2026" \u2014 a browser page title, pipe separator and all,
  // picked up when an anchor wrapped a document <title> rather than an item.
  if (/\s\|\s/.test(t)) return true;
  // No \b before the dash: it sits between two non-word characters.
  if (/\s[-–—]\s*archive$/i.test(t)) return true;
  return false;
}
