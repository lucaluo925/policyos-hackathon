/**
 * Tavily client — the pipeline's core live discovery and document-text source.
 *
 * Why this is load-bearing rather than decorative: PolicyOS's 13 ingestion
 * pipelines crawl a *fixed* list of official sources on a schedule. That is
 * the right design for monitoring known policies, and useless for an arbitrary
 * claim about something nobody registered a source for. Without live retrieval
 * every out-of-corpus claim returns "no evidence" and the adjudicator has
 * nothing to adjudicate. Removing this module does not degrade the product; it
 * empties it. A retrieved Spanish BOE law may also receive a bounded
 * issuer-metadata lookup for its publication date.
 *
 * Two deliberate constraints:
 *   - A hard per-run call budget. The account has pay-as-you-go enabled, so a
 *     retry loop is a billing bug, not just a latency bug.
 *   - `requestId` is captured for every call. It goes into the evidence trail
 *     alongside the URLs, so a reviewer can reproduce what was retrieved.
 */

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';

export interface TavilyHit {
  url: string;
  title: string;
  score: number;
  content: string;
}

export interface TavilySearchResult {
  hits: TavilyHit[];
  requestId: string;
  elapsedMs: number;
}

export interface TavilyExtractResult {
  passages: Array<{ url: string; content: string }>;
  requestId: string;
  creditsReported?: number;
}

export class TavilyBudgetExceeded extends Error {}

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

/**
 * A per-run budget holder. One instance per verification request; the caller
 * passes it to every search so the cap is enforced across assertions, not
 * per-assertion.
 */
export class TavilyClient {
  private used = 0;

  constructor(
    private readonly budget: number,
    private readonly apiKey = process.env.TAVILY_API_KEY ?? '',
  ) {}

  get callsUsed(): number {
    return this.used;
  }

  /** One bounded batch; shares the Search call budget and never retries. */
  async extract(
    urls: readonly string[],
    query?: string,
    opts: { signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch } = {},
  ): Promise<TavilyExtractResult> {
    opts.signal?.throwIfAborted();
    if (!this.apiKey) throw new Error('TAVILY_API_KEY is not set');
    if (!urls.length || urls.length > 3) throw new Error('Extract requires 1 to 3 source URLs');
    if (this.used >= this.budget) throw new TavilyBudgetExceeded(`Tavily call budget of ${this.budget} exhausted for this run`);
    this.used += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);
    try {
      const res = await (opts.fetch ?? fetch)(TAVILY_EXTRACT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ urls, ...(query ? { query, chunks_per_source: 5 } : {}), extract_depth: 'basic',
          format: 'text', timeout: 20, include_usage: true }),
        signal: opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Tavily Extract HTTP ${res.status}: ${text.slice(0, 300)}`);
      const data = JSON.parse(text) as {
        results?: Array<{ url?: unknown; raw_content?: unknown }>;
        request_id?: string; usage?: { credits?: number };
      };
      return {
        passages: (data.results ?? []).flatMap(r => typeof r.url === 'string' && typeof r.raw_content === 'string'
          && r.raw_content.trim() ? [{ url: r.url, content: r.raw_content }] : []),
        requestId: data.request_id ?? '',
        ...(Number.isFinite(data.usage?.credits) ? { creditsReported: data.usage!.credits } : {}),
      };
    } finally { clearTimeout(timer); }
  }

  async search(
    query: string,
    opts: { maxResults?: number; timeoutMs?: number; signal?: AbortSignal; fetch?: typeof fetch;
      includeDomains?: readonly string[] } = {},
  ): Promise<TavilySearchResult> {
    opts.signal?.throwIfAborted();
    if (!this.apiKey) {
      throw new Error('TAVILY_API_KEY is not set');
    }
    if (this.used >= this.budget) {
      throw new TavilyBudgetExceeded(
        `Tavily call budget of ${this.budget} exhausted for this run`,
      );
    }
    this.used += 1;

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await (opts.fetch ?? fetch)(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: opts.maxResults ?? 5,
          search_depth: 'basic',
          ...(opts.includeDomains?.length ? {
            include_domains: opts.includeDomains,
            include_domains_mode: 'restrict',
          } : {}),
        }),
        signal: opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Tavily HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = JSON.parse(text) as {
        results?: Array<{ url?: string; title?: string; score?: number; content?: string }>;
        request_id?: string;
      };
      return {
        hits: (data.results ?? [])
          .filter((r): r is { url: string } & typeof r => Boolean(r.url))
          .map((r) => ({
            url: r.url,
            title: r.title ?? r.url,
            score: typeof r.score === 'number' ? r.score : 0,
            content: r.content ?? '',
          })),
        requestId: data.request_id ?? '',
        elapsedMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
