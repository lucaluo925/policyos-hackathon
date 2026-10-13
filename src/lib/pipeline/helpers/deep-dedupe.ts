/**
 * Content identity for a deep item.
 *
 * Why this exists: `runDeepItems` used to skip an item only when a
 * PolicyVersion already existed with that item's URL *and the index page's
 * hash*. The index hash is what put the run on the change path in the first
 * place, so across days it never matched — every item was rewritten as a new
 * version on every run, whether or not its own text had moved. That is what
 * produced 102 identical versions on one record, "12 deep items" in every
 * USCIS summary for five days running, and a daily `amendment` claim.
 *
 * The hash here covers only what the item asserts about policy: its URL, its
 * title, its summary, its body text, its typing and its parsed numbers. It
 * deliberately excludes anything the index page can change on its own.
 */

import { sha256 } from '../framework';
import type { DeepItem } from '../framework';

/** Stable ordering, so key order in numericValues cannot change the hash. */
function canonicalNumerics(values: DeepItem['numericValues']): string {
  if (!values) return '';
  return Object.keys(values)
    .sort()
    .map((k) => `${k}=${String(values[k])}`)
    .join(',');
}

/** Collapse whitespace so a reflowed page is not a content change. */
function norm(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * sha256 over the item's own content. Two items with the same policy content
 * hash identically even if the page around them was rewritten; an item whose
 * text, numbers or typing moved hashes differently.
 */
export function deepItemHash(item: DeepItem): string {
  return sha256(
    [
      norm(item.url),
      norm(item.title),
      norm(item.summary),
      norm(item.extractedText),
      norm(item.policyType),
      norm(item.guidanceType),
      norm(item.effectiveDate),
      canonicalNumerics(item.numericValues),
    ].join('\u0000'),
  );
}

/** Only what the predicate below needs; DeepRunOutcome satisfies it. */
export interface DeepRunAccounting {
  /** Items the deep hook returned for this run. */
  itemsPlanned: number;
  /** Items whose own content hash already existed: checked, not changed. */
  itemsUnchanged: number;
  /** The hook itself threw, so nothing was planned. */
  hookFailed: boolean;
}

/**
 * Was any planned deep item left unaccounted for?
 *
 * Every item the hook planned should end up in one of two buckets: written as
 * a new version, or recognised as unchanged. Anything else errored, and a run
 * that silently drops items is not a success.
 *
 * Two deliberate differences from the predicate this replaces
 * (`itemsPlanned > 0 && written === 0`):
 *
 *  - A day on which the index page moved but no listed item did now reads as
 *    success. It used to read as partial_success, because before the dedup key
 *    was the item's own content nothing was ever recognised as unchanged.
 *  - A run that wrote some items and errored on the rest now reads as
 *    partial_success. It used to read as success merely because the written
 *    count was above zero, which is the kind of thing this codebase keeps
 *    finding: a green status over a run that lost data.
 */
export function deepRunDegraded(outcome: DeepRunAccounting, written: number): boolean {
  if (outcome.hookFailed) return true;
  return written + outcome.itemsUnchanged < outcome.itemsPlanned;
}
