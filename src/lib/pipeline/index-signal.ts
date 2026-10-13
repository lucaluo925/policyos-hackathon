/**
 * Did the index page's extracted signal actually move?
 *
 * The runner writes a PolicyVersion whenever the page hash moves, and pages
 * move for reasons that have nothing to do with policy. For a pipeline with a
 * deepItems hook, the item-level content hash now settles this per item. A
 * pipeline *without* one has only the index signal, and nothing was comparing
 * it:
 *
 *   uk-immigration, every day, verbatim:
 *     "GOV.UK — Immigration Rules: operational guidance updated. (0 deep items)"
 *
 * It had extracted nothing and still asserted that guidance was updated. All
 * the run really knew was that the watched page's bytes differed.
 *
 * Why not reuse hasContentChange: that compares two stored versions by
 * summary, and at the index level the summary is a *template* built from the
 * classification ("... operational guidance updated."). Two runs produce an
 * identical summary whether or not the page moved, so comparing summaries
 * would report no change for a real one. The extracted text is the content.
 */

/** Whitespace-insensitive: re-extraction re-wraps text. */
function normalise(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * True when there is a previous version to compare against and the newly
 * extracted signal is identical to it.
 *
 * Conservative by construction: with no previous version, or with either side
 * empty, this is false and the caller behaves exactly as it did before. An
 * empty extraction is not evidence of sameness -- it is evidence of nothing,
 * and a pipeline that extracts nothing twice should not thereby claim to have
 * verified that the page is unchanged.
 */
export function indexSignalUnchanged(
  previousExtractedText: string | null | undefined,
  currentExtractedText: string | null | undefined,
): boolean {
  const prev = normalise(previousExtractedText);
  const next = normalise(currentExtractedText);
  if (prev === '' || next === '') return false;
  return prev === next;
}

export interface MaterialChangeInput {
  /** False only when a previous version existed and the signal is identical. */
  indexSignalMoved: boolean;
  /** Deep items written as new versions this run. */
  deepItemsWritten: number;
  /** Deep items the hook returned; 0 when the pipeline has no hook. */
  deepItemsPlanned: number;
  /** Deep items recognised as unchanged by content hash. */
  deepItemsUnchanged: number;
}

export type MaterialChangeVerdict =
  | { changed: true }
  | { changed: false; reason: 'items_all_unchanged' | 'signal_identical' };

/**
 * Whether this run has evidence that anything about the policy moved.
 *
 * Narrow on purpose. Items that merely failed to extract leave the run
 * reporting a change, because a failure is not evidence of sameness: if any
 * planned item is unaccounted for, the honest answer is that we do not know.
 */
export function materialChange(input: MaterialChangeInput): MaterialChangeVerdict {
  if (input.indexSignalMoved) return { changed: true };
  if (input.deepItemsWritten > 0) return { changed: true };
  if (input.deepItemsPlanned > 0) {
    return input.deepItemsUnchanged === input.deepItemsPlanned
      ? { changed: false, reason: 'items_all_unchanged' }
      : { changed: true };
  }
  return { changed: false, reason: 'signal_identical' };
}

export interface RunSummaryInput {
  verdict: MaterialChangeVerdict;
  /** What the classifier would have said; a template, not page content. */
  classifierSummary: string;
  deepItemsWritten: number;
  deepItemsUnchanged: number;
  degraded: boolean;
}

/**
 * The one line a run records about itself.
 *
 * Written as a function rather than inline so the no-change wording cannot be
 * expressed as a nested ternary, and so the two no-change cases stay distinct:
 * "the items I list are all unchanged" is a stronger statement than "I could
 * not see any difference in what I extracted", and conflating them would hide
 * which one a given pipeline is actually making.
 */
export function buildRunSummary(input: RunSummaryInput): string {
  if (input.verdict.changed) {
    const tail = input.degraded ? ', degraded' : '';
    return `${input.classifierSummary} (${input.deepItemsWritten} changed, ${input.deepItemsUnchanged} unchanged${tail})`;
  }
  if (input.verdict.reason === 'items_all_unchanged') {
    return `Page changed; all ${input.deepItemsUnchanged} listed items unchanged since last check.`;
  }
  return 'Page bytes changed; extracted content identical to last check.';
}
