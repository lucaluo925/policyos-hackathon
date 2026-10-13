import { isOfficialSource } from './sources';

/** Only usable, uniquely indexed judgements may discard retrieved evidence. */
export interface ScreeningJudgement {
  index: number;
  relevant: boolean;
  leaning: 'supports' | 'refutes' | 'unclear';
  reason?: string;
}

export function screeningJudgements(value: unknown, documentCount: number): Map<number, ScreeningJudgement> {
  if (!Array.isArray(value)) throw new Error('Screening response did not contain a valid judgement array');
  const result = new Map<number, ScreeningJudgement>();
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const index = row.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= documentCount) continue;
    // Any repeated index is ambiguous, even if the repeated row is malformed.
    if (seen.has(index)) { result.delete(index); continue; }
    seen.add(index);
    if (typeof row.relevant !== 'boolean' ||
      !['supports', 'refutes', 'unclear'].includes(row.leaning as string) ||
      (row.reason !== undefined && typeof row.reason !== 'string')) continue;
    result.set(index, { index, relevant: row.relevant,
      leaning: row.leaning as ScreeningJudgement['leaning'],
      ...(row.reason === undefined ? {} : { reason: row.reason as string }) });
  }
  return result;
}

const GENERIC_TOPIC_WORDS = new Set([
  'about', 'after', 'before', 'during', 'every', 'from', 'goods', 'importer',
  'importers', 'policy', 'regime', 'required', 'requirement', 'rules', 'status',
  'their', 'these', 'those', 'under', 'which', 'would',
]);

/** Screening is a topical shortcut, not a verdict. A rejected official page
 * whose title names the assertion's subject must reach adjudication, where its
 * full saved excerpt can be considered. This does not imply the page proves the
 * assertion, or that every government page is on topic. */
export function preserveTopicalOfficialSource(
  assertionText: string, doc: { url: string; title: string },
): boolean {
  if (!isOfficialSource(doc.url)) return false;
  const sharedAcronym = (assertionText.match(/\b[A-Z]{3,}\b/g) ?? [])
    .some(acronym => new RegExp(`\\b${acronym}\\b`, 'i').test(doc.title));
  if (sharedAcronym) return true;
  const terms = new Set((assertionText.toLowerCase().match(/[a-z]{5,}/g) ?? [])
    .filter(term => !GENERIC_TOPIC_WORDS.has(term)));
  const titleTerms = new Set((doc.title.toLowerCase().match(/[a-z]{5,}/g) ?? [])
    .filter(term => !GENERIC_TOPIC_WORDS.has(term)));
  return [...terms].filter(term => titleTerms.has(term)).length >= 2;
}
