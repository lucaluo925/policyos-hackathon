/**
 * Shared change classifier used by most pipelines.
 *
 * Takes the framework's ClassifyInput + a pre-parsed ParsedSignal and emits
 * a ChangeClassification + confidence. The classifier has three layers:
 *
 *   1. Terminal states we can decide cheaply (no prev hash; same hash).
 *   2. Guidance-type aware: a proposal page update is `proposal_only`, a
 *      legal announcement is `new_policy`/`amendment`, operational guidance
 *      is `guidance_update`, an index page diff is `uncertain`.
 *   3. A fallback `uncertain` when the content isn't classifiable — the
 *      runner routes these to the review queue rather than silently
 *      mutating policy state.
 *
 * Deterministic: the same inputs always produce the same output.
 */

import type {
  ChangeClassification,
  VerificationConfidence,
  LifecycleStatus,
} from '@prisma/client';
import type { ClassifyInput, ClassifyResult, ParsedSignal } from '../framework';

export interface SharedClassifyOpts {
  /** Label used in the summary text (e.g. "USCIS newsroom"). */
  sourceLabel: string;
  /** Optional hook: for pipelines with their own extra signals (link count
   *  deltas, etc.), return a suggested classification + confidence override. */
  refine?: (input: ClassifyInput, signal: ParsedSignal) => Partial<ClassifyResult> | null;
}

export function classifyShared(
  input: ClassifyInput,
  signal: ParsedSignal,
  opts: SharedClassifyOpts,
): ClassifyResult {
  const linkDelta =
    signal.linkCount != null && input.previousSignal?.linkCount != null
      ? Math.abs(signal.linkCount - input.previousSignal.linkCount)
      : null;

  // 1. Initial fetch — always a baseline, never a policy change.
  if (input.previousHash === null) {
    return {
      classification: 'no_material_change',
      confidence: 'medium',
      summary: `${opts.sourceLabel}: initial fetch captured (${signal.linkCount ?? 0} links, guidance=${signal.guidanceType ?? 'index'}).`,
    };
  }

  // 2. Byte-identical content.
  if (input.previousHash === input.currentHash) {
    return {
      classification: 'no_material_change',
      confidence: 'high',
      summary: `${opts.sourceLabel}: no byte-level change.`,
    };
  }

  // 3. Guidance-type routing.
  const gt = signal.guidanceType;
  let classification: ChangeClassification = 'uncertain';
  let confidence: VerificationConfidence = 'low';
  let suggestedStatus: LifecycleStatus | undefined;
  let summary: string;

  if (gt === 'proposal') {
    classification = 'proposal_only';
    confidence = 'medium';
    suggestedStatus = 'pending';
    summary = `${opts.sourceLabel}: proposal / consultation text changed. Does not modify active policy.`;
  } else if (gt === 'legal_announcement') {
    classification = 'amendment';
    confidence = 'medium';
    suggestedStatus = 'active';
    summary = `${opts.sourceLabel}: legal announcement / enacted policy text changed.`;
  } else if (gt === 'operational_guidance') {
    classification = 'guidance_update';
    confidence = 'medium';
    suggestedStatus = 'active';
    summary = `${opts.sourceLabel}: operational guidance updated.`;
  } else if (gt === 'news') {
    // News pages change constantly with headlines, but the underlying policy
    // often doesn't. Route to review rather than mutating a policy silently.
    classification = 'uncertain';
    confidence = 'low';
    summary = `${opts.sourceLabel}: news/press index changed. Human review required.`;
  } else {
    // index or unknown
    classification = 'uncertain';
    confidence = 'low';
    summary = `${opts.sourceLabel}: index page changed${
      linkDelta != null ? ` (Δ${linkDelta} links)` : ''
    }. Human review required.`;
  }

  // 4. Refinement hook.
  if (opts.refine) {
    const over = opts.refine(input, signal);
    if (over) {
      if (over.classification) classification = over.classification;
      if (over.confidence) confidence = over.confidence;
      if (over.suggestedStatus) suggestedStatus = over.suggestedStatus;
      if (over.summary) summary = over.summary;
    }
  }

  return { classification, confidence, suggestedStatus, summary };
}
