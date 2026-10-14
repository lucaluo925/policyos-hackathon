import type { CountryResearchDomain, CountryResearchResult, CountryResearchScope, CountryResearchSearch } from './country';

export const COUNTRY_RESEARCH_WAIT_MS = 45_000;
export interface ResearchQuery { countryIso: string; domain: CountryResearchDomain; scope: CountryResearchScope }
export class CountryResearchReadError extends Error {
  constructor(readonly code: 'judge_required' | 'daily_limit' | 'unavailable' | 'invalid_response' | 'timeout') {
    super('Country research did not complete.');
  }
}

/** Never render an unrelated batch or call new URL() on malformed source data. */
export function parseCountryResearchResult(value: unknown, query: ResearchQuery): CountryResearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CountryResearchReadError('invalid_response');
  const data = value as Record<string, unknown>;
  if (data.countryIso !== query.countryIso.toUpperCase() || data.domain !== query.domain || data.scope !== query.scope ||
      typeof data.countryName !== 'string' || !data.countryName.trim() || typeof data.requestId !== 'string' ||
      typeof data.searchedAt !== 'string' || !Number.isFinite(Date.parse(data.searchedAt)) || !Array.isArray(data.items)) {
    throw new CountryResearchReadError('invalid_response');
  }
  let search: CountryResearchSearch | undefined;
  if (data.search !== undefined) {
    if (!data.search || typeof data.search !== 'object') throw new CountryResearchReadError('invalid_response');
    const request = data.search as Record<string, unknown>;
    if (typeof request.query !== 'string' || !request.query.trim() || request.searchDepth !== 'basic' ||
        typeof request.maxResults !== 'number' || !Number.isSafeInteger(request.maxResults) || request.maxResults < 1 ||
        !Array.isArray(request.includeDomains) || !request.includeDomains.every(value => typeof value === 'string' && value.trim())) {
      throw new CountryResearchReadError('invalid_response');
    }
    search = { query: request.query, includeDomains: [...request.includeDomains], searchDepth: request.searchDepth, maxResults: request.maxResults };
  }
  for (const item of data.items) {
    if (!item || typeof item !== 'object' || typeof item.title !== 'string' || !item.title.trim() ||
        typeof item.excerpt !== 'string' || typeof item.url !== 'string' ||
        typeof item.recognizedOfficialDomain !== 'boolean' || typeof item.countryGovernmentDomain !== 'boolean') {
      throw new CountryResearchReadError('invalid_response');
    }
    let url: URL;
    try { url = new URL(item.url); } catch { throw new CountryResearchReadError('invalid_response'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      throw new CountryResearchReadError('invalid_response');
    }
  }
  return { countryIso: data.countryIso as string, countryName: data.countryName,
    domain: query.domain, scope: query.scope, searchedAt: data.searchedAt, requestId: data.requestId,
    ...(search ? { search } : {}),
    items: data.items.map(item => ({ title: item.title, url: item.url, excerpt: item.excerpt,
      recognizedOfficialDomain: item.recognizedOfficialDomain, countryGovernmentDomain: item.countryGovernmentDomain })) };

}

/** Browser wait is bounded; stopping it is not a server cancellation or refund. */
export async function readCountryResearch(query: ResearchQuery, options: {
  signal: AbortSignal; transport?: typeof fetch; timeoutMs?: number;
}): Promise<CountryResearchResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? COUNTRY_RESEARCH_WAIT_MS);
  try {
    const response = await (options.transport ?? fetch)('/api/explore/research', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: query.countryIso, domain: query.domain, scope: query.scope }),
      signal: AbortSignal.any([options.signal, timeout]),
    });
    if (!response.ok) {
      if (response.status === 429) throw new CountryResearchReadError('daily_limit');
      if (response.status === 401) {
        const body = await response.json().catch(() => null);
        if (body?.code === 'judge_required') throw new CountryResearchReadError('judge_required');
      }
      throw new CountryResearchReadError('unavailable');
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new CountryResearchReadError('invalid_response'); }
    return parseCountryResearchResult(data, query);
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (timeout.aborted) throw new CountryResearchReadError('timeout');
    if (error instanceof CountryResearchReadError) throw error;
    throw new CountryResearchReadError('unavailable');
  }
}
