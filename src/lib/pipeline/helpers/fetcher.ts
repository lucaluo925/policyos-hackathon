/**
 * V6 reliable fetcher.
 *
 * Wraps `globalThis.fetch` with:
 *   - timeout (default 25s, bumpable per-site)
 *   - retry with exponential backoff (0ms → 800ms → 2400ms)
 *   - UA rotation — falls back to a browser-flavoured UA on 403/429
 *   - failure classification: timeout | tls_error | http_error | aborted |
 *     network_error | parse_error (set by caller)
 *
 * Classification is the key reliability improvement over V5: persistent
 * failures are now distinguishable in the admin dashboard, so "Japan trade
 * keeps timing out" is visible as a class of problem rather than lost in
 * generic `failed` rows.
 */
import type { FetchResult } from '../framework';

export type FailureType =
  | 'timeout'
  | 'tls_error'
  | 'http_error'
  | 'aborted'
  | 'network_error'
  | 'parse_error'
  | 'fetch_failed';

export interface ReliableFetchResult extends FetchResult {
  failureType?: FailureType;
  retries: number;
}

const USER_AGENTS = [
  // Primary — browser-flavoured
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  // Secondary — alternate Chrome profile
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  // Tertiary — Firefox fallback
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
];

function classify(err: unknown, statusCode?: number): FailureType {
  if (statusCode !== undefined) {
    if (statusCode < 0) return 'network_error';
    if (statusCode >= 400) return 'http_error';
  }
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes('aborted')) return 'aborted';
    if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
    if (m.includes('tls') || m.includes('ssl') || m.includes('certificate') || m.includes('handshake')) {
      return 'tls_error';
    }
    if (m.includes('fetch failed') || m.includes('network') || m.includes('enotfound') || m.includes('econnrefused')) {
      return 'network_error';
    }
  }
  return 'fetch_failed';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ReliableFetchOptions {
  timeoutMs?: number; // per attempt
  maxRetries?: number; // default 2 (total 3 attempts)
  acceptHeader?: string;
  /** Override initial UA. Retry rotates through USER_AGENTS. */
  userAgent?: string;
  /** Additional headers. */
  headers?: Record<string, string>;
  /** V7: alternate URLs tried sequentially if the primary fails. */
  fallbackUrls?: string[];
}

export async function reliableFetch(
  url: string,
  opts: ReliableFetchOptions = {},
): Promise<ReliableFetchResult & { finalUrl?: string }> {
  // V7: try primary URL, then fallbacks. For each URL we still retry up to
  // maxRetries times with UA rotation + backoff.
  const candidates = [url, ...(opts.fallbackUrls ?? [])];
  let lastResult: ReliableFetchResult & { finalUrl?: string } = {
    ok: false,
    status: -1,
    text: '',
    fetchedAt: new Date(),
    retries: 0,
    failureType: 'fetch_failed',
  };
  for (const candidate of candidates) {
    const r = await attemptFetch(candidate, opts);
    lastResult = { ...r, finalUrl: candidate };
    if (r.ok) return lastResult;
  }
  return lastResult;
}

async function attemptFetch(
  url: string,
  opts: ReliableFetchOptions,
): Promise<ReliableFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const maxRetries = opts.maxRetries ?? 2;
  const accept = opts.acceptHeader ?? 'text/html,application/xhtml+xml,application/xml;q=0.9';
  const attempts = maxRetries + 1;

  let lastErr: unknown;
  let lastStatus = -1;
  let lastFailure: FailureType = 'fetch_failed';

  for (let attempt = 0; attempt < attempts; attempt++) {
    const ua = attempt === 0 && opts.userAgent
      ? opts.userAgent
      : USER_AGENTS[attempt % USER_AGENTS.length];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await globalThis.fetch(url, {
        headers: {
          'User-Agent': ua,
          Accept: accept,
          'Accept-Language': 'en',
          ...(opts.headers ?? {}),
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (res.ok) {
        const text = await res.text();
        return {
          ok: true,
          status: res.status,
          text,
          fetchedAt: new Date(),
          retries: attempt,
        };
      }
      // Non-OK: retry on 403/429/5xx with a different UA, fail fast on 404
      lastStatus = res.status;
      lastFailure = 'http_error';
      if (res.status === 404) {
        return {
          ok: false,
          status: res.status,
          text: '',
          fetchedAt: new Date(),
          retries: attempt,
          failureType: 'http_error',
          error: 'HTTP 404',
        };
      }
      // Consume body to free connection
      try { await res.text(); } catch { /* ignore */ }
      if (attempt === attempts - 1) {
        return {
          ok: false,
          status: res.status,
          text: '',
          fetchedAt: new Date(),
          retries: attempt,
          failureType: lastFailure,
          error: `HTTP ${res.status}`,
        };
      }
    } catch (err) {
      lastErr = err;
      lastFailure = classify(err);
      if (attempt === attempts - 1) {
        return {
          ok: false,
          status: -1,
          text: '',
          fetchedAt: new Date(),
          retries: attempt,
          failureType: lastFailure,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      clearTimeout(timer);
    }

    // Exponential backoff: 0 → 800 → 2400 ms
    const wait = attempt === 0 ? 800 : 2_400;
    await sleep(wait);
  }

  // Unreachable
  return {
    ok: false,
    status: lastStatus,
    text: '',
    fetchedAt: new Date(),
    retries: attempts - 1,
    failureType: lastFailure,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown'),
  };
}
