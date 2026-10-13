/** A search listing or table of contents locates documents but is not itself
 * the underlying policy. Do not let its concatenated snippets become proof. */
export function isSourceNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const path = decodeURIComponent(url.pathname).toLowerCase();
    return /(?:^|\/)(?:search|search-results|recherche|suche|busqueda)(?:\/|$)/.test(path) ||
      /\/(?:toc|contents|index)\.htm$/i.test(path) ||
      (url.hostname === 'www.immigration.govt.nz' && /^\/opsmanual\/?$/.test(path));
  } catch { return false; }
}

/** Find the current edition of a discovered, date-labelled instruction.
 * The section comes from a Search hit, never a hand-written answer URL.
 * Explicitly historical claims keep their dated discovery unchanged. */
export function currentInstructionTitle(
  claim: string, docs: readonly {url: string; title: string}[],
): string | null {
  if (/\b(?:19|20)\d{2}\b/.test(claim)) return null;
  for (const doc of docs) {
    let url: URL;
    try { url = new URL(doc.url); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== 'www.immigration.govt.nz' ||
        !/^\/opsmanual\/\d+\.htm$/.test(url.pathname)) continue;
    const title = doc.title.match(/^([A-Z]\d+(?:\.\d+)+\s+[^\n]{3,160}?)\s*\(\d{2}\/\d{2}\/\d{4}\)$/);
    if (title) return title[1];
  }
  return null;
}
