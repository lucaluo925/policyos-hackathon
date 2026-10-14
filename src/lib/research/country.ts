import { getDirectoryCountry } from '@/lib/data/country-directory';
import { isDatabaseConfigured } from '@/lib/db';
import { countryGovernmentSearchDomains, isCountryGovernmentSource, isOfficialSource } from '@/lib/verify/sources';
import { TavilyClient, type TavilySearchResult } from '@/lib/verify/tavily';
import { CountryResearchQuotaExceeded, reserveSharedCountryResearch } from './quota';

export { CountryResearchQuotaExceeded } from './quota';

export const COUNTRY_RESEARCH_DOMAINS = ['climate', 'trade', 'immigration'] as const;
export type CountryResearchDomain = (typeof COUNTRY_RESEARCH_DOMAINS)[number];
export type CountryResearchScope = 'public' | 'country-government';

export interface CountryResearchSearch { query: string; includeDomains: string[]; searchDepth: 'basic'; maxResults: number }

export interface CountryResearchResult {
  countryIso: string;
  countryName: string;
  domain: CountryResearchDomain;
  scope: CountryResearchScope;
  searchedAt: string;
  requestId: string;
  search?: CountryResearchSearch;
  items: Array<{ title: string; url: string; excerpt: string; recognizedOfficialDomain: boolean; countryGovernmentDomain: boolean }>;
}

export class InvalidCountryResearchQuery extends Error {}

type SearchClient = Pick<TavilyClient, 'search'>;
const cache = new Map<string, { expiresAt: number; result: Promise<CountryResearchResult> }>();
const CACHE_MS = 10 * 60_000;
const DAILY_PROCESS_CAP = 60;
let dailyUsage = { day: '', used: 0 };

export function parseCountryResearchQuery(rawIso: string, rawDomain: string, rawScope = 'public') {
  const country = /^[A-Za-z]{2}$/.test(rawIso) ? getDirectoryCountry(rawIso) : undefined;
  if (!country || !COUNTRY_RESEARCH_DOMAINS.includes(rawDomain as CountryResearchDomain)
    || (rawScope !== 'public' && rawScope !== 'country-government')) {
    throw new InvalidCountryResearchQuery('Choose a valid country and policy domain.');
  }
  if (rawScope === 'country-government' && !countryGovernmentSearchDomains(country.iso).length) {
    throw new InvalidCountryResearchQuery('Government-site search is not configured for this country.');
  }
  return { country, domain: rawDomain as CountryResearchDomain, scope: rawScope as CountryResearchScope };
}

function isSafeWebUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

// The World Bank directory uses administrative names. Search with names that
// distinguish the two Koreas and Congos, and recognize common public names.
const COUNTRY_SEARCH_NAMES: Record<string, { query: string; aliases: readonly string[] }> = {
  AE: { query: 'United Arab Emirates', aliases: ['United Arab Emirates', 'UAE'] },
  CD: { query: 'Democratic Republic of the Congo', aliases: ['Democratic Republic of the Congo', 'Democratic Republic of Congo', 'DR Congo', 'Congo-Kinshasa'] },
  CG: { query: 'Republic of the Congo', aliases: ['Republic of the Congo', 'Republic of Congo', 'Congo-Brazzaville'] },
  CI: { query: "Côte d'Ivoire", aliases: ["Côte d'Ivoire", 'Ivory Coast'] },
  CZ: { query: 'Czechia', aliases: ['Czechia', 'Czech Republic'] },
  KP: { query: 'North Korea', aliases: ['North Korea', 'DPRK', "Democratic People's Republic of Korea"] },
  KR: { query: 'South Korea', aliases: ['South Korea', 'Republic of Korea'] },
  LA: { query: 'Laos', aliases: ['Laos', 'Lao PDR', "Lao People's Democratic Republic"] },
  RU: { query: 'Russia', aliases: ['Russia', 'Russian Federation'] },
  SK: { query: 'Slovakia', aliases: ['Slovakia', 'Slovak Republic'] },
  TR: { query: 'Türkiye', aliases: ['Türkiye', 'Turkiye', 'Turkey'] },
};

