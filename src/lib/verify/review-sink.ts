/**
 * Writes a verification result into the existing review queue.
 *
 * This module is where "the model is a witness, not the judge" stops being a
 * slogan and becomes a property of the code. It was written after reading the
 * resolver rather than before, and the claims below are the ones the resolver
 * actually supports — not the ones that sounded good.
 *
 * THREE INDEPENDENT GUARDS stop a verification verdict from changing a score.
 * Each is in src/lib/review/auto-resolver.ts and each is sufficient alone:
 *
 *   1. `applyScoreChange` (:287) returns early for any targetType that is not
 *      'policy_version'. Verification items use 'claim_verification', so the
 *      score recomputation is never reached.
 *   2. `decide` (:316) returns early the same way, with
 *      blockingFactors ['non_policy_target'].
 *   3. The resolver's candidate scan selects only confidence high|medium.
 *      Verification items are capped at 'low' (AI_INFERRED_CEILING below), so
 *      they are never even considered.
 *
 * WHAT IS *NOT* TRUE, and must not be claimed in a demo or write-up:
 *   - Conflict quarantine does NOT apply. `hasConflict` (:178) returns false
 *     for non-policy_version items, so a conflicted verification never reaches
 *     the 'conflict' status. The conflict flag computed by our pipeline is
 *     recorded on the row for a human reviewer; it does not trigger the
 *     resolver's quarantine path.
 *   - Multi-source corroboration does NOT apply either (`hasMultiSource`, :220,
 *     same guard).
 * The honest summary is narrower than "it goes through the auto-resolver":
 * it enters the same queue, under the same audit trail, and is structurally
 * barred from the paths that mutate scores.
 */

import type { VerificationConfidence } from '@prisma/client';
import { auditRepo, getPrisma, isDatabaseConfigured, reviewRepo } from '@/lib/db';
import type { AssertionResult, VerificationResult } from './types';

/** targetType used for every row this module writes. Deliberately not 'policy_version'. */
export const CLAIM_TARGET_TYPE = 'claim_verification';

/**
 * Secondary ceiling on completed verifications in a rolling 24 hours, counted
 * in assertions because that is the unit that costs money: one assertion is one Tavily
 * retrieval (two if it retries) plus two model calls.
 *
 * This exists for one reason. Judging runs 2026-12-01 to 12-15, weeks after
 * submission, and a public endpoint that spends metered search and inference
 * credits with no ceiling can be drained — by a crawler, or by ordinary
 * traffic — long before a judge ever opens it. A demo that 500s during the
 * judging window loses everything behind it.
 *
 * The cap degrades the page honestly rather than breaking it: the recorded
 * example runs are static files, cost nothing, and stay available.
 *
 * The default is deliberately low because the real remaining quota has not
 * been checked yet. A separate Serializable run reservation in admission.ts
 * counts failed and disconnected attempts before provider calls; this
 * completed-assertion counter alone is not a hard billing limit. Set both
 * limits from verified provider capacity before public traffic.
 */
export const DAILY_ASSERTION_CAP = Number(process.env.VERIFY_DAILY_ASSERTION_CAP ?? 12);

/**
 * How much of the cap is already spent.
 *
 * Counted from the audit entries persistVerification writes. This says how
 * many assertion results were saved; it does not count failed or aborted
 * attempts and must not replace the pre-call run reservation.
 */
export async function countRecentVerifiedAssertions(since: Date): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  return getPrisma().auditLog.count({
    where: {
      entityType: CLAIM_TARGET_TYPE,
      actionType: 'claim_verified',
      createdAt: { gte: since },
    },
  });
}

/**
 * Queue priority for machine-made rows. 1 is most urgent in this schema, so a
 * verdict produced by a model deliberately sits below every human submission.
 */
const MACHINE_ROW_PRIORITY = 5;

/**
 * Highest confidence an AI-inferred row may carry.
 *
 * Capping at 'low' does two things. It keeps these rows out of the resolver's
 * candidate scan (which takes high|medium), so an LLM cannot spend its own
 * self-reported confidence to buy attention from the gate. And it puts them in
 * scope for the low/unverified expiry sweep, so unreviewed verdicts age out
 * after five days instead of accumulating forever.
 */
const AI_INFERRED_CEILING: VerificationConfidence = 'low';

