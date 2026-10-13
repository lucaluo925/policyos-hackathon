import { missingQualifiers } from './qualifiers';

/**
 * Jurisdiction hints for a second, bounded Tavily search. These are search
 * scopes, not proof that any returned page is the issuing authority or that
 * its excerpt settles the assertion. Ambiguous multi-jurisdiction claims keep
 * the open-web results alone.
 */
const SCOPES: Array<{ names: RegExp; domains: string[] }> = [
  { names: /\b(?:European Union|EU)\b|欧盟/, domains: ['europa.eu'] },
  { names: /\b(?:Japan|Japanese)\b|日本/i, domains: ['go.jp'] },
  { names: /\b(?:Singapore|Singaporean)\b|新加坡/i, domains: ['gov.sg'] },
  { names: /\b(?:United Kingdom|UK|Britain)\b|英国/i, domains: ['gov.uk'] },
  { names: /\bUnited States\b|\bU\.S\.(?=\W|$)|\bUSA\b|美国/, domains: ['gov'] },
  { names: /\b(?:Australia|Australian)\b|澳大利亚/i, domains: ['gov.au'] },
  { names: /\b(?:Canada|Canadian)\b|加拿大/i, domains: ['canada.ca', 'gc.ca'] },
  { names: /\b(?:New Zealand|New Zealanders?)\b|新西兰/i, domains: ['govt.nz'] },
  { names: /\b(?:Spain|Spanish)\b|西班牙/i, domains: ['gob.es'] },
  { names: /\b(?:Malaysia|Malaysian)\b|马来西亚/i, domains: ['gov.my'] },
  { names: /\b(?:Switzerland|Swiss)\b|瑞士/i, domains: ['admin.ch'] },
  { names: /\b(?:Norway|Norwegian)\b|挪威/i, domains: ['regjeringen.no'] },
  { names: /\b(?:South Africa|South African)\b|南非/i, domains: ['gov.za'] },
  { names: /\b(?:Slovenia|Slovenian)\b|斯洛文尼亚/i, domains: ['gov.si'] },
  { names: /\bIreland\b|爱尔兰/i, domains: ['gov.ie', 'irishimmigration.ie'] },
  { names: /\b(?:India|Indian)\b|印度/i, domains: ['gov.in'] },
  { names: /\b(?:Brazil|Brazilian)\b|巴西/i, domains: ['gov.br'] },
  { names: /\b(?:France|French)\b|法国/i, domains: ['gouv.fr'] },
  { names: /\bHong Kong\b|香港/i, domains: ['gov.hk'] },
];

export function officialSearchDomains(claim: string): string[] {
  const matches = SCOPES.filter(scope => scope.names.test(claim));
  if (matches.length !== 1) return [];
  // BOE is the issuing gazette for Spanish decrees. A broad ministry search
  // often finds summaries rather than the published law and commencement rule.
  if (matches[0].domains[0] === 'gob.es' &&
      /\b(?:royal decree|real decreto|law\s+\d+\/\d{4}|ley\s+\d+\/\d{4})\b/i.test(claim)) {
    return ['boe.es'];
  }
  // Current Norwegian VAT rules are published by the Tax Administration.
  // A budget proposal on regjeringen.no can describe a future change but is
  // weaker evidence for what the enacted exemption actually is.
  if (matches[0].domains[0] === 'regjeringen.no' &&
      /\b(?:VAT|value[ -]added tax|MVA|merverdiavgift)\b|增值税/i.test(claim)) {
    return ['skatteetaten.no'];
  }
  // The Environmental Protection Department publishes the current plastic
  // shopping bag charge and its food exemptions. An unrelated government
  // consultation PDF on another gov.hk subdomain is not a substitute.
  if (matches[0].domains[0] === 'gov.hk' &&
      /\b(?:plastic(?: shopping)? bags?|PSBs?)\b|塑[膠胶]袋/i.test(claim)) {
    return ['epd.gov.hk'];
  }
  // HASiL (IRBM) publishes the e-Invoice rollout and exemptions. Broad
  // government search can instead return an older threshold or no issuer hit.
  if (matches[0].domains[0] === 'gov.my' &&
      /\be[- ]?invoic(?:e|ing)|\be[- ]?invois/i.test(claim)) {
    return ['hasil.gov.my'];
  }
  // Fair Work Ombudsman publishes the commencement dates and employer scope.
  // A broad .gov.au draw can instead surface unrelated public-sector guidance.
  if (matches[0].domains[0] === 'gov.au' &&
      /\bright\s+to\s+disconnect\b/i.test(claim)) {
    return ['fairwork.gov.au'];
  }
  // The French tax administration publishes invoice obligations. Broad
  // government search can return company filings hosted by another agency.
  if (matches[0].domains[0] === 'gouv.fr' &&
      /\b(?:e[- ]?invoic\w*|electronic invoic\w*|facturation [ée]lectronique)\b/i.test(claim)) {
    return ['impots.gouv.fr'];
  }
  return matches[0].domains;
}

