/** Extracted unchanged from AIHOT events/relate.ts at
 * e57da5a4f151892a217529744cd68803aec580df.
 * Copyright (c) 2026 数字生命卡兹克. MIT; see aihot-LICENSE.txt.
 * These functions suggest text similarity, not policy identity or truth.
 */

/** The text a report is embedded with: title and the start of the summary, the same on both sides of a comparison. */
export function reportText(title: string, summary: string | null | undefined): string {
  return `${title}。${(summary ?? "").slice(0, 300)}`;
}

/** Lexical stand-in for cosine when embeddings are off (no embedding key): shared character bigrams. */
export function lexicalSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const chars = [...s.replace(/\s+/g, "")];
    return new Set(chars.map((_c, i) => chars.slice(i, i + 2).join("")).filter((g) => g.length === 2));
  };
  const g = grams(a), h = grams(b);
  if (!g.size || !h.size) return 0;
  let inter = 0;
  for (const x of g) if (h.has(x)) inter++;
  return inter / Math.min(g.size, h.size);
}
