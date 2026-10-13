/**
 * V7 per-site extractor registry.
 *
 * For known hosts we use targeted selectors to carve out the *actual*
 * article/policy body, because the generic `<main>`/`<article>` fallback
 * often includes boilerplate nav the sites themselves don't mark up
 * semantically. When no site-specific extractor matches, we fall back to
 * the generic deep extractor.
 *
 * Each site extractor returns a `cleanBody` string; the rest of the
 * extraction (numeric values, actions, policy type) is then run over it.
 */

export interface SiteSlicer {
  /** Hostname or URL-prefix this applies to. */
  host: string;
  /** Extracts the primary article body from the raw HTML. Returns null if
   *  it can't find a targeted body — the caller will fall back to generic. */
  slice(html: string): string | null;
}

function sliceByClassRegex(html: string, classRe: RegExp): string | null {
  // Find a tag whose class attr matches classRe; pull the balanced slice.
  // Simple linear scan — HTML from GOV.UK etc. is friendly to this approach.
  const m = html.match(new RegExp(`<(div|article|section)\\b[^>]*class="[^"]*${classRe.source}[^"]*"[^>]*>`, 'i'));
  if (!m) return null;
  const start = m.index! + m[0].length;
  // Balance counter from the opened tag to find its matching close.
  // Cheap heuristic: take until the first `</article>` or `</main>` or 12k chars.
  const tail = html.slice(start, start + 30_000);
  const closeIdx = tail.search(/<\/(?:article|main|div|section)>/i);
  return closeIdx > 0 ? tail.slice(0, closeIdx) : tail;
}

const GOVUK: SiteSlicer = {
  host: 'gov.uk',
  slice(html) {
    // GOV.UK article body: <div class="govspeak"> or <div class="gem-c-govspeak">
    return (
      sliceByClassRegex(html, /\bgovspeak\b/) ??
      sliceByClassRegex(html, /\bgem-c-govspeak\b/)
    );
  },
};

const BMUV: SiteSlicer = {
  host: 'bmuv.de',
  slice(html) {
    // BMUV uses <div class="content-area"> or <main id="content">
    return (
      sliceByClassRegex(html, /\bcontent-area\b/) ??
      sliceByClassRegex(html, /\bbmuv_content\b/) ??
      sliceByClassRegex(html, /\bce-bodytext\b/)
    );
  },
};

const USCIS: SiteSlicer = {
  host: 'uscis.gov',
  slice(html) {
    // USCIS pages: <div class="usa-section"> or <div id="main-content">
    return (
      sliceByClassRegex(html, /\busa-section\b/) ??
      sliceByClassRegex(html, /\busa-layout-docs-main_content\b/) ??
      sliceByClassRegex(html, /\bview-content\b/)
    );
  },
};

const EU_TRADE: SiteSlicer = {
  host: 'europa.eu',
  slice(html) {
    // EC DG Trade pages: <main id="main-content">, or <div class="ecl-article">
    return (
      sliceByClassRegex(html, /\becl-article\b/) ??
      sliceByClassRegex(html, /\becl-page-banner\b/) ??
      sliceByClassRegex(html, /\bmain-content\b/)
    );
  },
};

const GOVBR: SiteSlicer = {
  host: 'gov.br',
  slice(html) {
    return sliceByClassRegex(html, /\bconteudo-principal\b/) ?? sliceByClassRegex(html, /\btile-body\b/);
  },
};

const SLICERS: SiteSlicer[] = [GOVUK, BMUV, USCIS, EU_TRADE, GOVBR];

/** Resolve a slicer by URL hostname. */
export function sliceForUrl(url: string, html: string): string | null {
  try {
    const host = new URL(url).hostname;
    for (const s of SLICERS) {
      if (host.endsWith(s.host)) {
        const sliced = s.slice(html);
        if (sliced && sliced.trim().length > 200) return sliced;
      }
    }
  } catch {
    /* fall through to null */
  }
  return null;
}
