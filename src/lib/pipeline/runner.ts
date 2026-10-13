/**
 * Pipeline runner — orchestrates a single end-to-end run.
 *
 * V5 changes:
 *   - After the index run, if the pipeline exposes a `deepItems(...)` hook,
 *     iterate items and create one Policy + PolicyVersion per item, with
 *     structured extraction fields (policyType, numericValues).
 *   - On every created PolicyVersion with medium+ confidence, run the
 *     keyword → submetric mapper. High-confidence hints auto-apply +
 *     trigger score recomputation. Lower-confidence hints are written to
 *     the PolicyVersion but don't move scores — review queue picks them up.
 *
 * Invariant preserved: every run writes exactly one PipelineRun + one
 * SourceSnapshot, success or failure.
 */

import {
  auditRepo,
  pipelineRepo,
  policyRepo,
  reviewRepo,
  sourceRepo,
} from '@/lib/db';
import { prisma } from '@/lib/db/client';
import { recomputeScoresAfterPolicyChange } from '@/lib/scoring/engine';
import {
  mapTextToSubmetrics,
  detectPolicyType,
  applyV7Tiered,
  type V6Hint,
  type EvidenceTier,
} from '@/lib/scoring/mapping';
import type { Domain, ImpactDirection } from '@prisma/client';
import { deepItemHash, deepRunDegraded } from './helpers/deep-dedupe';
import { deepItemDisposition } from './helpers/deep-disposition';
import { extractActions } from './helpers/deep-extractor';
import { isFailureState, runState } from './run-outcome';
import { buildRunSummary, indexSignalUnchanged, materialChange } from './index-signal';
import {
  sha256,
  type DeepItem,
  type PipelineDefinition,
  type RunOutcome,
  type SourceContext,
  type ParsedSignal,
} from './framework';
import { matchExistingPolicy } from './helpers/matcher';
import type { FailureAwareFetch } from './helpers/factory';
import { autoResolveReviewQueue } from '@/lib/review/auto-resolver';

/**
 * V11 stability + self-healing + auto-switch primary.
 *
 * On every run end, this function:
 *   1. Recomputes the source's rolling failure rate over last 10 runs
 *   2. Updates `isStable` (threshold 50%)
 *   3. Bumps `consecutiveFails` / `consecutiveSuccesses` appropriately
 *   4. Applies adaptive scheduling:
 *        3 consecutive fails    → checkFrequencyHours = base * 2 (slow down)
 *        3 consecutive successes → checkFrequencyHours = base     (restore)
 *   5. Auto-switches primary sourceUrl when `isStable=false` AND a fallback
 *      is available: swaps in the best candidate fallback, snapshots the
 *      original URL into `originalPrimaryUrl`, flips `switchedToFallback`,
 *      writes an `auto_switch_primary` audit entry. The resolver also has
 *      a switch-BACK path: if the original primary recovers on its next
 *      manual check (i.e. the next run clears `consecutiveFails`), we
 *      promote it back.
 */
