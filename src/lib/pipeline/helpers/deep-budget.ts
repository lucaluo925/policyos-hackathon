/**
 * Wall-clock budget for the deep-fetch phase of a run.
 *
 * The pipeline routes declare `maxDuration = 60`. The deep phases declare
 * their own worst cases, and they are all larger than that:
 *
 *   uk-climate       8 items x 15s = 120s
 *   us-immigration   5 items x 12s =  60s
 *   canada, eu, de   3 items x 15s =  45s, plus the index fetch and the
 *                                     per-item matching, version writes and
 *                                     score recompute
 *
 * When the function is killed mid-phase, `endRun` never runs. The row keeps
 * startRun's `partial` placeholder, and the invariant at the top of runner.ts
 * -- every run writes exactly one PipelineRun, success or failure -- is
 * broken. canada-immigration has rows in exactly that state in production.
 *
 * So the phase is bounded instead. An item past the budget still becomes a
 * DeepItem from the index entry it came from, with that entry's title and
 * inline summary; it just does not get its page fetched. The run degrades to
 * shallower data and still reaches endRun, which is strictly better than
 * being killed with nothing recorded.
 *
 * NOTE on canada-immigration specifically: that it was killed is established
 * -- every throw inside runPipeline is caught and recorded as `failed`, so a
 * row left at `partial` can only be a dead process. That the cause was the
 * duration limit is NOT established, and uk-climate finishing daily on a
 * larger budget is evidence against it. This bounds the phase because the
 * invariant should hold under a slow source either way, not because the
 * diagnosis is settled.
 */

/**
 * Leaves roughly 25s of the 60s for the index fetch and the database work
 * around each item. A judgement, not a measurement.
 */
export const DEEP_PHASE_BUDGET_MS = 35_000;

/** Below this there is no point starting a fetch; it would only time out. */
export const MIN_FETCH_MS = 4_000;

export interface DeepBudget {
  /** Milliseconds left, never negative. */
  remaining(): number;
  /** Whether a fetch needing at least this long should be started. */
  allows(minMs?: number): boolean;
  /** The timeout to hand one fetch: the preferred value, capped by what is left. */
  timeoutFor(preferredMs: number): number;
  /** How long the phase has been running, for the run's metadata. */
  elapsed(): number;
}

export function makeDeepBudget(
  budgetMs: number = DEEP_PHASE_BUDGET_MS,
  clock: () => number = Date.now,
): DeepBudget {
  const start = clock();
  const used = () => clock() - start;
  const left = () => Math.max(0, budgetMs - used());
  return {
    remaining: left,
    elapsed: used,
    allows: (minMs: number = MIN_FETCH_MS) => left() >= minMs,
    timeoutFor: (preferredMs: number) => Math.min(preferredMs, left()),
  };
}
