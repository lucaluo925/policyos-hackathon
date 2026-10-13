/**
 * V6 deep extractor.
 *
 * Given the HTML of a *full policy page* (not just an index entry), pull
 * structured fields suitable for driving the scoring engine:
 *
 *   - policyType    (law | regulation | guidance | proposal)
 *   - numericValues (percentages, currency amounts, quotas, thresholds)
 *   - actions       ([{ verb, target }]) — e.g. [{ verb: 'increase', target: 'carbon tax' }]
 *   - effectiveDate, publishedDate
 *   - cleanBody     — nav/link/boilerplate stripped body text
 *
 * Deterministic. Designed so a paragraph like "The Carbon Tax rate will
 * increase from SGD 25 to SGD 45 per tCO2e from 1 January 2024" yields:
 *   policyType: 'regulation'
 *   numericValues: { sgd_from: 25, sgd_to: 45 }
 *   actions: [{ verb: 'increase', target: 'carbon tax rate' }]
 *   effectiveDate: '2024-01-01'
 */

import { sliceForUrl } from '../extractors/registry';
import { looksLikeProposal } from '@/lib/policy/proposal-detect';

export interface DeepExtraction {
  title?: string;
  effectiveDate?: string;
  publishedDate?: string;
  policyType: 'law' | 'regulation' | 'guidance' | 'proposal';
  numericValues: Record<string, number>;
  actions: Array<{ verb: string; target: string }>;
  cleanBody: string;
  bodyBytes: number;
  /** V7: which extractor produced the cleanBody. */
  extractorSource?: 'site-specific' | 'generic-main' | 'generic-strip';
}

// Action verbs + light target window. We capture the first 60 chars after
// the verb so downstream rules can pattern-match the target domain.
const ACTION_VERBS = [
  'increase',
  'increases',
  'increased',
  'raise',
  'raises',
  'raised',
  'reduce',
  'reduces',
  'reduced',
  'cut',
  'cuts',
  'lower',
  'lowered',
  'introduce',
  'introduces',
  'introduced',
  'launch',
  'launches',
  'launched',
  'ban',
  'banned',
  'prohibits',
  'prohibited',
  'phase out',
  'phases out',
  'phased out',
  'expand',
  'expands',
  'expanded',
  'extend',
  'extends',
  'extended',
  'suspend',
  'suspends',
  'suspended',
  'repeal',
  'repeals',
  'repealed',
  'remove',
  'removes',
  'removed',
];

const POSITIVE_VERBS = new Set(['increase', 'increases', 'increased', 'raise', 'raises', 'raised', 'introduce', 'introduces', 'introduced', 'launch', 'launches', 'launched', 'expand', 'expands', 'expanded', 'extend', 'extends', 'extended']);
const NEGATIVE_VERBS = new Set(['reduce', 'reduces', 'reduced', 'cut', 'cuts', 'lower', 'lowered', 'ban', 'banned', 'prohibits', 'prohibited', 'phase out', 'phases out', 'phased out', 'suspend', 'suspends', 'suspended', 'repeal', 'repeals', 'repealed', 'remove', 'removes', 'removed']);

export function actionPolarity(verb: string): 'positive' | 'negative' | 'neutral' {
  const v = verb.toLowerCase();
  if (POSITIVE_VERBS.has(v)) return 'positive';
  if (NEGATIVE_VERBS.has(v)) return 'negative';
  return 'neutral';
}

function stripToCleanBody(html: string): string {
  let s = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');
  // Prefer <main>/<article> body if present
  const main = s.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (main) s = main[1];
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m?.[1] ?? null;
}

function firstIsoDate(s: string): string | null {
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m?.[0] ?? null;
}

function detectPolicyType(
  title: string,
  body: string,
): DeepExtraction['policyType'] {
  const h = `${title} ${body}`.toLowerCase();
  // Shared with the mapper's classifier, which had already drifted from this
  // list ("for comment" was only here). See lib/policy/proposal-detect.ts for
  // why a bare "draft" cannot carry the meaning.
  if (looksLikeProposal(`${title} ${body}`)) {
    return 'proposal';
  }
  if (/\b(signed into law|enacted|act of|statute|statutory instrument|royal assent|law no\.|presidential proclamation)\b/.test(h)) {
    return 'law';
  }
  if (/\b(regulation|decree|order|ministerial order|gazette|statutory rule|directive \d)\b/.test(h)) {
    return 'regulation';
  }
  return 'guidance';
}

