/**
 * The pre-registered event studies, and how many events each one covers.
 *
 * The home page used to print a literal 24 next to three live numbers. It
 * was right when two studies existed and went stale the day a third was
 * registered — which is how a hard-coded figure beside live ones always
 * ends. The numbers below are still literals, but a test reads each
 * study's registration and its frozen event file and fails if they drift,
 * so the figure cannot quietly stop being true.
 */

export interface EventStudy {
  /** Matches the hypotheses file: research/hypotheses_<id>.json */
  id: string;
  label: string;
  /** Events in the treatment arm — the ones the study's hypotheses are about. */
  events: number;
  /** Events in a no-op control arm, run through the same pipeline. */
  controlEvents: number;
  frozenFile: string;
  hypothesesFile: string;
}

export const EVENT_STUDIES: readonly EventStudy[] = [
  {
    id: 'v1',
    label: 'US export controls on semiconductor equipment',
    events: 16,
    controlEvents: 0,
    frozenFile: 'research/events/frozen_events_v1.csv',
    hypothesesFile: 'research/hypotheses_v1.json',
  },
  {
    id: 'cn_v1',
    label: "China's critical-mineral export controls",
    events: 8,
    controlEvents: 0,
    frozenFile: 'research/events/cn_countermeasures_v1.csv',
    hypothesesFile: 'research/hypotheses_cn_v1.json',
  },
  {
    id: 'fut_v1',
    label: 'US Section 301 tariff actions, against agricultural futures',
    events: 10,
    controlEvents: 25,
    frozenFile: 'research/events/frozen_events_fut_v1.csv',
    hypothesesFile: 'research/hypotheses_fut_v1.json',
  },
];

/** Events the registered hypotheses are about, across all studies. */
export const POLICY_EVENTS_STUDIED = EVENT_STUDIES.reduce((n, s) => n + s.events, 0);

/** Events run through the same pipeline purely as a no-op control. */
export const POLICY_CONTROL_EVENTS = EVENT_STUDIES.reduce((n, s) => n + s.controlEvents, 0);
