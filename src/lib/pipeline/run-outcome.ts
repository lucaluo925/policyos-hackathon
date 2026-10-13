/**
 * What actually happened to a pipeline run.
 *
 * `startRun` creates the row with `status: 'partial'` as an in-flight
 * placeholder and `endRun` overwrites it, setting `completedAt`. So
 * `completedAt === null` is exactly "endRun never ran", and the only way that
 * happens is the process being killed: every throw inside runPipeline is
 * caught and recorded as `failed`.
 *
 * That left two blind spots, both visible in production on canada-immigration:
 *
 *  - The run row kept the placeholder, so the page printed "partial" in
 *    amber. A run that never finished reads as one that partly succeeded.
 *  - The stability window counts only `status === 'failed'`, and
 *    updateSourceStability is itself inside the run that died, so
 *    consecutiveFails never moved either. A pipeline killed every single
 *    night reported as a healthy source.
 *
 * Nothing inside a killed run can record its own death, so this is derived at
 * read time from the two fields that do carry the truth. It needs no writes
 * and it corrects rows already in the table.
 */

/**
 * A run still in flight after this long was killed. maxDuration on the
 * pipeline routes is 60s, so this is generous by an order of magnitude: the
 * cost of being wrong is calling a live run dead, and the cost of being
 * generous is a few minutes of "running".
 */
export const ABANDONED_AFTER_MS = 10 * 60 * 1000;

export type RunState =
  | 'success'
  | 'partial_success'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'running'
  | 'abandoned';

export interface RunLike {
  status: string;
  startedAt: Date | string;
  /**
   * Required, not optional, on purpose: a caller that narrows its query with
   * `select` and forgets this field would hand every row an undefined here,
   * and every run older than the threshold would be reported as killed. Made
   * required so that omission is a compile error rather than a page full of
   * "did not finish".
   */
  completedAt: Date | string | null;
}

function ms(d: Date | string): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

export function runState(run: RunLike, now: Date = new Date()): RunState {
  if (run.completedAt !== null) return run.status as RunState;
  const age = now.getTime() - ms(run.startedAt);
  // A clock skew or a bad startedAt should not promote a row to abandoned.
  if (Number.isNaN(age)) return 'running';
  return age >= ABANDONED_AFTER_MS ? 'abandoned' : 'running';
}

/** True for a state that means the run lost data, for stability counting. */
export function isFailureState(state: RunState): boolean {
  return state === 'failed' || state === 'abandoned';
}

export function runStateLabel(state: RunState): string {
  switch (state) {
    case 'abandoned':
      return 'did not finish';
    case 'running':
      return 'running';
    case 'partial_success':
      return 'partial';
    default:
      return state;
  }
}

/** success | neutral | warn | bad — what a page should colour it. */
export function runStateTone(state: RunState): 'ok' | 'neutral' | 'warn' | 'bad' {
  switch (state) {
    case 'success':
      return 'ok';
    case 'running':
      return 'neutral';
    case 'partial_success':
    case 'partial':
    case 'skipped':
      return 'warn';
    case 'failed':
    case 'abandoned':
      return 'bad';
    default:
      // Reachable despite the exhaustive cases above, because runState casts
      // `run.status` into RunState rather than validating it -- the column is
      // a Prisma enum today, but a migration that adds a value would
      // otherwise put the string "undefined" into a className. The label
      // falls through to the raw status, so an operator still sees what it
      // actually was.
      return 'warn';
  }
}