function countrySearchName(country: NonNullable<ReturnType<typeof getDirectoryCountry>>) {
  return COUNTRY_SEARCH_NAMES[country.iso]?.query ?? country.name;
}

function countryAliases(country: NonNullable<ReturnType<typeof getDirectoryCountry>>): readonly string[] {
  return COUNTRY_SEARCH_NAMES[country.iso]?.aliases ?? [country.name.split(',')[0].replace(/ SAR$/, '').trim()];
}

function isCountrySpecific(
  country: NonNullable<ReturnType<typeof getDirectoryCountry>>,
  hit: TavilySearchResult['hits'][number],
): boolean {
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  let leadingText = normalize(`${hit.title} ${hit.content.slice(0, 250)}`);
  // "Republic of the Congo" is contained inside "Democratic Republic of the
  // Congo". Remove that longer, different jurisdiction before matching CG.
  if (country.iso === 'CG') {
    leadingText = leadingText.replace(/democratic republic of (?:the )?congo|dr congo|congo-kinshasa/g, ' ');
  }
  if (countryAliases(country).some(alias => {
    const escaped = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, 'u').test(leadingText);
  })) return true;
  // A third-party ccTLD is not evidence of the article's subject. A known
  // government domain can stand in for a generic announcement headline.
  return isCountryGovernmentSource(hit.url, country.iso);
}

const TOPIC_TITLE_TERMS: Record<CountryResearchDomain, RegExp> = {
  climate: /\b(?:climate|climat|carbon|emissions?|environment|environmental|renewables?|net[- ]?zero|pollution|biodiversity|ecolog|energ(?:y|ie|ia|ía))\b/i,
  trade: /\b(?:trade|trading|tariffs?|customs|imports?|exports?|dut(?:y|ies)|sanctions?|comercio|aduana|arancel|douane|commerce)\b/i,
  immigration: /\b(?:immigrat\w*|migrat\w*|visas?|borders?|residen\w*|asylum|entry permits?|work permits?|citizenship|migración|visado|asilo)\b/i,
};

// A concrete action/measure in the title is a better lead than a ministry
// homepage with only a topical excerpt. This is a display-ranking hint, not
// evidence that the measure was adopted or came into force.
const POLICY_ACTION_TITLE_TERMS = /\b(?:agreements?|regulations?|decrees?|laws?|acts?|circulars?|decisions?|orders?|plans?|strateg(?:y|ies)|polic(?:y|ies)|measures?|rules?|restrictions?|requirements?|reforms?|guidance|notices?|approv(?:e|es|ed|al)|adopt(?:s|ed)?|issu(?:e|es|ed)|introduc(?:e|es|ed)|launch(?:es|ed)?|conclud(?:e|es|ed)|negotiat\w*|implement\w*|effective|NDC)\b|décret|règlement|acuerdo|reglamento|verordnung|gesetz|abkommen/i;

function titlePriority(domain: CountryResearchDomain, title: string): number {
  if (!TOPIC_TITLE_TERMS[domain].test(title)) return 0;
  return POLICY_ACTION_TITLE_TERMS.test(title) ? 2 : 1;
}

function isTopicLead(domain: CountryResearchDomain, hit: TavilySearchResult['hits'][number], countryGovernmentDomain: boolean): boolean {
  const title = hit.title.trim();
  // Government home and institutional-history pages often mention a policy
  // topic in their navigation excerpt without being policy leads themselves.
  // Keep this narrow so a named order or a topical overview is not discarded.
  if (/^(?:home(?:page)?|about(?: us)?|history|[a-z]{2,8} history)$/i.test(title)) return false;
  // "Investment climate" is an economic-business term, not climate policy.
  if (domain === 'climate' && /\binvestment climate\b/i.test(title)) return false;
  if (TOPIC_TITLE_TERMS[domain].test(title)) return true;
  // A generic ministry headline can still be a lead when its own excerpt
  // names the policy topic. Do not give this exemption to other publishers.
  return countryGovernmentDomain && TOPIC_TITLE_TERMS[domain].test(hit.content.slice(0, 250));
}

