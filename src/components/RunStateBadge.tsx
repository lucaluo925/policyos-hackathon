/**
 * The status pill for a pipeline run, in one place.
 *
 * It takes the run rather than its status because `startRun` writes
 * `status: 'partial'` as an in-flight placeholder and only `endRun` replaces
 * it. A run killed before endRun therefore keeps that placeholder, and both
 * the country page and /admin used to print it in amber as though it had
 * partly succeeded. See lib/pipeline/run-outcome.ts.
 *
 * Shared so the two pages cannot disagree about what a run's state means,
 * which is how one of them came to be amber while the source tile above it
 * read "all sources reachable".
 */

import { runState, runStateLabel, runStateTone, type RunLike } from '@/lib/pipeline/run-outcome';

const TONE_CLASSES: Record<ReturnType<typeof runStateTone>, string> = {
  ok: 'bg-green-500/15 text-green-400',
  neutral: 'bg-blue-500/15 text-blue-400',
  warn: 'bg-yellow-500/15 text-yellow-400',
  bad: 'bg-red-500/15 text-red-400',
};

export function RunStateBadge({ run, size = 'sm' }: { run: RunLike; size?: 'xs' | 'sm' }) {
  const state = runState(run);
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs font-medium';
  return (
    <span className={`${pad} rounded ${TONE_CLASSES[runStateTone(state)]}`}>
      {runStateLabel(state)}
    </span>
  );
}