async function updateSourceStability(
  monitoredSourceId: string,
  opts: { lastOk: boolean; usedUrl?: string; primaryUrl?: string },
): Promise<{ failureRate: number; isStable: boolean; switched?: string }> {
  const WINDOW = 10;
  const UNSTABLE_THRESHOLD = 0.5;

  const src = await prisma.monitoredSource.findUnique({
    where: { id: monitoredSourceId },
    select: {
      id: true,
      sourceUrl: true,
      fallbackUrls: true,
      baseFrequencyHours: true,
      checkFrequencyHours: true,
      consecutiveFails: true,
      consecutiveSuccesses: true,
      originalPrimaryUrl: true,
      switchedToFallback: true,
    },
  });
  if (!src) return { failureRate: 0, isStable: true };

  const recent = await prisma.pipelineRun.findMany({
    where: { monitoredSourceId },
    orderBy: { startedAt: 'desc' },
    take: WINDOW,
    select: { status: true, startedAt: true, completedAt: true },
  });
  // A killed run keeps startRun's `partial` placeholder, so counting only
  // `status === 'failed'` made a pipeline that dies every night look stable --
  // and updateSourceStability is itself inside the run that died, so
  // consecutiveFails never moved either. See run-outcome.ts.
  const failed = recent.filter((r) => isFailureState(runState(r))).length;
  const rate = recent.length === 0 ? 0 : failed / recent.length;
  const isStable = rate < UNSTABLE_THRESHOLD;

  const nextFails = opts.lastOk ? 0 : src.consecutiveFails + 1;
  const nextSuccesses = opts.lastOk ? src.consecutiveSuccesses + 1 : 0;

  // Adaptive scheduling
  let nextFrequency = src.checkFrequencyHours;
  if (!opts.lastOk && nextFails >= 3 && src.checkFrequencyHours < src.baseFrequencyHours * 2) {
    nextFrequency = src.baseFrequencyHours * 2; // slow down on sustained failure
  } else if (opts.lastOk && nextSuccesses >= 3 && src.checkFrequencyHours !== src.baseFrequencyHours) {
    nextFrequency = src.baseFrequencyHours; // restore on recovery
  }

  let switched: string | undefined;
  let updatedSourceUrl = src.sourceUrl;
  let updatedFallbacks = src.fallbackUrls;
  let updatedOriginalPrimary = src.originalPrimaryUrl;
  let updatedSwitchedFlag = src.switchedToFallback;

  // Auto-switch primary: when source is unstable AND we have a fallback,
  // promote first fallback to primary and demote the old primary into
  // fallbackUrls so a recovery switch-back is possible.
  if (!isStable && src.fallbackUrls.length > 0 && !src.switchedToFallback) {
    const [newPrimary, ...rest] = src.fallbackUrls;
    updatedSourceUrl = newPrimary;
    updatedFallbacks = [...rest, src.sourceUrl];
    updatedOriginalPrimary = src.sourceUrl;
    updatedSwitchedFlag = true;
    switched = `${src.sourceUrl} → ${newPrimary}`;
    await auditRepo.append({
      entityType: 'monitored_source',
      entityId: src.id,
      actionType: 'auto_switch_primary',
      actorType: 'resolver',
      actorId: 'stability-auto-switch',
      confidence: 'medium',
      summary: `Primary source auto-switched after failureRate=${rate.toFixed(2)}: ${switched}`,
      previousValue: { sourceUrl: src.sourceUrl },
      newValue: { sourceUrl: newPrimary, originalPrimaryUrl: src.sourceUrl },
    });
  } else if (isStable && src.switchedToFallback && nextSuccesses >= 3 && src.originalPrimaryUrl) {
    // Switch back: original primary has had 3 consecutive successes.
    const oldPrimary = src.originalPrimaryUrl;
    updatedFallbacks = [src.sourceUrl, ...src.fallbackUrls.filter((u) => u !== oldPrimary)];
    updatedSourceUrl = oldPrimary;
    updatedOriginalPrimary = null;
    updatedSwitchedFlag = false;
    switched = `restored: ${src.sourceUrl} → ${oldPrimary}`;
    await auditRepo.append({
      entityType: 'monitored_source',
      entityId: src.id,
      actionType: 'auto_switch_restore',
      actorType: 'resolver',
      actorId: 'stability-auto-switch',
      confidence: 'medium',
      summary: `Original primary restored after ${nextSuccesses} consecutive successes: ${switched}`,
    });
  }

  await prisma.monitoredSource.update({
    where: { id: monitoredSourceId },
    data: {
      failureRate: Number(rate.toFixed(3)),
      isStable,
      consecutiveFails: nextFails,
      consecutiveSuccesses: nextSuccesses,
      checkFrequencyHours: nextFrequency,
      sourceUrl: updatedSourceUrl,
      fallbackUrls: updatedFallbacks,
      originalPrimaryUrl: updatedOriginalPrimary,
      switchedToFallback: updatedSwitchedFlag,
    },
  });
  return { failureRate: rate, isStable, switched };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Lightweight action extractor for text that wasn't deep-fetched (no access
 *  to the richer helper). Mirrors the verb list in deep-extractor. */

function hintsToImpact(hints: ReturnType<typeof mapTextToSubmetrics>['hints']): {
  direction: ImpactDirection;
  magnitude: number;
  affected: string[];
} {
  if (hints.length === 0) return { direction: 'neutral', magnitude: 0, affected: [] };
  const pos = hints.filter((h) => h.direction === 'positive').length;
  const neg = hints.filter((h) => h.direction === 'negative').length;
  const mixed = hints.some((h) => h.direction === 'mixed');
  const direction: ImpactDirection = mixed
    ? 'mixed'
    : pos > neg
    ? 'positive'
    : neg > pos
    ? 'negative'
    : 'neutral';
  const magnitude = Math.min(5, Math.round(hints.reduce((a, h) => a + h.magnitude, 0) / hints.length));
  const affected = hints.map((h) => h.submetric);
  return { direction, magnitude, affected };
}

