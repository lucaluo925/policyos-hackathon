/**
 * Minimal Atom / RSS 2.0 parser.
 *
 * Regex-based and intentionally lenient — we only need entry title, link,
 * id, updated/published, and summary. Anything fancier (namespaces, nested
 * extensions) would need a real XML parser, but the GOV.UK Atom feeds we
 * ingest are plain and stable.
 */

export interface FeedEntry {
  guid: string;
  title: string;
  link: string | null;
  summary: string | null;
  publishedAt: string; // ISO source date; empty when unavailable
  sourceDate: string | null; // original feed date, before the host parses a timezone-less value
  dateKind: 'published' | 'updated' | 'unknown';
  datePrecision: 'day' | 'timestamp' | 'unknown';
  raw: string; // the raw XML slice, useful for debugging
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\u00ad/g, ''); // soft hyphens (Swedish/Hindi feeds) break matching and display
}

function extract(re: RegExp, haystack: string): string | null {
  const m = haystack.match(re);
  if (!m) return null;
  const inner = m[1] ?? '';
  return decodeXmlEntities(inner.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/<[^>]+>/g, ' ') // entity-escaped HTML in RSS descriptions
    .replace(/\s+/g, ' ')
    .trim();
}

function extractLinkHref(haystack: string): string | null {
  // Atom: <link rel="alternate" href="..."/> or just <link href=".."/>
  const atomAlt = haystack.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (atomAlt) return decodeXmlEntities(atomAlt[1]);
  const atomHref = haystack.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  if (atomHref) return decodeXmlEntities(atomHref[1]);
  // RSS: <link>https://...</link>
  const rss = haystack.match(/<link>\s*([^<]+?)\s*<\/link>/i);
  if (rss) return decodeXmlEntities(rss[1]);
  return null;
}

/** Parse an Atom or RSS 2.0 feed string into normalized entries. */
export function parseFeed(xml: string): FeedEntry[] {
  // Try Atom first (<entry>...</entry>), fall back to RSS (<item>...</item>).
  const atomEntries = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const rssItems = atomEntries.length
    ? []
    : [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);

  const blocks = atomEntries.length ? atomEntries : rssItems;

  const out: FeedEntry[] = [];
  for (const block of blocks) {
    const title = extract(/<title[^>]*>([\s\S]*?)<\/title>/i, block);
    if (!title) continue;
    const link = extractLinkHref(block);
    const summary =
      extract(/<summary[^>]*>([\s\S]*?)<\/summary>/i, block) ??
      extract(/<description[^>]*>([\s\S]*?)<\/description>/i, block) ??
      extract(/<content[^>]*>([\s\S]*?)<\/content>/i, block);
    const guidFromAtom =
      extract(/<id[^>]*>([\s\S]*?)<\/id>/i, block) ??
      extract(/<guid[^>]*>([\s\S]*?)<\/guid>/i, block);
    const published = extract(/<published[^>]*>([\s\S]*?)<\/published>/i, block)
      ?? extract(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i, block)
      ?? extract(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i, block);
    const updated = extract(/<updated[^>]*>([\s\S]*?)<\/updated>/i, block);
    const sourceDate = published ?? updated;
    const dateKind = published ? 'published' : updated ? 'updated' : 'unknown';

    const guid = guidFromAtom ?? link ?? `${title}-${sourceDate ?? 'undated'}`;
    const publishedAt = parseDate(sourceDate);

    out.push({
      guid,
      title,
      link,
      summary,
      publishedAt,
      sourceDate,
      dateKind,
      datePrecision: !publishedAt ? 'unknown' : /^\d{4}-\d{2}-\d{2}$/.test(sourceDate!) ? 'day' : 'timestamp',
      raw: block.slice(0, 2_000),
    });
  }
  return out;
}

function parseDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const iso=d.toISOString();
  // Date-only source values contain no time; reject calendar rollover such as
  // February 30 rather than silently turning it into a different source day.
  return /^\d{4}-\d{2}-\d{2}$/.test(s)&&iso.slice(0,10)!==s ? '' : iso;
}
