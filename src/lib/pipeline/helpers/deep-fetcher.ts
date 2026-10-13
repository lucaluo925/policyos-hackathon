/**
 * V8 multi-level pipeline:  index → item → full-page fetch → deep extract
 *
 * `fetchAndDeepExtract(url)` fetches a full policy page (via the reliable
 * fetcher) and runs the deep extractor on the resulting content. V8 adds
 * real PDF support: if the URL ends in `.pdf` or the server returns a
 * `application/pdf` content type, we parse it with `pdf-parse` and run
 * the same extractor over the resulting plain text. If parsing fails it's
 * honestly recorded as `parse_error`.
 */
import { reliableFetch } from './fetcher';
import { deepExtractFromHtml, type DeepExtraction } from './deep-extractor';

export interface DeepFetchResult {
  ok: boolean;
  url: string;
  status: number;
  retries: number;
  failureType?: string;
  extraction?: DeepExtraction;
  /** V8: true when the source was a PDF (parsed via pdf-parse). */
  isPdf?: boolean;
  error?: string;
}

async function fetchBinary(
  url: string,
  opts: { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; buffer?: Buffer; error?: string; failureType?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await globalThis.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: 'application/pdf,*/*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      return { ok: false, status: res.status, failureType: 'http_error', error: `HTTP ${res.status}` };
    }
    const ab = await res.arrayBuffer();
    return { ok: true, status: res.status, buffer: Buffer.from(ab) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failureType = msg.toLowerCase().includes('abort') ? 'timeout' : 'network_error';
    return { ok: false, status: -1, error: msg, failureType };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract plain text from a PDF buffer using pdf-parse (pure JS, no native deps). */
async function extractPdfText(buffer: Buffer): Promise<string> {
  // Dynamic import — pdf-parse runs a demo-mode side effect at require time
  // in some versions; the lazy import avoids that hit on cold start for
  // requests that don't touch PDFs.
  const mod = (await import('pdf-parse')) as unknown as { default?: (b: Buffer) => Promise<{ text: string }> };
  const pdfParse = mod.default ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
  const parsed = await pdfParse(buffer);
  return parsed.text ?? '';
}

export async function fetchAndDeepExtract(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<DeepFetchResult> {
  const isPdfUrl = /\.pdf(\?|$)/i.test(url);

  if (isPdfUrl) {
    // V8: real PDF path.
    const bin = await fetchBinary(url, { timeoutMs: opts.timeoutMs ?? 20_000 });
    if (!bin.ok || !bin.buffer) {
      return {
        ok: false,
        url,
        status: bin.status,
        retries: 0,
        failureType: bin.failureType ?? 'fetch_failed',
        error: bin.error,
        isPdf: true,
      };
    }
    try {
      const text = await extractPdfText(bin.buffer);
      if (!text || text.length < 40) {
        return {
          ok: false,
          url,
          status: bin.status,
          retries: 0,
          failureType: 'parse_error',
          error: `PDF parsed but produced ${text.length} chars of text (likely scanned image).`,
          isPdf: true,
        };
      }
      // Run the same HTML-agnostic extraction routines over the plain text.
      // We synthesise a minimal HTML wrapper so `deepExtractFromHtml`'s
      // numeric + action + policy-type logic still fires on the body text.
      const wrapped = `<html><head><title>${url.split('/').slice(-1)[0]}</title></head><body><main><article>${text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</article></main></body></html>`;
      const extraction = deepExtractFromHtml(wrapped, url);
      extraction.extractorSource = 'site-specific'; // mark: came from PDF content, not HTML chrome
      return { ok: true, url, status: bin.status, retries: 0, extraction, isPdf: true };
    } catch (err) {
      return {
        ok: false,
        url,
        status: bin.status,
        retries: 0,
        failureType: 'parse_error',
        error: err instanceof Error ? err.message : String(err),
        isPdf: true,
      };
    }
  }

  // HTML path.
  const res = await reliableFetch(url, {
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxRetries: 1,
  });
  if (!res.ok) {
    return {
      ok: false,
      url,
      status: res.status,
      retries: res.retries,
      failureType: res.failureType,
      error: res.error,
    };
  }
  try {
    const extraction = deepExtractFromHtml(res.text, url);
    return { ok: true, url, status: res.status, retries: res.retries, extraction };
  } catch (err) {
    return {
      ok: false,
      url,
      status: res.status,
      retries: res.retries,
      failureType: 'parse_error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
