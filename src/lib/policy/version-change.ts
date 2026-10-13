/**
 * Telling a policy change apart from a page that merely churned.
 *
 * The change detector hashes a fetched page and writes a PolicyVersion row
 * whenever the hash moves. Pages move for reasons that have nothing to do
 * with policy — a rotating banner, a "last reviewed" stamp, a related-links
 * block — so a version row means "the source changed", not "the policy
 * changed".
 *
 * Measured on the production database on 2026-10-10: of 2,920 consecutive
 * version pairs, only 456 (15.6%) differ in summary at all. One record,
 * "Immigration and citizenship Website", carries 102 versions whose
 * summaries are identical to each other. Rendering those as a version
 * history claims 102 policy changes the data does not support.
 *
 * So the page needs to distinguish the two, and that is what this decides.
 */

export interface VersionLike {
  summary?: string | null;
  numericValues?: unknown;
  policyType?: string | null;
}

/** Whitespace-insensitive, because re-extraction re-wraps text. */
function normalise(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const empty = (v: unknown) =>
    v === null || v === undefined || (typeof v === 'object' && Object.keys(v as object).length === 0);
  if (empty(a) && empty(b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Did anything about the policy itself change between these two versions?
 *
 * Deliberately narrow: summary text, extracted numbers, and the policy type.
 * Timestamps, hashes and row ids are excluded — they move on every check by
 * construction and would make every version look like a change, which is
 * the state this function exists to end.
 */
export function hasContentChange(prev: VersionLike, next: VersionLike): boolean {
  if (normalise(prev.summary) !== normalise(next.summary)) return true;
  if (!sameJson(prev.numericValues, next.numericValues)) return true;
  return (prev.policyType ?? null) !== (next.policyType ?? null);
}

export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string };

/**
 * Word-level diff, longest-common-subsequence over whitespace-separated
 * tokens. Word level rather than character level because policy text is
 * read as prose: a character diff of a reworded sentence is confetti.
 *
 * Quadratic in token count, so inputs are capped. Summaries are at most a
 * few hundred characters by construction, and the cap is a guard against a
 * pathological row rather than an expected path.
 */
export const DIFF_TOKEN_CAP = 400;

export function diffWords(before: string, after: string): DiffPart[] {
  const a = normalise(before).split(' ').filter(Boolean).slice(0, DIFF_TOKEN_CAP);
  const b = normalise(after).split(' ').filter(Boolean).slice(0, DIFF_TOKEN_CAP);
  if (a.length === 0 && b.length === 0) return [];

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], word: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += ` ${word}`;
    else parts.push({ type, text: word });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('removed', a[i]);
      i++;
    } else {
      push('added', b[j]);
      j++;
    }
  }
  while (i < a.length) push('removed', a[i++]);
  while (j < b.length) push('added', b[j++]);
  return parts;
}

export interface VersionGroup<T> {
  /** The newest version holding this content — what the record says now. */
  version: T;
  /** How many version rows share it, this one included. */
  checks: number;
  /** Index of the first (newest) row in the group, for stable React keys. */
  firstIndex: number;
}

/**
 * Collapse a newest-first version list into one entry per distinct content
 * state.
 *
 * Comparison is against the group's representative rather than the
 * immediate neighbour. Comparing neighbours looks equivalent and is not: a
 * run v102 = v101 = v100 followed by a different v99 would mark v100 as a
 * change (it differs from v99) and emit it alongside v102, even though the
 * two carry identical content. Grouping by content cannot do that.
 */
export function collapseUnchanged<T extends VersionLike>(newestFirst: readonly T[]): VersionGroup<T>[] {
  const groups: VersionGroup<T>[] = [];
  for (let i = 0; i < newestFirst.length; i++) {
    const current = newestFirst[i];
    const open = groups[groups.length - 1];
    if (open && !hasContentChange(current, open.version)) {
      open.checks++;
    } else {
      groups.push({ version: current, checks: 1, firstIndex: i });
    }
  }
  return groups;
}
