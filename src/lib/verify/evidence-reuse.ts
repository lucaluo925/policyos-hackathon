import type { AssertionResult, EvidenceDoc } from './types';

/** Carry issuing-body passages between assertions of the same claim. Recent
 * citations are useful leads, not a substitute for screening the passage
 * against the next assertion. Keep each passage's original request IDs. */
export function reusableIssuerEvidence(
  cached: readonly EvidenceDoc[], current: readonly EvidenceDoc[],
  priorResults: readonly AssertionResult[], limit = 2,
): EvidenceDoc[] {
  const citations = [...priorResults].reverse().flatMap(result => result.citedUrls);
  const citationRank = new Map<string, number>();
  citations.forEach((url, index) => {
    if (!citationRank.has(url)) citationRank.set(url, index);
  });
  return cached
    .map((doc, index) => ({ doc, index }))
    .filter(({ doc }) => !current.some(value =>
      value.url === doc.url && value.snippet === doc.snippet))
    .sort((a, b) => {
      const aRank = citationRank.get(a.doc.url) ?? Number.MAX_SAFE_INTEGER;
      const bRank = citationRank.get(b.doc.url) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank || b.index - a.index;
    })
    .slice(0, limit)
    .map(({ doc }) => doc);
}