function toResearchResult(
  country: NonNullable<ReturnType<typeof getDirectoryCountry>>,
  domain: CountryResearchDomain,
  scope: CountryResearchScope,
  search: TavilySearchResult,
  request: CountryResearchSearch,
): CountryResearchResult {
  const seen = new Set<string>();
  const ranked = search.hits.flatMap(hit => {
    if (!isSafeWebUrl(hit.url) || seen.has(hit.url) || !isCountrySpecific(country, hit)) return [];
    const countryGovernmentDomain = isCountryGovernmentSource(hit.url, country.iso);
    // A provider-side domain restriction is helpful but not an authorization
    // boundary. Fail closed if a returned URL is outside the selected sites.
    if (scope === 'country-government' && !countryGovernmentDomain) return [];
    if (!isTopicLead(domain, hit, countryGovernmentDomain)) return [];
    seen.add(hit.url);
    return [{
      title: hit.title.trim().slice(0, 180) || new URL(hit.url).hostname,
      url: hit.url,
      excerpt: hit.content.trim().slice(0, 550),
      recognizedOfficialDomain: isOfficialSource(hit.url),
      countryGovernmentDomain,
    }];
  }).sort((a, b) => Number(b.countryGovernmentDomain) - Number(a.countryGovernmentDomain)
    || Number(b.recognizedOfficialDomain) - Number(a.recognizedOfficialDomain)
    || titlePriority(domain, b.title) - titlePriority(domain, a.title));
  const hostCounts = new Map<string, number>();
  const items = ranked.filter(item => {
    const host = new URL(item.url).hostname;
    const count = hostCounts.get(host) ?? 0;
    if (count >= (item.countryGovernmentDomain ? 2 : 1)) return false;
    hostCounts.set(host, count + 1);
    return true;
  });
  return {
    countryIso: country.iso,
    countryName: country.name,
    domain,
    scope,
    searchedAt: new Date().toISOString(),
    requestId: search.requestId,
    search: request,
    items,
  };
}

/** One bounded live Search call; results are leads and never change policy scores. */
export async function researchCountry(
  rawIso: string,
  rawDomain: string,
  client?: SearchClient,
  rawScope = 'public',
): Promise<CountryResearchResult> {
  const { country, domain, scope } = parseCountryResearchQuery(rawIso, rawDomain, rawScope);
  const key = `${country.iso}:${domain}:${scope}`;
  const day = new Date().toISOString().slice(0, 10);
  if (!client) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    if (dailyUsage.day !== day) dailyUsage = { day, used: 0 };
    if (dailyUsage.used >= DAILY_PROCESS_CAP) {
      throw new CountryResearchQuotaExceeded('Daily live research budget reached. Try again tomorrow.');
    }
    dailyUsage.used += 1;
  }

  const topic = {
    climate: 'climate environment energy',
    trade: 'trade tariffs customs',
    immigration: 'immigration visas border',
  }[domain];
  const year = new Date().getUTCFullYear();
  const query = `${countrySearchName(country)} government official ${topic} policy announcement ${year}`;
  const request: CountryResearchSearch = { query, searchDepth: 'basic', maxResults: 5,
    includeDomains: scope === 'country-government' ? [...countryGovernmentSearchDomains(country.iso)] : [] };
  const result = (async () => {
    if (!client) {
      if ((process.env.VERCEL === '1' || process.env.COUNTRY_RESEARCH_REQUIRE_SHARED_QUOTA === '1')
        && !isDatabaseConfigured()) {
        throw new Error('Shared country research quota is unavailable.');
      }
      if (isDatabaseConfigured()) await reserveSharedCountryResearch(day, key);
    }
    const search = await (client ?? new TavilyClient(1)).search(query, {
      maxResults: request.maxResults, searchDepth: request.searchDepth, timeoutMs: 15_000,
      ...(scope === 'country-government' ? { includeDomains: request.includeDomains } : {}),
    });
    return toResearchResult(country, domain, scope, search, request);
  })();
  if (!client) {
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, result });
    if (cache.size > 700) {
      for (const [oldKey, value] of cache) if (value.expiresAt <= Date.now()) cache.delete(oldKey);
    }
    result.catch(() => { if (cache.get(key)?.result === result) cache.delete(key); });
  }
  return result;
}