/**
 * Maps an assertion result onto the stored enum.
 *
 * There is deliberately no threshold table here. An earlier version graded the
 * model's 0..1 self-report into high/medium/low — but with the AI ceiling at
 * 'low', every grade above 'low' was immediately capped back down, so those
 * thresholds could not change any outcome while still reading as if they
 * could. Dead numbers in a gate are worse than no numbers.
 *
 * So the enum is binary in practice, and each branch states a reason that does
 * not depend on the model's opinion of itself:
 *   - insufficient_evidence -> 'unverified'. A verdict that says the evidence
 *     does not settle the question cannot also be well-evidenced.
 *   - conflicted -> 'unverified'. Conflict is computed by our code from the
 *     screened documents, so it outranks the model's self-report.
 *   - no cited source -> 'unverified'. A verdict with nothing behind it.
 *   - otherwise -> AI_INFERRED_CEILING.
 *
 * The raw float is stored verbatim in the audit entry, so nothing is lost; it
 * simply does not get a vote at the gate.
 */
export function confidenceToEnum(r: AssertionResult): VerificationConfidence {
  if (r.verdict === 'insufficient_evidence') return 'unverified';
  if (r.conflicted) return 'unverified';
  if (r.citedUrls.length === 0) return 'unverified';
  return AI_INFERRED_CEILING;
}

export interface PersistedAssertion {
  reviewItemId: string;
  assertionId: string;
  storedConfidence: VerificationConfidence;
  /** What the resolver will do with this row, derived from its actual guards. */
  gate: {
    canChangeScore: false;
    enteredCandidateScan: false;
    reason: string;
  };
}

export interface PersistOutcome {
  persisted: PersistedAssertion[];
  skipped?: string;
}

/**
 * Writes one review-queue row and one audit entry per assertion. The entire
 * result is committed as one transaction, so a failed audit write cannot
 * leave an orphaned queue row or a partially saved multi-assertion result.
 *
 * Deduplication is deliberately not done here: the resolver already collapses
 * duplicates by groupKey, and re-running a claim is a legitimate action whose
 * history is worth keeping.
 */
export async function persistVerification(
  result: VerificationResult,
  opts: { actorId?: string } = {},
): Promise<PersistOutcome> {
  if (!isDatabaseConfigured()) {
    return { persisted: [], skipped: 'DATABASE_URL is not set; verification not persisted' };
  }

  const persisted = await getPrisma().$transaction(async (tx): Promise<PersistedAssertion[]> => {
    const rows: PersistedAssertion[] = [];
    for (const r of result.assertions) {
      const storedConfidence = confidenceToEnum(r);
      const targetId = `${slug(result.claim)}::${r.assertion.id}`;

      const item = await reviewRepo.createReviewItem({
        targetType: CLAIM_TARGET_TYPE,
        targetId,
        priority: MACHINE_ROW_PRIORITY,
        confidence: storedConfidence,
        recommendedAction: 'human_review',
        summary: [
          `Claim: ${result.claim}`,
          `Assertion: ${r.assertion.text}`,
          `Verdict: ${r.verdict} (model self-reported confidence ${r.confidence})`,
          r.conflicted ? 'Screened evidence pointed both ways (computed, not self-reported).' : '',
          r.citedUrls.length ? `Cited: ${r.citedUrls.join(' ')}` : 'No sources cited.',
          `Rationale: ${r.rationale}`,
        ]
          .filter(Boolean)
          .join('\n'),
      }, tx);

      await auditRepo.append({
        entityType: CLAIM_TARGET_TYPE,
        entityId: targetId,
        actionType: 'claim_verified',
        actorType: 'system',
        actorId: opts.actorId ?? 'verify-pipeline',
        confidence: storedConfidence,
        sourceUrl: r.citedUrls[0] ?? null,
        // The raw float and the full evidence trail live here, so capping the
        // enum loses no information a reviewer might want.
        newValue: {
          verdict: r.verdict,
          modelConfidence: r.confidence,
          conflicted: r.conflicted,
          citedUrls: r.citedUrls,
          tavilyRequestIds: result.tavilyRequestIds,
          verificationMethod: 'ai_inferred',
        },
        summary: `${r.verdict} — ${r.assertion.text}`,
      }, tx);

      rows.push({
        reviewItemId: item.id,
        assertionId: r.assertion.id,
        storedConfidence,
        // Both fields are literal `false` rather than computed, because with the
        // AI ceiling at 'low' neither can be otherwise. Computing them would
        // imply a branch that cannot be taken.
        gate: {
          canChangeScore: false,
          enteredCandidateScan: false,
          reason:
            `stored as '${storedConfidence}', below the resolver's high|medium candidate ` +
            `scan, and targetType '${CLAIM_TARGET_TYPE}' is rejected by both decide() and ` +
            'applyScoreChange(); row ages out via the low/unverified expiry sweep',
        },
      });
    }
    return rows;
  });

  return { persisted };
}

/** Stable, readable id fragment for a claim. Not a security hash. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