/** Create a PolicyVersion for a deep item + map it through the scorer. */
async function processDeepItem(
  ctx: SourceContext,
  item: DeepItem,
  /**
   * sha256 of the item's own content -- see deepItemHash. Deliberately NOT
   * the index page's hash, which SourceSnapshot.contentHash holds and which
   * this field used to be given.
   */
  itemContentHash: string,
): Promise<{
  policyId: string;
  versionId: string;
  reviewItemId: string | null;
  scoreChangeLogId: string | null;
  mappingRules: string[];
  hintedSubmetrics: string[];
}> {
  const itemSlug = slugify(item.title) || slugify(item.url);
  const match = await matchExistingPolicy(
    { ...ctx, sourceUrl: item.url },
    {
      title: item.title,
      summary: item.summary,
      extractionMethod: 'deterministic',
      guidanceType: item.guidanceType,
    },
    {
      canonicalSlug: itemSlug,
      defaultTitle: item.title,
      defaultSummary: item.summary,
    },
  );

  let policyId = match.policyId;
  if (!policyId && match.createPolicy) {
    const created = await policyRepo.upsertPolicyShell({
      countryIso: ctx.countryIso,
      domain: ctx.domain,
      title: match.createPolicy.title,
      slug: match.createPolicy.slug,
      summary: match.createPolicy.summary,
      status: 'active',
      officialSourceUrl: item.url,
      sourceName: ctx.sourceName,
      verificationConfidence: match.matchConfidence === 'high' ? 'high' : 'medium',
      verificationMethod: 'official_source',
      lastVerifiedAt: new Date(),
      effectiveDate: item.effectiveDate ? new Date(item.effectiveDate) : null,
    });
    policyId = created.id;
  }

  const text = item.extractedText ?? `${item.title}. ${item.summary ?? ''}`;
  const mapping = mapTextToSubmetrics(text, ctx.domain as Domain);

  // V7: tiered evidence. Strong = V6 numeric+direction. Medium = action+keyword.
  // Weak = nothing directional. Only strong auto-applies at full magnitude;
  // medium auto-applies at reduced magnitude; weak goes to review.
  const v7 = applyV7Tiered({
    domain: ctx.domain as Domain,
    actions: extractActions(text),
    numericValues: (item.numericValues ?? {}) as Record<string, number>,
    bodyText: text,
  });
  const evidenceTier: EvidenceTier = v7.tier;
  const tierHints: V6Hint[] = v7.hints;

  // Merge V5 keyword hints with V7 tiered hints for affected-submetric list.
  const mergedAffected = new Set<string>([
    ...mapping.hints.map((h) => h.submetric),
    ...tierHints.map((h) => h.submetric),
  ]);
  let direction: ImpactDirection = 'neutral';
  let magnitude = 0;
  if (tierHints.length > 0) {
    const pos = tierHints.filter((h) => h.direction === 'positive').length;
    const neg = tierHints.filter((h) => h.direction === 'negative').length;
    direction = pos > neg ? 'positive' : neg > pos ? 'negative' : 'mixed';
    // Magnitude: strong tier → 3+ ; medium tier → 1.
    magnitude = evidenceTier === 'strong'
      ? Math.min(5, 3 + Math.max(pos, neg) - 1)
      : 1;
  } else {
    const impact = hintsToImpact(mapping.hints);
    direction = impact.direction;
    magnitude = impact.magnitude;
  }

  const policyType = item.policyType ?? detectPolicyType(text);
  const topConfidence: 'high' | 'medium' | 'low' =
    evidenceTier === 'strong'
      ? 'high'
      : evidenceTier === 'medium'
      ? 'medium'
      : mapping.hints.reduce(
          (acc, h) => (h.confidence === 'high' ? 'high' : acc === 'high' ? acc : h.confidence),
          'low' as 'high' | 'medium' | 'low',
        );

  const allFiredRules = [...mapping.mappingRules, ...v7.firedRules];
  // What this item is allowed to assert. The index path has always refused to
  // let a proposal change a policy's status; this path used to hardcode
  // active/current for everything, including the proposals eu-trade types as
  // such. See helpers/deep-disposition.ts.
  //
  // Given the *resolved* policyType, not item.policyType: the row stores the
  // resolved value, so otherwise a version could read policyType "proposal"
  // while also being the policy's current active state.
  //
  // An earlier note here said this fired on 0 of 32 live policy cards. That
  // measurement was taken on rendered card text, and running the pipelines
  // against their real sources superseded it: 1 of 12 USCIS items resolved to
  // proposal because the chapter explains that users may save *draft benefit
  // requests*. The classifier was the thing at fault and was tightened (see
  // lib/policy/proposal-detect.ts); measured again afterwards, USCIS is 12/12
  // guidance and uk-climate keeps one genuine UK ETS consultation.
  const disposition = deepItemDisposition({ guidanceType: item.guidanceType, policyType });
  const version = await policyRepo.createPolicyVersion({
    policyId: policyId!,
    changeType: disposition.changeType,
    summary: item.summary ?? item.title,
    extractedText: item.extractedText ?? item.title,
    sourceUrl: item.url,
    sourceHash: itemContentHash,
    confidence: topConfidence === 'high' ? 'high' : topConfidence === 'medium' ? 'medium' : 'low',
    approvedState: disposition.approvedState,
    setAsCurrent: disposition.setAsCurrent,
    extractionMethod: 'deterministic',
    extractionConfidence: topConfidence === 'high' ? 'high' : topConfidence === 'medium' ? 'medium' : 'low',
    guidanceType: item.guidanceType ?? 'operational_guidance',
    policyType,
    numericValues: Object.keys(mapping.numericValues).length
      ? { ...mapping.numericValues, ...(item.numericValues ?? {}) }
      : item.numericValues ?? null,
    mappingRules: allFiredRules,
    evidenceType: evidenceTier,
    impactDirection: direction,
    impactMagnitude: magnitude,
    affectedSubmetrics: [...mergedAffected],
    scoreExplanation:
      evidenceTier === 'strong'
        ? `V7 strong (numeric + directional): ${v7.firedRules.join(', ')}.`
        : evidenceTier === 'medium'
        ? `V7 medium (action + keyword): ${v7.firedRules.join(', ')}.`
        : mapping.hints.length > 0
        ? `V7 weak (keyword only): ${mapping.mappingRules.join(', ')}.`
        : 'No submetric mapping matched; no score change.',
  });

  let reviewItemId: string | null = null;
  let scoreChangeLogId: string | null = null;

  // V7 auto-apply policy:
  //   strong → full impact (magnitude 3+)
  //   medium → reduced impact (magnitude 1)
  //   weak   → review only
  // V8: duplicate-evidence suppression — if an identical mapping-fingerprint
  // already applied on this (policy, submetric-set, direction) in the last
  // 24 hours, we record the new version but skip the score recompute AND
  // the evidence-counter bump. This prevents a stable GOV.UK page
  // re-hashing daily from inflating evidence_count forever.
  const autoApply =
    disposition.mayMoveScores &&
    (evidenceTier === 'strong' || evidenceTier === 'medium') &&
    magnitude > 0 &&
    mergedAffected.size > 0 &&
    direction !== 'neutral' &&
    direction !== 'mixed';

  const duplicateEvidence = autoApply
    ? await prisma.policyVersion.findFirst({
        where: {
          policyId: policyId!,
          impactDirection: direction,
          affectedSubmetrics: { equals: [...mergedAffected].sort() },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          id: { not: version.id },
        },
        select: { id: true },
      })
    : null;

  if (autoApply && !duplicateEvidence) {
    const log = await recomputeScoresAfterPolicyChange({
      policyId: policyId!,
      triggeringVersionId: version.id,
      explanation:
        evidenceTier === 'strong'
          ? `V7 strong evidence: ${v7.firedRules.join(', ')}.`
          : `V7 medium evidence (reduced magnitude): ${v7.firedRules.join(', ')}.`,
    });
    scoreChangeLogId = log?.id ?? null;
    // V7 evidence counter: bump evidenceCount + lastEvidenceAt on each
    // affected submetric that was nudged by this version.
    try {
      const country = await prisma.country.findFirst({
        where: {
          OR: [{ iso2: ctx.countryIso.toUpperCase() }, { iso3: ctx.countryIso.toUpperCase() }],
        },
        select: { id: true },
      });
      if (country) {
        await prisma.scoreSubmetric.updateMany({
          where: {
            countryId: country.id,
            domain: ctx.domain as Domain,
            key: { in: [...mergedAffected] },
          },
          data: {
            evidenceCount: { increment: 1 },
            lastEvidenceAt: new Date(),
          },
        });
      }
    } catch {
      /* non-fatal — evidence counter is diagnostic */
    }
  } else if (autoApply && duplicateEvidence) {
    // Evidence was duplicate: log an audit entry so we can see this
    // deduplication in admin, but don't bump counters or scores.
    await auditRepo.append({
      entityType: 'policy_version',
      entityId: version.id,
      actionType: 'duplicate_evidence_suppressed',
      actorType: 'pipeline',
      actorId: 'runner',
      confidence: 'medium',
      summary: `Skipped auto-apply: identical fingerprint already applied within 24h (version ${duplicateEvidence.id}).`,
    });
  } else if (mapping.hints.length > 0 || tierHints.length > 0) {
    const review = await reviewRepo.createReviewItem({
      targetType: 'policy_version',
      targetId: version.id,
      priority: 2,
      confidence: topConfidence === 'medium' ? 'medium' : 'low',
      recommendedAction: 'approve',
      summary: `${
        disposition.changeType === 'proposal_only'
          ? 'Proposal, not in force — needs review before applying to'
          : 'Deep item needs review before applying to'
      } ${mapping.hints.length} submetric(s): ${mapping.hints.map((h) => h.submetric).join(', ')}.`,
    });
    reviewItemId = review.id;
  }

  return {
    policyId: policyId!,
    versionId: version.id,
    reviewItemId,
    scoreChangeLogId,
    mappingRules: allFiredRules,
    hintedSubmetrics: [...mergedAffected],
  };
}

