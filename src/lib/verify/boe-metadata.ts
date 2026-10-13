import type { EvidenceDoc } from './types';

const BOE_ID = /^BOE-A-\d{4}-\d{1,6}$/;
const BOE_PATHS = new Set(['/buscar/act.php', '/buscar/doc.php', '/diario_boe/txt.php']);

/** Extract only a BOE document ID from a retrieved issuer URL. The outgoing
 * request is built from this ID, never from the retrieved URL itself. */
export function boeDocumentId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || !['boe.es', 'www.boe.es'].includes(url.hostname.toLowerCase()) ||
        !BOE_PATHS.has(url.pathname)) return null;
    const id = url.searchParams.get('id');
    return id && BOE_ID.test(id) ? id : null;
  } catch { return null; }
}

function isoDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{8}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
}

/** BOE's structured issuer record supplies dates Tavily sometimes omits from
 * long law pages. A failed or missing record adds no evidence. */
export async function readBoeMetadata(
  rawUrl: string,
  opts: {fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number} = {},
): Promise<EvidenceDoc | null> {
  const id = boeDocumentId(rawUrl);
  if (!id) return null;
  const apiUrl = `https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/${id}/metadatos`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6_000);
  try {
    const response = await (opts.fetch ?? fetch)(apiUrl, {
      headers: {Accept: 'application/json'},
      redirect: 'error',
      signal: opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    if (Number(response.headers.get('content-length')) > 32_000) return null;
    const body = await response.text();
    if (body.length > 32_000) return null;
    const parsed = JSON.parse(body) as {status?: {code?: unknown}; data?: unknown};
    if (parsed.status?.code !== '200' || !Array.isArray(parsed.data) || parsed.data.length !== 1) return null;
    const data = parsed.data[0] as Record<string, unknown>;
    if (data.identificador !== id) return null;
    const publication = isoDate(data.fecha_publicacion);
    if (!publication) return null;
    const title = typeof data.titulo === 'string' ? data.titulo.slice(0, 300) : id;
    // fecha_vigencia is intentionally omitted: an amendment can give one law
    // multiple operative dates, which a single metadata field cannot settle.
    return {
      url: apiUrl,
      title: `BOE official open-data metadata: ${title}`,
      retrievalScore: 1,
      snippet: `BOE issuer metadata for ${id}. Publication date (fecha_publicacion): ${publication}. ` +
        `This metadata records publication only; consult the original law's final provision for entry into force.`,
    };
  } catch {
    opts.signal?.throwIfAborted();
    return null;
  } finally { clearTimeout(timer); }
}