function extractNumericValues(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  // Percentages near a trigger keyword
  const pctRules: Array<[RegExp, string]> = [
    [/\b(carbon tax|carbon price|carbon levy|co2 tax)\b[^%]{0,60}?(\d+(?:\.\d+)?)\s*%/i, 'carbon_tax_pct'],
    [/\btariff[^%]{0,60}?(\d+(?:\.\d+)?)\s*%/i, 'tariff_pct'],
    [/\b(emission reduction|greenhouse gas reduction|ghg reduction)\b[^%]{0,60}?(\d+(?:\.\d+)?)\s*%/i, 'emission_reduction_pct'],
    [/\brenewable\w*[^%]{0,60}?(\d+(?:\.\d+)?)\s*%/i, 'renewable_target_pct'],
  ];
  for (const [re, key] of pctRules) {
    const m = text.match(re);
    if (m) out[key] = parseFloat(m[m.length - 1]);
  }
  // Funding amounts near a renewable/clean-energy keyword. This is the
  // most common signal in real DESNZ / BMUV press releases: "£64 million
  // for Port Talbot offshore wind hub". We treat a currency budget near
  // a renewable keyword as evidence of renewable_support_strength.
  const fundingRe = /[£€$]\s?(\d+(?:\.\d+)?)\s*(million|billion|bn|m\b|mn)?[^.]{0,120}?\b(solar|wind|offshore wind|hydrogen|renewable|fusion|heat networks?|electric vehicles?|ev charging|battery storage)\b/i;
  const fundingMatch = text.match(fundingRe);
  if (fundingMatch) {
    const amount = parseFloat(fundingMatch[1]);
    const unit = (fundingMatch[2] ?? '').toLowerCase();
    const multiplier = unit.startsWith('b') ? 1_000 : 1; // normalize to millions
    out.renewable_funding_amount_m = amount * multiplier;
  }
  // Quota / cap numeric (>=10k in thousands)
  const quota = text.match(/\b(quota|cap|ceiling|limit)\b.{0,40}?(\d{1,3}(?:,\d{3})+|\d{5,})/i);
  if (quota) out.quota = parseInt(quota[2].replace(/,/g, ''), 10);
  // Currency amounts (SGD, USD, EUR, GBP, JPY) near rate keywords
  const curRules: Array<[RegExp, string]> = [
    [/(?:SGD?|S\$)\s?(\d+(?:\.\d+)?)\s*(?:per|\/)\s*(?:t|tonne|ton|co2)/i, 'sgd_per_tonne'],
    [/(?:EUR?|€)\s?(\d+(?:\.\d+)?)\s*(?:per|\/)\s*(?:t|tonne|ton)/i, 'eur_per_tonne'],
    [/(?:USD?|\$)\s?(\d+(?:\.\d+)?)\s*(?:per|\/)\s*(?:t|tonne|ton)/i, 'usd_per_tonne'],
    [/(?:GBP?|£)\s?(\d+(?:\.\d+)?)\s*(?:per|\/)\s*(?:t|tonne|ton)/i, 'gbp_per_tonne'],
  ];
  for (const [re, key] of curRules) {
    const m = text.match(re);
    if (m) out[key] = parseFloat(m[1]);
  }
  // "from X to Y" pattern (rate changes)
  const fromTo = text.match(/from\s+(?:\$|€|£|SGD?|USD?|EUR?)?\s?(\d+(?:\.\d+)?)\s+to\s+(?:\$|€|£|SGD?|USD?|EUR?)?\s?(\d+(?:\.\d+)?)/i);
  if (fromTo) {
    out.change_from = parseFloat(fromTo[1]);
    out.change_to = parseFloat(fromTo[2]);
  }
  return out;
}