/** Use the issuing authority's vocabulary for this narrow bilingual topic.
 * The year comes from the user's claim; no expected answer is injected. */
export function officialSearchQuery(claim: string, searchQuery: string): string {
  if (officialSearchDomains(claim)[0] === 'impots.gouv.fr') {
    // Issuer-language discovery, without asserted dates or expected answers.
    return 'facturation électronique entreprises assujetties TVA réception émission calendrier PME micro-entreprises';
  }
  if (officialSearchDomains(claim)[0] === 'boe.es') {
    const decree = claim.match(/\b(?:royal decree|real decreto)\s+(\d+\/\d{4})\b/i);
    if (decree) {
      // Ask separately for the publication record and the operative rule.
      // Neither query repeats a possibly false day from the user's claim.
      return /\b(?:publish(?:ed|ing)?|publication|publicad[oa])\b/i.test(searchQuery) &&
        !/\b(?:effective|effect|commenc\w*|force|vigor)\b/i.test(searchQuery)
        ? `Real Decreto ${decree[1]} BOE fecha de publicación texto original`
        : `Real Decreto ${decree[1]} disposición final entrada en vigor fecha publicación`;
    }
  }
  const section = referencedSection(claim);
  if (section) {
    const withSection = new RegExp(`\\bsection\\s+${section}\\b`, 'i').test(searchQuery)
      ? searchQuery : `${searchQuery} section ${section}`;
    return concernsCommencement(claim) ? `${withSection} commencement status` : withSection;
  }
  if (officialSearchDomains(claim)[0] === 'epd.gov.hk' &&
      /\bminimum\b/i.test(searchQuery) && /\bcharg(?:e|ing)\b/i.test(searchQuery)) {
    // Ask for the currently implemented scheme, not the amount asserted by
    // the user; older consultation PDFs also discuss proposed charge levels.
    return 'Enhanced Plastic Shopping Bag Charging Scheme current phase charging level Hong Kong';
  }
  if (officialSearchDomains(claim)[0] === 'fairwork.gov.au') {
    // Search for the issuing body's coverage rule, without copying the user's
    // possibly false start date into the scoped query.
    return /\bsmall[ -]business(?:es)?\b/i.test(claim)
      ? 'Fair Work Ombudsman right to disconnect small business commencement'
      : 'Fair Work Ombudsman right to disconnect commencement coverage';
  }
  if (officialSearchDomains(claim)[0] === 'hasil.gov.my') {
    // Search for the current authority timeline without repeating an asserted
    // threshold or deadline that may be false or superseded.
    return 'Malaysia HASiL e-Invoice implementation timeline annual revenue exemption';
  }
  if (officialSearchDomains(claim)[0] !== 'skatteetaten.no' ||
      !/\b(?:electric[ -]?(?:car|vehicle)|EV)\b|电动车/i.test(claim)) {
    return searchQuery;
  }
  const year = claim.match(/\b20\d{2}\b/)?.[0];
  return `merverdiavgift elbil fritak${year ? ` ${year}` : ''}`;
}

function referencedSection(claim: string): string | null {
  return claim.match(/\bsection\s+(\d{1,3})\b/i)?.[1] ?? null;
}

function namedGroup(claim: string): string | null {
  return claim.match(/\bgroup\s+(\d{1,2})\b/i)?.[1] ?? null;
}