/**
 * Cap on the snapshot copy kept for auditing. Parsing and change detection
 * always run on the full text; this only bounds what is written to the row.
 */
const SNAPSHOT_TEXT_LIMIT = 200_000;

export async function runPipeline(
  def: PipelineDefinition,
  ctx: SourceContext,
): Promise<RunOutcome> {
  const run = await pipelineRepo.startRun({
    pipelineKey: def.key,
    monitoredSourceId: ctx.id,
    metadata: { sourceUrl: ctx.sourceUrl, sourceName: ctx.sourceName },
  });

  const outcome: RunOutcome = {
    runId: run.id,
    sourceId: ctx.id,
    pipelineKey: def.key,
    status: 'partial',
    hash: null,
    previousHash: ctx.lastHash,
    changeDetected: false,
    classification: null,
    summary: '',
  };

  try {
    const fetched = (await def.fetch(ctx)) as FailureAwareFetch;

    if (!fetched.ok) {
      await sourceRepo.recordSnapshot({
        monitoredSourceId: ctx.id,
        contentHash: '',
        fetchStatus: fetched.status,
        metadata: {
          error: fetched.error ?? 'fetch_failed',
          failureType: fetched.failureType ?? 'fetch_failed',
          retries: fetched.retries ?? 0,
        },
      });
      await sourceRepo.updateSourceAfterCheck({ id: ctx.id, hash: '', success: false });

      outcome.status = 'failed';
      outcome.summary = `Fetch failed (status ${fetched.status})`;
      outcome.error = fetched.error;

      await pipelineRepo.endRun({
        id: run.id,
        status: 'failed',
        summary: outcome.summary,
        errorMessage: fetched.error ?? null,
        itemsProcessed: 1,
        failureType: fetched.failureType,
        retryCount: fetched.retries,
      });
      await updateSourceStability(ctx.id, { lastOk: false });
      return outcome;
    }

    const normalized = def.normalize(fetched.text);
    const hash = sha256(normalized);
    outcome.hash = hash;
    const currentSignal = def.parse(normalized);

    await sourceRepo.recordSnapshot({
      monitoredSourceId: ctx.id,
      contentHash: hash,
      snapshotText: normalized.slice(0, SNAPSHOT_TEXT_LIMIT),
      fetchStatus: fetched.status,
      byteSize: fetched.text.length,
      metadata: {
        ...((currentSignal.metadata ?? {}) as Record<string, unknown>),
        // Hashing and parsing above both use the full `normalized` text;
        // only this stored copy is capped. Say so on the row, because a
        // silent prefix is indistinguishable from a complete capture, and
        // a listing that sits past the cap then looks like a listing that
        // does not exist. GOV.UK puts its results at ~403k of 449k, and
        // reading the stored prefix alone led to exactly that wrong call.
        snapshotTruncated: normalized.length > SNAPSHOT_TEXT_LIMIT,
        normalizedChars: normalized.length,
      },
    });
    await sourceRepo.updateSourceAfterCheck({ id: ctx.id, hash, success: true });

    const hashChanged = ctx.lastHash !== null && ctx.lastHash !== hash;
    const firstSight = ctx.lastHash === null;

    const cls = def.classifyChange({
      previousHash: ctx.lastHash,
      currentHash: hash,
      previousSignal: null,
      currentSignal,
      previousText: null,
      currentText: normalized,
    });

    outcome.classification = cls.classification;
    outcome.summary = cls.summary;
    outcome.changeDetected = hashChanged && cls.classification !== 'no_material_change';

    if (firstSight) {
      await auditRepo.append({
        entityType: 'monitored_source',
        entityId: ctx.id,
        actionType: 'initial_fetch',
        newValue: { hash, linkCount: currentSignal.linkCount },
        sourceUrl: ctx.sourceUrl,
        actorType: 'pipeline',
        actorId: def.key,
        confidence: cls.confidence,
        summary: `Initial snapshot captured (${fetched.text.length.toLocaleString()} bytes, hash ${hash.slice(0, 10)}…).`,
      });

      // On first sight, we still want to extract deep items (so the very
      // first USCIS run produces per-update policies instead of waiting for
      // the next hash diff).
      const firstDeep = await runDeepItems(def, ctx, currentSignal, normalized);
      const deepResults = firstDeep.results;

      // V7: if the deep hook *was* defined but produced nothing (or all
      // items failed), flag as partial_success rather than success.
      const degraded = deepRunDegraded(firstDeep, deepResults.length);
      await updateSourceStability(ctx.id, { lastOk: true });
      await pipelineRepo.endRun({
        id: run.id,
        status: degraded ? 'partial_success' : 'success',
        changeDetected: deepResults.length > 0,
        changeType: 'no_material_change',
        summary: `Initial fetch recorded. ${deepResults.length} deep items extracted${degraded ? ' (partial_success — deep items failed)' : ''}.`,
        itemsProcessed: 1 + deepResults.length,
        itemsChanged: deepResults.length,
        itemsFlagged: deepResults.filter((r) => r.reviewItemId).length,
        deepItemsFetched: deepResults.length,
        deepItemsApplied: deepResults.filter((r) => r.scoreChangeLogId).length,
        retryCount: fetched.retries ?? 0,
        metadata: {
          deepItemIds: deepResults.map((r) => r.versionId),
          deepItemsPlanned: firstDeep.itemsPlanned,
          deepItemsFailed: firstDeep.itemsFailed,
          deepItemsUnchanged: firstDeep.itemsUnchanged,
        },
      });
      outcome.status = 'success';
      if (deepResults[0]) {
        outcome.policyId = deepResults[0].policyId;
        outcome.versionId = deepResults[0].versionId;
        outcome.reviewItemId = deepResults[0].reviewItemId;
        outcome.scoreChangeLogId = deepResults[0].scoreChangeLogId;
      }
      return outcome;
    }

    if (!hashChanged) {
      await updateSourceStability(ctx.id, { lastOk: true });
      await pipelineRepo.endRun({
        id: run.id,
        status: 'success',
        changeDetected: false,
        changeType: 'no_material_change',
        summary: 'No change since last check.',
        itemsProcessed: 1,
      });
      outcome.status = 'success';
      return outcome;
    }

    // ── index-level version write (unchanged from V4) ─────────────────────
    const match = await def.matchPolicy(ctx, currentSignal);
    let policyId = match.policyId;
    if (!policyId && match.createPolicy) {
      const created = await policyRepo.upsertPolicyShell({
        countryIso: ctx.countryIso,
        domain: ctx.domain,
        title: match.createPolicy.title,
        slug: match.createPolicy.slug,
        summary: match.createPolicy.summary,
        status: cls.suggestedStatus ?? 'pending',
        officialSourceUrl: ctx.sourceUrl,
        sourceName: ctx.sourceName,
        verificationConfidence: cls.confidence,
        verificationMethod: 'ai_inferred',
        lastVerifiedAt: new Date(),
      });
      policyId = created.id;
    }

    let versionId: string | null = null;
    let reviewItemId: string | null = null;
    let scoreChangeLogId: string | null = null;

    // The page's bytes moved, but did the signal we extract from it? For a
    // pipeline with a deepItems hook the per-item content hash settles this
    // item by item; a pipeline without one has only this, and nothing was
    // comparing it. uk-immigration extracted nothing and still reported
    // "operational guidance updated" every day. See index-signal.ts.
    const candidateText = currentSignal.extractedText ?? normalized.slice(0, 20_000);
    const previous = policyId
      ? await prisma.policyVersion.findFirst({
          where: { policyId },
          orderBy: { versionNumber: 'desc' },
          select: { extractedText: true },
        })
      : null;
    const signalHeld = indexSignalUnchanged(previous?.extractedText, candidateText);

    if (policyId && signalHeld) await touchPolicyVerified([policyId]);

    if (policyId && !signalHeld) {
      const applyStatusChange =
        cls.classification !== 'proposal_only' &&
        cls.classification !== 'uncertain' &&
        cls.classification !== 'no_material_change';

      const version = await policyRepo.createPolicyVersion({
        policyId,
        changeType: cls.classification,
        summary: cls.summary,
        extractedText: candidateText,
        sourceUrl: ctx.sourceUrl,
        sourceHash: hash,
        confidence: cls.confidence,
        approvedState: applyStatusChange ? (cls.suggestedStatus ?? null) : null,
        setAsCurrent: applyStatusChange,
        extractionMethod: currentSignal.extractionMethod ?? 'deterministic',
        extractionConfidence: cls.confidence,
        guidanceType: currentSignal.guidanceType,
        policyType: detectPolicyType(currentSignal.extractedText ?? ''),
      });
      versionId = version.id;

      if (!applyStatusChange || cls.confidence !== 'high') {
        const review = await reviewRepo.createReviewItem({
          targetType: 'policy_version',
          targetId: version.id,
          priority: cls.confidence === 'low' ? 1 : 2,
          confidence: cls.confidence,
          recommendedAction:
            cls.classification === 'proposal_only'
              ? 'mark_proposal_only'
              : cls.classification === 'uncertain'
              ? 'request_changes'
              : 'approve',
          summary: cls.summary,
        });
        reviewItemId = review.id;
      }

      await auditRepo.append({
        entityType: 'policy',
        entityId: policyId,
        actionType: `pipeline_${cls.classification}`,
        newValue: {
          classification: cls.classification,
          suggestedStatus: cls.suggestedStatus,
          confidence: cls.confidence,
          versionId,
        },
        sourceUrl: ctx.sourceUrl,
        actorType: 'pipeline',
        actorId: def.key,
        confidence: cls.confidence,
        summary: cls.summary,
      });

      if (applyStatusChange && cls.confidence === 'high') {
        const scoreLog = await recomputeScoresAfterPolicyChange({
          policyId,
          triggeringVersionId: version.id,
          explanation: cls.summary,
        });
        scoreChangeLogId = scoreLog?.id ?? null;
      }
    }

    // ── V5/V7: deep items (per-update PolicyVersions) ────────────────────
    const deepOutcome = await runDeepItems(def, ctx, currentSignal, normalized);
    const deepResults = deepOutcome.results;

    outcome.policyId = policyId ?? null;
    outcome.versionId = versionId;
    outcome.reviewItemId = reviewItemId;
    outcome.scoreChangeLogId = scoreChangeLogId;
    outcome.status = 'success';

    const degraded = deepRunDegraded(deepOutcome, deepResults.length);

    // The page's bytes moved. Whether anything about the policy did is a
    // separate question, and passing the classifier's verdict through without
    // asking it is what had USCIS claiming an `amendment` with the same 12
    // items every day for five days, and uk-immigration reporting
    // "operational guidance updated" having extracted nothing at all.
    //
    // Narrow on purpose: an item that merely failed to extract leaves the run
    // reporting a change, because a failure is not evidence of sameness. Does
    // not detect an item being removed from the index; nothing here does yet.
    const verdict = materialChange({
      indexSignalMoved: !signalHeld,
      deepItemsWritten: deepResults.length,
      deepItemsPlanned: deepOutcome.itemsPlanned,
      deepItemsUnchanged: deepOutcome.itemsUnchanged,
    });
    if (!verdict.changed) outcome.changeDetected = false;

    const runSummary = buildRunSummary({
      verdict,
      classifierSummary: cls.summary,
      deepItemsWritten: deepResults.length,
      deepItemsUnchanged: deepOutcome.itemsUnchanged,
      degraded,
    });
    await updateSourceStability(ctx.id, { lastOk: !degraded });

    // V10: event-driven auto-resolver. Any new review items this run produced
    // get a chance to clear immediately (e.g. repeated_signal collapsing,
    // soft multi-source, force-resolve on aged items). Wrapped in try/catch
    // so resolver failure can't poison the pipeline run itself.
    if (deepResults.some((r) => r.reviewItemId) || outcome.reviewItemId) {
      try {
        await autoResolveReviewQueue();
      } catch (err) {
        await auditRepo.append({
          entityType: 'pipeline_run',
          entityId: run.id,
          actionType: 'resolver_post_run_failed',
          actorType: 'runner',
          actorId: 'auto-resolver-hook',
          confidence: 'medium',
          summary: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await pipelineRepo.endRun({
      id: run.id,
      status: degraded ? 'partial_success' : 'success',
      changeDetected: outcome.changeDetected,
      changeType: verdict.changed ? cls.classification : 'no_material_change',
      summary: runSummary,
      itemsProcessed: 1 + deepResults.length,
      itemsChanged: (outcome.changeDetected ? 1 : 0) + deepResults.length,
      itemsFlagged: (reviewItemId ? 1 : 0) + deepResults.filter((r) => r.reviewItemId).length,
      deepItemsFetched: deepResults.length,
      deepItemsApplied: deepResults.filter((r) => r.scoreChangeLogId).length,
      retryCount: fetched.retries ?? 0,
      metadata: {
        hash,
        previousHash: ctx.lastHash,
        policyId,
        versionId,
        reviewItemId,
        deepItemIds: deepResults.map((r) => r.versionId),
        deepItemsPlanned: deepOutcome.itemsPlanned,
        deepItemsFailed: deepOutcome.itemsFailed,
        deepItemsUnchanged: deepOutcome.itemsUnchanged,
        indexSignalHeld: signalHeld,
        materialChange: verdict.changed,
      },
    });

    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome.status = 'failed';
    outcome.error = message;
    outcome.summary = `Pipeline crashed: ${message}`;

    await pipelineRepo.endRun({
      id: run.id,
      status: 'failed',
      summary: outcome.summary,
      errorMessage: message,
      itemsProcessed: 1,
    });
    return outcome;
  }
}

/**
 * Checked and unchanged is not the same as not checked.
 *
 * Both the index signal and a deep item can come back byte-identical, and in
 * both cases we did fetch the official source and compare it. Without this the
 * freshness label drifts to "potentially stale" for a policy verified that
 * morning -- which, in a product about checking claims against sources, is the
 * same class of error as the churn it replaced, just pointing the other way.
 */
async function touchPolicyVerified(policyIds: readonly string[]): Promise<void> {
  if (policyIds.length === 0) return;
  try {
    await prisma.policy.updateMany({
      where: { id: { in: [...policyIds] } },
      data: { lastVerifiedAt: new Date() },
    });
  } catch {
    /* Non-fatal, as with the V7 evidence counter: this is bookkeeping about a
       check that already happened, and losing it must not turn a run that
       fetched and compared its source into a failed run. */
  }
}

interface DeepRunOutcome {
  results: Array<{
    policyId: string;
    versionId: string;
    reviewItemId: string | null;
    scoreChangeLogId: string | null;
    mappingRules: string[];
    hintedSubmetrics: string[];
    evidenceType?: EvidenceTier;
  }>;
  itemsPlanned: number;
  itemsFailed: number;
  hookFailed: boolean;
  /** Items whose own content hash already existed: checked, not changed. */
  itemsUnchanged: number;
}

/**
 * No index-page hash parameter. It used to take one and dedupe on it, which
 * is the bug this file spent 2026-10-10 removing: the index hash is what puts
 * a run on the change path, so it never matched across days and every listed
 * item was rewritten daily. Dedup is keyed on each item's own content now, so
 * the index hash has no business in here at all.
 */
async function runDeepItems(
  def: PipelineDefinition,
  ctx: SourceContext,
  signal: ParsedSignal,
  normalized: string,
): Promise<DeepRunOutcome> {
  if (!def.deepItems) return { results: [], itemsPlanned: 0, itemsFailed: 0, hookFailed: false, itemsUnchanged: 0 };
  let items: DeepItem[] = [];
  try {
    items = await def.deepItems(ctx, signal, normalized);
  } catch (err) {
    await auditRepo.append({
      entityType: 'monitored_source',
      entityId: ctx.id,
      actionType: 'deep_extract_failed',
      actorType: 'pipeline',
      actorId: def.key,
      confidence: 'low',
      summary: err instanceof Error ? err.message : String(err),
    });
    return { results: [], itemsPlanned: 0, itemsFailed: 0, hookFailed: true, itemsUnchanged: 0 };
  }
  const results: DeepRunOutcome['results'] = [];
  let itemsFailed = 0;
  let pdfProcessed = 0;
  let itemsUnchanged = 0;
  const unchangedPolicyIds = new Set<string>();
  for (const item of items) {
    // Keyed on the item's OWN content, not the index page's hash. The index
    // hash is what put this run on the change path, so it differs on every
    // run that gets here and matched nothing across days: every item was
    // rewritten as a new version daily whether or not its text had moved.
    const itemHash = deepItemHash(item);
    const existingVersion = await prisma.policyVersion.findFirst({
      where: { sourceUrl: item.url, sourceHash: itemHash },
      select: { id: true, policyId: true },
    });
    if (existingVersion) {
      // Checked and unchanged is not the same as not checked: without this
      // the freshness label would drift to "potentially stale" for a policy
      // we verified against its official source today.
      itemsUnchanged++;
      unchangedPolicyIds.add(existingVersion.policyId);
      continue;
    }
    // V11: PDF counter — if the item URL is a .pdf, bump the source's PDF counter.
    if (/\.pdf(\?|$)/i.test(item.url)) pdfProcessed++;
    try {
      results.push(await processDeepItem(ctx, item, itemHash));
    } catch (err) {
      itemsFailed++;
      await auditRepo.append({
        entityType: 'monitored_source',
        entityId: ctx.id,
        actionType: 'deep_item_failed',
        actorType: 'pipeline',
        actorId: def.key,
        confidence: 'low',
        summary: `Deep item failed: ${item.title} — ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  if (pdfProcessed > 0) {
    await prisma.monitoredSource.update({
      where: { id: ctx.id },
      data: { pdfsProcessed: { increment: pdfProcessed } },
    });
  }
  await touchPolicyVerified([...unchangedPolicyIds]);
  return { results, itemsPlanned: items.length, itemsFailed, hookFailed: false, itemsUnchanged };
}
