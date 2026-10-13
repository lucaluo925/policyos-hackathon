import { deepExtractFromHtml } from '@/lib/pipeline/helpers/deep-extractor';
import { currentInstructionTitle } from './source-navigation';
import { selectSourceExcerpt } from './source-inspection';
import { OFFICIAL_ADJUDICATION_EXCERPT_LIMIT, type EvidenceDoc } from './types';

const INDEX = 'https://www.immigration.govt.nz/opsmanual/toc.htm';
const normalize = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Resolve a discovered section against the issuer's current contents page.
 * Reject ambiguous labels and off-host/non-document links, including redirects. */
export function currentManualUrl(indexHtml: string, title: string): string | null {
  const urls = new Set<string>();
  for (const match of indexHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (normalize(match[2]) !== title) continue;
    let url: URL;
    try { url = new URL(match[1], INDEX); } catch { continue; }
    if (url.origin === new URL(INDEX).origin && !url.username && !url.password &&
        /^\/opsmanual\/\d+\.htm$/.test(url.pathname) && !url.search && !url.hash) urls.add(url.href);
  }
  return urls.size === 1 ? [...urls][0] : null;
}

async function boundedHtml(url: string, maxBytes: number, transport: typeof fetch, signal: AbortSignal) {
  const response = await transport(url, {redirect: 'manual', signal,
    headers: {Accept: 'text/html', 'User-Agent': 'PolicyOS/0.1 (+https://policyos-app.vercel.app)'}});
  if (!response.ok || !/^text\/html\b|^application\/xhtml\+xml\b/i.test(response.headers.get('content-type') ?? '')) return null;
  if (Number(response.headers.get('content-length')) > maxBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > maxBytes) {await reader.cancel(); return null;}
    chunks.push(item.value);
  }
  return {html: new TextDecoder().decode(Buffer.concat(chunks)), bytes};
}

export async function discoverCurrentManual(
  claim: string, seed: EvidenceDoc, opts: {fetch?: typeof fetch; signal?: AbortSignal} = {},
): Promise<EvidenceDoc | null> {
  const title = currentInstructionTitle(claim, [seed]);
  if (!title) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  try {
    const index = await boundedHtml(INDEX, 600_000, opts.fetch ?? fetch, signal);
    if (!index) return null;
    const url = currentManualUrl(index.html, title);
    if (!url || url === seed.url) return null;
    const source = await boundedHtml(url, 150_000, opts.fetch ?? fetch, signal);
    if (!source) return null;
    const body = deepExtractFromHtml(source.html, url).cleanBody;
    if (!body.includes(title) || /These are archived immigration instructions that are no longer current/i.test(body)) return null;
    return {url, title, retrievalScore: 0,
      snippet: selectSourceExcerpt(body, claim, '', OFFICIAL_ADJUDICATION_EXCERPT_LIMIT),
      issuerHtmlRead: true,
      issuerDiscovery: {seedUrl: seed.url, indexUrl: INDEX, seedRequestId: seed.searchRequestId,
        readBytes: index.bytes + source.bytes}};
  } finally {clearTimeout(timer);}
}