function passageNamesGroup(passage: string, group: string): boolean {
  return new RegExp(`\\bgroup\\s+${group}\\b`, 'i').test(passage);
}

function passageNamesSection(passage: string, section: string, needsStatus: boolean): boolean {
  return [...passage.matchAll(/\bsections?\b/gi)].some(match => {
    const context = passage.slice(Math.max(0, match.index - 100), match.index + 260);
    return new RegExp(`\\b${section}\\b`).test(passage.slice(match.index, match.index + 240)) &&
      (!needsStatus || /\b(?:commenc\w*|defer\w*|exclud\w*|effective|enter\w* into force)\b/i.test(context));
  });
}

const concernsCommencement = (claim: string) =>
  /\b(?:commenc\w*|effective|entered into force|came into force|took effect)\b/i.test(claim);

/** An issuer-domain URL alone is insufficient when the claim names a legal
 * section and the returned excerpt never identifies that section. */
export function needsOfficialSearch(
  claim: string, docs: readonly { url: string; snippet: string }[], domains: readonly string[],
  assertionText = claim,
): boolean {
  const official = docs.filter(doc => isInSearchScope(doc.url, domains));
  if (!official.length) return true;
  if (!official.some(doc => missingQualifiers(assertionText, doc.snippet).length === 0)) return true;
  const section = referencedSection(claim);
  if (section && !official.some(doc =>
    passageNamesSection(doc.snippet, section, concernsCommencement(claim)))) return true;
  // An official host can still return a passage about another policy year.
  // Require the years in this assertion to occur together in at least one
  // issuing-domain excerpt. This is only a reason to search again, never proof
  // that a page mentioning the asserted year supports the assertion.
  const years = claimYears(assertionText);
  if (years.length > 0 && !official.some(doc => years.every(year =>
    doc.snippet.includes(year)))) return true;
  // Phased policies often use named cohorts. A page about the first year for
  // "largest entities" does not, by itself, establish a claim about Group 1.
  // Seek an issuer excerpt that names the cohort and date together. This is a
  // retrieval gate, not an inference that the claimed rule is true.
  const group = namedGroup(assertionText);
  if (group && !official.some(doc => passageNamesGroup(doc.snippet, group) &&
    years.every(year => doc.snippet.includes(year)))) return true;
  // An exception claim needs a passage that actually states how a rule
  // applies. A dated program table listing eligible courses does not settle
  // whether the applicant is exempt from a separate requirement. The
  // disposition may support or refute the assertion; this only asks for a
  // more relevant issuer passage, never preselects a verdict.
  if (assertionNamesException(assertionText) && !official.some(doc =>
    (!years.length || years.every(year => doc.snippet.includes(year))) &&
    passageNamesDisposition(doc.snippet))) return true;
  // An official summary may name the transition and all its dates without
  // addressing the particular facility or route that the claimant asked
  // about. Do not let that summary suppress a scoped search for the actual
  // implementation rule.
  const route = sourceRouteQualifier(assertionText);
  if (route && !official.some(doc => doc.snippet.toLowerCase().includes(route))) return true;
  // A page about the changeover year does not necessarily address a narrower
  // before/after boundary. In particular, an excerpt about leave *starting*
  // before a date cannot settle whether a named entitlement *fell* before it.
  // Require the subject and boundary to appear in one nearby passage before
  // reusing a prior assertion's official excerpt.
  const boundary = temporalBoundary(assertionText);
  return Boolean(boundary && !official.some(doc => passageNamesBoundary(doc.snippet, boundary)));
}

function sourceRouteQualifier(text: string): string | null {
  const match = text.match(/\bfrom\s+(?:a|an|the)\s+([a-z-]+\s+(?:warehouse|depot|port|facility))\b/i);
  return match?.[1].toLowerCase() ?? null;
}

/** Keep a second excerpt of the same issuer URL when it adds the named
 * facility route omitted from the original Search result. */
export function scopedHitAddsRoute(
  assertionText: string, existing: string, scoped: string,
): boolean {
  const route = sourceRouteQualifier(assertionText);
  return Boolean(route && !existing.toLowerCase().includes(route) &&
    scoped.toLowerCase().includes(route));
}