/**
 * Pull action verbs and their targets out of policy prose.
 *
 * Exported because runner.ts kept a private second copy of this with a
 * shorter verb list and no inflections, so `indexOf('increase ')` could not
 * match "increased" -- and policy text is written in the past tense. Measured
 * on 2026-10-10 across 44 live deep items: the private copy found 20 actions
 * to this one's 47, and left 34 of 44 items with no action at all against
 * 25 of 44.
 *
 * That gap turned out to change nothing that matters: feeding both action
 * sets through applyV7Tiered gives an identical evidence-tier distribution
 * (38 weak / 5 medium / 1 strong either way), because the extra verbs are
 * mostly "signed", which carries no polarity, and the newly non-empty items
 * still fail the keyword and numeric gates. So this is consolidation at a
 * moment when it provably cannot move a score, not a scoring fix.
 */
export function extractActions(text: string): Array<{ verb: string; target: string }> {
  const out: Array<{ verb: string; target: string }> = [];
  const lower = text.toLowerCase();
  for (const verb of ACTION_VERBS) {
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(verb + ' ', pos);
      if (idx === -1) break;
      const target = text.slice(idx + verb.length + 1, idx + verb.length + 1 + 60)
        .split(/[.;\n]/)[0]
        .trim();
      if (target.length > 0) {
        out.push({ verb, target });
      }
      pos = idx + verb.length + 1;
      if (out.length >= 20) return out;
    }
  }
  return out;
}

function extractTitle(html: string): string | null {
  const og = extractMeta(html, 'og:title');
  if (og) return og;
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t?.[1]?.trim() ?? null;
}

function extractPublished(html: string): string | null {
  const pub =
    extractMeta(html, 'article:published_time') ??
    extractMeta(html, 'og:updated_time') ??
    extractMeta(html, 'dcterms.issued') ??
    extractMeta(html, 'datePublished');
  if (pub) return firstIsoDate(pub) ?? pub.slice(0, 10);
  // <time datetime="..."> element
  const t = html.match(/<time[^>]+datetime="([^"]+)"/i);
  if (t) return firstIsoDate(t[1]) ?? t[1].slice(0, 10);
  return null;
}

function extractEffective(body: string): string | null {
  // "Effective date: 1 January 2024" or "effective 2024-01-01"
  const m =
    body.match(/effective(?:\s+date)?\s*[:\-]?\s*(\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/i) ??
    body.match(/effective(?:\s+(?:date|on|from))?\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  const raw = m[1];
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Entry point. Runs all extractors on a page of HTML. When `url` is
 *  provided, first tries a site-specific slicer from the registry; falls
 *  back to the generic `<main>` / `<article>` heuristic when no site
 *  extractor matches. This is the V7 extraction-quality upgrade. */
export function deepExtractFromHtml(html: string, url?: string): DeepExtraction {
  const title = extractTitle(html) ?? undefined;
  const publishedDate = extractPublished(html) ?? undefined;

  // V7: try site-specific extractor first.
  let cleanBodyRaw: string;
  let extractorSource: DeepExtraction['extractorSource'] = 'generic-strip';
  if (url) {
    const sliced = sliceForUrl(url, html);
    if (sliced) {
      cleanBodyRaw = sliced
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      extractorSource = 'site-specific';
    } else {
      cleanBodyRaw = stripToCleanBody(html);
      extractorSource = html.includes('<main') || html.includes('<article') ? 'generic-main' : 'generic-strip';
    }
  } else {
    cleanBodyRaw = stripToCleanBody(html);
  }
  const cleanBody = cleanBodyRaw.slice(0, 40_000);
  const effectiveDate = extractEffective(cleanBody) ?? undefined;
  const policyType = detectPolicyType(title ?? '', cleanBody);
  const numericValues = extractNumericValues(cleanBody);
  const actions = extractActions(cleanBody);

  return {
    title,
    publishedDate,
    effectiveDate,
    policyType,
    numericValues,
    actions,
    cleanBody,
    bodyBytes: cleanBody.length,
    extractorSource,
  };
}