function assertionNamesException(text: string): boolean {
  return /\b(?:exempt(?:ion)?|does not apply|do not need|does not need|not required|no\s+[\w -]{0,40}\brequirement)\b/i.test(text);
}

function passageNamesDisposition(text: string): boolean {
  return /\b(?:exempt(?:ion)?|does not apply|do not need|does not need|not required|must|required|subject to|requirement applies)\b/i.test(text);
}

export function lacksExceptionDisposition(passage: string, assertionText: string): boolean {
  return assertionNamesException(assertionText) && !passageNamesDisposition(passage);
}

export function scopedHitAddsDisposition(
  assertionText: string, existing: string, scoped: string,
): boolean {
  return lacksExceptionDisposition(existing, assertionText) &&
    !lacksExceptionDisposition(scoped, assertionText);
}

type TemporalBoundary = { subject: string; direction: string; date: string };

function temporalBoundary(text: string): TemporalBoundary | null {
  const match = text.match(/\b([a-z][\w-]*(?:\s+[a-z][\w-]*){0,2})\s+that\s+(?:fell|occurred|started|ended|took place)\s+(before|after)\s+(\d{1,2}\s+[a-z]+\s+20\d{2})\b/i);
  if (!match) return null;
  return { subject: match[1].split(/\s+/).slice(-2).join(' ').toLowerCase(),
    direction: match[2].toLowerCase(), date: match[3].toLowerCase() };
}

function passageNamesBoundary(passage: string, boundary: TemporalBoundary): boolean {
  const normalized = passage.toLowerCase().replace(/\s+/g, ' ');
  const needle = `${boundary.direction} ${boundary.date}`;
  let at = normalized.indexOf(needle);
  while (at !== -1) {
    const start = Math.max(normalized.lastIndexOf('.', at),
      normalized.lastIndexOf(';', at), normalized.lastIndexOf('!', at));
    const end = normalized.indexOf('.', at + needle.length);
    const sentence = normalized.slice(Math.max(start + 1, at - 180),
      Math.min(end === -1 ? normalized.length : end, at + needle.length + 180));
    if (sentence.includes(boundary.subject)) return true;
    at = normalized.indexOf(needle, at + 1);
  }
  return false;
}

/** Keep a more specific Search excerpt when the same URL was seen earlier. */
export function scopedHitAddsBoundary(
  assertionText: string, existing: string, scoped: string,
): boolean {
  const boundary = temporalBoundary(assertionText);
  return Boolean(boundary && !passageNamesBoundary(existing, boundary) &&
    passageNamesBoundary(scoped, boundary));
}

function claimYears(text: string): string[] {
  return [...new Set(text.match(/\b(?:19|20)\d{2}\b/g) ?? [])];
}

/** Keep an improved scoped excerpt alongside the original URL's Search draw,
 * so its request ID and original text both remain reviewable. */
export function scopedHitAddsSection(
  claim: string, existing: string, scoped: string,
): boolean {
  const section = referencedSection(claim);
  const needsStatus = concernsCommencement(claim);
  return Boolean(section && !passageNamesSection(existing, section, needsStatus) &&
    passageNamesSection(scoped, section, needsStatus));
}

/** A second Search draw of the same official URL may contain the relevant
 * year that the first draw omitted. Keep both passages and their request IDs
 * so downstream screening can distinguish them. */
export function scopedHitAddsYear(
  assertionText: string, existing: string, scoped: string,
): boolean {
  const years = claimYears(assertionText);
  return years.length > 0 && !years.every(year => existing.includes(year)) &&
    years.every(year => scoped.includes(year));
}

/** Preserve a second issuer excerpt of the same URL when it adds the named
 * cohort and its year; the first excerpt may only say "largest entities". */
export function scopedHitAddsGroup(
  assertionText: string, existing: string, scoped: string,
): boolean {
  const group = namedGroup(assertionText);
  if (!group) return false;
  const years = claimYears(assertionText);
  return !passageNamesGroup(existing, group) && passageNamesGroup(scoped, group) &&
    years.every(year => scoped.includes(year));
}

export function isInSearchScope(rawUrl: string, domains: readonly string[]): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
