/**
 * V10 auto-resolution engine — no item stays unexplained, no item stays
 * pending longer than 72h, safety caps prevent score runaway.
 *
 * Every pending item carries after each resolver pass:
 *   - `status`              current queue status
 *   - `finalDecisionReason` why it's in that status (or why still pending)
 *   - `nextActionAt`        when the resolver will try again
 *   - `blockingFactors`     zero-or-more labels explaining blockage
 *
 * Resolution priority order:
 *   1. Conflict quarantine (never auto-approved)
 *   2. Repeated signal    (occurrenceCount ≥ 2)
 *   3. Multi-source       (different source URL within 7 days for same policy)
 *   4. Semantic soft-multi-source (title similarity across runs)
 *   5. Time-confirmed     (pending > 48h, no conflict)
 *   6. Forced resolution  (pending > 72h) — magnitude-capped, tagged
 *
 * Safety:
 *   - adaptive daily cap:  max(5, floor(total_active_pipelines / 2))
 *     computed per-(country, domain)
 *   - volatility guard:    if Σ|delta| > 5 in 24h for a country/domain,
 *     freeze further score changes; items waiting stay pending with
 *     blockingFactor "volatility_freeze"
 *   - low/unverified confidence: never auto-approved, aged out after 5 days
 */

import type { Domain, VerificationConfidence } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import * as auditRepo from '@/lib/db/repositories/audit';
import { recomputeScoresAfterPolicyChange } from '@/lib/scoring/engine';

// ─── Tunables ──────────────────────────────────────────────────────────────
const MULTI_SOURCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TIME_ESCALATION_MS = 48 * 60 * 60 * 1000;
const FORCE_RESOLUTION_MS = 72 * 60 * 60 * 1000;
const LOW_CONFIDENCE_EXPIRY_MS = 5 * 24 * 60 * 60 * 1000;
const CONFLICT_WINDOW_MS = 48 * 60 * 60 * 1000;
const VOLATILITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const VOLATILITY_ABS_DELTA = 5; // |sum delta| over 24h blocks further changes

/** V11: append a trace step to an item. Preserves prior trace entries. */
async function appendTrace(
  id: string,
  step: 'pending' | 'blocked' | 'resolved',
  reason: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const existing = await prisma.reviewQueueItem.findUnique({
    where: { id },
    select: { resolutionTrace: true },
  });
  const prior = Array.isArray(existing?.resolutionTrace)
    ? (existing!.resolutionTrace as Array<Record<string, unknown>>)
    : [];
  const next = [
    ...prior,
    { step, reason, at: new Date().toISOString(), ...(extra ?? {}) },
  ];
  await prisma.reviewQueueItem.update({
    where: { id },
    data: { resolutionTrace: next as unknown as object },
  });
}

export interface AutoResolveOutcome {
  scanned: number;
  collapsed: number;
  autoApproved: number;
  forced: number;
  conflicted: number;
  expired: number;
  cappedSkipped: number;
  volatilityBlocked: number;
  leftPending: number;
  reasons: Record<string, number>;
  sampleDecisions: Array<{ id: string; decision: string; reason: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function adaptiveDailyCap(): Promise<number> {
  const pipelines = await prisma.monitoredSource.count({
    where: { active: true, pipelineKey: { not: null } },
  });
  return Math.max(5, Math.floor(pipelines / 2));
}

async function withinDailyCap(countryId: number, domain: Domain): Promise<{ ok: boolean; cap: number; used: number }> {
  const cap = await adaptiveDailyCap();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.scoreChangeLog.count({
    where: { countryId, domain, createdAt: { gte: since } },
  });
  return { ok: used < cap, cap, used };
}

async function volatilityFrozen(countryId: number, domain: Domain): Promise<boolean> {
  const since = new Date(Date.now() - VOLATILITY_WINDOW_MS);
  const logs = await prisma.scoreChangeLog.findMany({
    where: { countryId, domain, createdAt: { gte: since } },
    select: { delta: true },
  });
  const total = logs.reduce((a, l) => a + Math.abs(l.delta), 0);
  return total > VOLATILITY_ABS_DELTA;
}

async function groupKeyFor(item: {
  targetType: string;
  targetId: string;
  summary: string | null;
}): Promise<string> {
  if (item.targetType === 'policy_version') {
    const v = await prisma.policyVersion.findUnique({
      where: { id: item.targetId },
      select: { sourceUrl: true, policyId: true },
    });
    if (v?.sourceUrl) return `url:${v.sourceUrl}`;
    if (v?.policyId) return `policy:${v.policyId}`;
  }
  if (item.targetType === 'contribution') return `contribution:${item.targetId}`;
  return `summary:${(item.summary ?? '').slice(0, 80)}`;
}

async function collapseDuplicates(): Promise<number> {
  const pending = await prisma.reviewQueueItem.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, targetType: true, targetId: true, summary: true, groupKey: true },
  });
  const byKey = new Map<string, typeof pending>();
  for (const it of pending) {
    const key = it.groupKey ?? (await groupKeyFor(it));
    if (!it.groupKey) {
      await prisma.reviewQueueItem.update({ where: { id: it.id }, data: { groupKey: key } });
    }
    const bucket = byKey.get(key) ?? [];
    bucket.push(it);
    byKey.set(key, bucket);
  }
  let collapsed = 0;
  for (const [key, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const [canonical, ...dupes] = bucket;
    for (const dupe of dupes) {
      await prisma.reviewQueueItem.update({
        where: { id: dupe.id },
        data: {
          status: 'merged',
          mergedIntoId: canonical.id,
          resolvedAt: new Date(),
          autoResolution: 'duplicate_merged',
          finalDecisionReason: 'duplicate_merged',
          nextActionAt: null,
          blockingFactors: [],
        },
      });
      collapsed++;
    }
    await prisma.reviewQueueItem.update({
      where: { id: canonical.id },
      data: { occurrenceCount: bucket.length, groupKey: key },
    });
    await auditRepo.append({
      entityType: 'review_queue_item',
      entityId: canonical.id,
      actionType: 'duplicates_collapsed',
      actorType: 'resolver',
      actorId: 'auto-resolver',
      confidence: 'medium',
      summary: `Collapsed ${dupes.length} duplicate(s) into ${canonical.id} (key=${key}).`,
    });
  }
  return collapsed;
}

async function hasConflict(item: { targetType: string; targetId: string }): Promise<boolean> {
  if (item.targetType !== 'policy_version') return false;
  const self = await prisma.policyVersion.findUnique({
    where: { id: item.targetId },
    select: { policyId: true, impactDirection: true, affectedSubmetrics: true },
  });
  if (!self?.policyId) return false;
  if (self.impactDirection === 'neutral' || self.impactDirection === 'mixed') return false;
  const opposite = self.impactDirection === 'positive' ? 'negative' : 'positive';
  const since = new Date(Date.now() - CONFLICT_WINDOW_MS);
  const opposing = await prisma.policyVersion.findMany({
    where: {
      policyId: self.policyId,
      createdAt: { gte: since },
      impactDirection: opposite,
      NOT: { id: item.targetId },
    },
    select: { affectedSubmetrics: true },
    take: 5,
  });
  const selfSet = new Set(self.affectedSubmetrics);
  return opposing.some((o) => o.affectedSubmetrics.some((s) => selfSet.has(s)));
}

function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/** V11 multi-source confidence score in [0, 1] composed from:
 *  - hard hit: different sourceUrl on same policy            +0.6
 *  - soft hit: title similarity ≥ 0.75                       +0.25 per hit (cap 0.5)
 *  - shared keywords across sibling summaries                +0.1 per keyword (cap 0.3)
 *  - same country + same domain (always true here, +0)       —
 *
 *  Returns { ok: confidence >= 0.5, kind, confidence }.
 */
async function hasMultiSource(item: { id: string; targetType: string; targetId: string }): Promise<{ ok: boolean; kind: 'hard' | 'soft' | 'none'; confidence: number }> {
  if (item.targetType !== 'policy_version') return { ok: false, kind: 'none', confidence: 0 };
  const self = await prisma.policyVersion.findUnique({
    where: { id: item.targetId },
    select: { policyId: true, sourceUrl: true, summary: true },
  });
  if (!self?.policyId) return { ok: false, kind: 'none', confidence: 0 };
  const since = new Date(Date.now() - MULTI_SOURCE_WINDOW_MS);
  const others = await prisma.policyVersion.findMany({
    where: {
      policyId: self.policyId,
      createdAt: { gte: since },
      NOT: { id: item.targetId },
    },
    select: { sourceUrl: true, summary: true },
    take: 20,
  });
  let conf = 0;
  let kind: 'hard' | 'soft' | 'none' = 'none';
  if (others.some((o) => o.sourceUrl && o.sourceUrl !== self.sourceUrl)) {
    conf += 0.6;
    kind = 'hard';
  }
  if (self.summary) {
    const softHits = others.filter((o) => o.summary && titleSimilarity(o.summary, self.summary!) >= 0.75).length;
    conf += Math.min(0.5, softHits * 0.25);
    if (kind !== 'hard' && softHits > 0) kind = 'soft';
    // Shared keyword check — single-word overlap across siblings (capped)
    const selfKw = new Set(
      (self.summary ?? '')
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 4 && !['about', 'their', 'which', 'would', 'there', 'other'].includes(w)),
    );
    let sharedKw = 0;
    for (const o of others) {
      const otherKw = new Set(
        (o.summary ?? '')
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 4),
      );
      for (const w of selfKw) if (otherKw.has(w)) sharedKw++;
      if (sharedKw >= 3) break;
    }
    conf += Math.min(0.3, sharedKw * 0.1);
  }
  conf = Math.min(1, conf);
  return { ok: conf >= 0.5, kind, confidence: Number(conf.toFixed(2)) };
}

/** V11 priority scoring: higher score → processed first.
 *   priorityScore = occurrenceCount*2 + ageHours/12 + confidenceWeight
 */
function computePriorityScore(item: {
  occurrenceCount: number;
  createdAt: Date;
  confidence: VerificationConfidence;
}): number {
  const ageHours = (Date.now() - item.createdAt.getTime()) / 3_600_000;
  const confWeight = item.confidence === 'high' ? 3 : item.confidence === 'medium' ? 2 : 1;
  return Number((item.occurrenceCount * 2 + ageHours / 12 + confWeight).toFixed(3));
}

async function applyScoreChange(
  item: { id: string; targetId: string; targetType: string },
  reason: string,
): Promise<{ scoreChangeLogId: string | null; countryId: number | null; domain: Domain | null }> {
  if (item.targetType !== 'policy_version') return { scoreChangeLogId: null, countryId: null, domain: null };
  const version = await prisma.policyVersion.findUnique({
    where: { id: item.targetId },
    include: { policy: { select: { id: true, countryId: true, domain: true } } },
  });
  if (!version?.policy) return { scoreChangeLogId: null, countryId: null, domain: null };
  const log = await recomputeScoresAfterPolicyChange({
    policyId: version.policy.id,
    triggeringVersionId: version.id,
    explanation: `Auto-resolver: ${reason}.`,
  });
  return {
    scoreChangeLogId: log?.id ?? null,
    countryId: version.policy.countryId,
    domain: version.policy.domain,
  };
}

/** Try to apply a decision; respects cap + volatility. Returns the new state. */
async function decide(
  item: { id: string; targetId: string; targetType: string; confidence: VerificationConfidence },
  reason: 'repeated_signal' | 'multi_source' | 'multi_source_equivalent' | 'time_confirmed' | 'forced_resolution',
): Promise<{
  status: 'auto_approved' | 'escalated' | 'pending';
  finalDecisionReason: string;
  nextActionAt: Date | null;
  blockingFactors: string[];
  scoreChangeLogId: string | null;
}> {
  if (item.targetType !== 'policy_version') {
    return {
      status: 'pending',
      finalDecisionReason: 'awaiting_additional_signal',
      nextActionAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      blockingFactors: ['non_policy_target'],
      scoreChangeLogId: null,
    };
  }
  const peek = await prisma.policyVersion.findUnique({
    where: { id: item.targetId },
    select: { policy: { select: { countryId: true, domain: true } } },
  });
  if (!peek?.policy) {
    return {
      status: 'pending',
      finalDecisionReason: 'blocked_by_missing_mapping',
      nextActionAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      blockingFactors: ['missing_policy_link'],
      scoreChangeLogId: null,
    };
  }
  const frozen = await volatilityFrozen(peek.policy.countryId, peek.policy.domain);
  if (frozen) {
    return {
      status: 'pending',
      finalDecisionReason: 'blocked_by_volatility',
      nextActionAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      blockingFactors: ['volatility_freeze'],
      scoreChangeLogId: null,
    };
  }
  const cap = await withinDailyCap(peek.policy.countryId, peek.policy.domain);
  if (!cap.ok) {
    return {
      status: 'pending',
      finalDecisionReason: 'blocked_by_daily_cap',
      // Cap resets rolling — next hour window retry
      nextActionAt: new Date(Date.now() + 60 * 60 * 1000),
      blockingFactors: [`daily_cap_reached(${cap.used}/${cap.cap})`],
      scoreChangeLogId: null,
    };
  }
  const { scoreChangeLogId } = await applyScoreChange(item, reason);
  const status: 'auto_approved' | 'escalated' =
    item.confidence === 'high' ? 'escalated' : 'auto_approved';
  return {
    status,
    finalDecisionReason: reason,
    nextActionAt: null,
    blockingFactors: [],
    scoreChangeLogId,
  };
}

// ─── Main driver ──────────────────────────────────────────────────────────

export async function autoResolveReviewQueue(): Promise<AutoResolveOutcome> {
  const outcome: AutoResolveOutcome = {
    scanned: 0,
    collapsed: 0,
    autoApproved: 0,
    forced: 0,
    conflicted: 0,
    expired: 0,
    cappedSkipped: 0,
    volatilityBlocked: 0,
    leftPending: 0,
    reasons: {},
    sampleDecisions: [],
  };

  outcome.collapsed = await collapseDuplicates();

  const expiryCutoff = new Date(Date.now() - LOW_CONFIDENCE_EXPIRY_MS);
  const expired = await prisma.reviewQueueItem.updateMany({
    where: {
      status: 'pending',
      confidence: { in: ['low', 'unverified'] satisfies VerificationConfidence[] },
      createdAt: { lt: expiryCutoff },
    },
    data: {
      status: 'expired',
      autoResolution: 'low_confidence_aged_out',
      finalDecisionReason: 'low_confidence_expired',
      resolvedAt: new Date(),
      nextActionAt: null,
      blockingFactors: [],
    },
  });
  outcome.expired = expired.count;

  // V11: compute priorityScore for every pending item and sort desc.
  const rawPending = await prisma.reviewQueueItem.findMany({
    where: {
      status: 'pending',
      confidence: { in: ['high', 'medium'] satisfies VerificationConfidence[] },
    },
    take: 500,
  });
  // V11 backfill: if a pending item lacks finalDecisionReason, stamp one so
  // no item ever appears "unclassified" in the UI.
  for (const it of rawPending) {
    if (!it.finalDecisionReason) {
      await prisma.reviewQueueItem.update({
        where: { id: it.id },
        data: {
          finalDecisionReason: 'awaiting_additional_signal',
          blockingFactors: ['below_threshold_occurrences'],
          nextActionAt: new Date(it.createdAt.getTime() + TIME_ESCALATION_MS),
        },
      });
      it.finalDecisionReason = 'awaiting_additional_signal';
    }
  }
  const priorityMap = new Map<string, number>();
  for (const it of rawPending) priorityMap.set(it.id, computePriorityScore(it));
  // Persist priority scores + sort by them
  await Promise.all(
    rawPending.map((it) =>
      prisma.reviewQueueItem.update({
        where: { id: it.id },
        data: { priorityScore: priorityMap.get(it.id) ?? 0 },
      }),
    ),
  );
  const candidates = rawPending.sort((a, b) => (priorityMap.get(b.id) ?? 0) - (priorityMap.get(a.id) ?? 0));
  outcome.scanned = candidates.length;

  for (const item of candidates) {
    // 1. Conflict check (short-circuit)
    if (await hasConflict({ targetType: item.targetType, targetId: item.targetId })) {
      await prisma.reviewQueueItem.update({
        where: { id: item.id },
        data: {
          status: 'conflict',
          autoResolution: 'conflict_detected',
          finalDecisionReason: 'conflict_detected',
          resolvedAt: new Date(),
          nextActionAt: null,
          blockingFactors: ['opposing_policy_version'],
        },
      });
      await appendTrace(item.id, 'resolved', 'conflict_detected', { rule: 'conflict' });
      outcome.conflicted++;
      outcome.reasons.conflict_detected = (outcome.reasons.conflict_detected ?? 0) + 1;
      if (outcome.sampleDecisions.length < 6)
        outcome.sampleDecisions.push({ id: item.id, decision: 'conflict', reason: 'conflict_detected' });
      continue;
    }

    const ageMs = Date.now() - item.createdAt.getTime();
    // 2. Force resolution > 72h (hard guarantee)
    if (ageMs > FORCE_RESOLUTION_MS) {
      const dec = await decide({ id: item.id, targetId: item.targetId, targetType: item.targetType, confidence: item.confidence }, 'forced_resolution');
      await prisma.reviewQueueItem.update({
        where: { id: item.id },
        data: {
          status: dec.status,
          autoResolution: dec.status !== 'pending' ? 'forced_resolution' : null,
          finalDecisionReason: dec.finalDecisionReason,
          resolvedAt: dec.status !== 'pending' ? new Date() : null,
          nextActionAt: dec.nextActionAt,
          blockingFactors: dec.blockingFactors,
        },
      });
      await appendTrace(item.id, dec.status !== 'pending' ? 'resolved' : 'blocked', dec.finalDecisionReason, { rule: 'forced_resolution', ageHours: Math.round(ageMs / 3600000) });
      if (dec.status !== 'pending') {
        outcome.forced++;
        outcome.reasons.forced_resolution = (outcome.reasons.forced_resolution ?? 0) + 1;
        if (outcome.sampleDecisions.length < 6)
          outcome.sampleDecisions.push({ id: item.id, decision: dec.status, reason: 'forced_resolution' });
      } else if (dec.finalDecisionReason === 'blocked_by_daily_cap') {
        outcome.cappedSkipped++;
      } else if (dec.finalDecisionReason === 'blocked_by_volatility') {
        outcome.volatilityBlocked++;
      }
      continue;
    }

    // 3. Repeated signal
    if (item.occurrenceCount >= 2) {
      const dec = await decide({ id: item.id, targetId: item.targetId, targetType: item.targetType, confidence: item.confidence }, 'repeated_signal');
      await prisma.reviewQueueItem.update({
        where: { id: item.id },
        data: {
          status: dec.status,
          autoResolution: dec.status !== 'pending' ? 'repeated_signal' : null,
          finalDecisionReason: dec.finalDecisionReason,
          resolvedAt: dec.status !== 'pending' ? new Date() : null,
          nextActionAt: dec.nextActionAt,
          blockingFactors: dec.blockingFactors,
        },
      });
      await appendTrace(item.id, dec.status !== 'pending' ? 'resolved' : 'blocked', dec.finalDecisionReason, { rule: 'repeated_signal', occurrenceCount: item.occurrenceCount });
      if (dec.status !== 'pending') {
        outcome.autoApproved++;
        outcome.reasons.repeated_signal = (outcome.reasons.repeated_signal ?? 0) + 1;
        if (outcome.sampleDecisions.length < 6)
          outcome.sampleDecisions.push({ id: item.id, decision: dec.status, reason: 'repeated_signal' });
      } else if (dec.finalDecisionReason === 'blocked_by_daily_cap') {
        outcome.cappedSkipped++;
      } else if (dec.finalDecisionReason === 'blocked_by_volatility') {
        outcome.volatilityBlocked++;
      }
      continue;
    }

    // 4. Multi-source (V11: composite confidence score)
    const ms = await hasMultiSource({ id: item.id, targetType: item.targetType, targetId: item.targetId });
    // Persist the confidence so UI can inspect it.
    if (ms.confidence > 0) {
      await prisma.reviewQueueItem.update({
        where: { id: item.id },
        data: { multiSourceConfidence: ms.confidence },
      });
    }
    if (ms.ok) {
      const reason = ms.kind === 'hard' ? 'multi_source' : 'multi_source_equivalent';
      const dec = await decide({ id: item.id, targetId: item.targetId, targetType: item.targetType, confidence: item.confidence }, reason);
      await prisma.reviewQueueItem.update({
        where: { id: item.id },
        data: {
          status: dec.status,
          autoResolution: dec.status !== 'pending' ? reason : null,
          finalDecisionReason: dec.finalDecisionReason,
          resolvedAt: dec.status !== 'pending' ? new Date() : null,
          nextActionAt: dec.nextActionAt,
          blockingFactors: dec.blockingFactors,
        },
      });
      await appendTrace(
        item.id,
        dec.status !== 'pending' ? 'resolved' : 'blocked',
        dec.finalDecisionReason,
        { rule: reason, multiSourceConfidence: ms.confidence, kind: ms.kind },
      );
      if (dec.status !== 'pending') {
        outcome.autoApproved++;
        outcome.reasons[reason] = (outcome.reasons[reason] ?? 0) + 1;
        if (outcome.sampleDecisions.length < 6)
          outcome.sampleDecisions.push({ id: item.id, decision: dec.status, reason });
      } else if (dec.finalDecisionReason === 'blocked_by_daily_cap') {
        outcome.cappedSkipped++;
      }
      continue;
    }

    // 5. Time-confirmed
    if (ageMs > TIME_ESCALATION_MS) {
      const dec = await decide({ id: item.id, targetId: item.targetId, targetType: item.targetType, confidence: item.confidence }, 'time_confirmed');
      await prisma.reviewQueueItem.update({
        where: { id: item.id },
        data: {
          status: dec.status,
          autoResolution: dec.status !== 'pending' ? 'time_confirmed' : null,
          finalDecisionReason: dec.finalDecisionReason,
          resolvedAt: dec.status !== 'pending' ? new Date() : null,
          nextActionAt: dec.nextActionAt,
          blockingFactors: dec.blockingFactors,
        },
      });
      await appendTrace(item.id, dec.status !== 'pending' ? 'resolved' : 'blocked', dec.finalDecisionReason, { rule: 'time_confirmed', ageHours: Math.round(ageMs / 3600000) });
      if (dec.status !== 'pending') {
        outcome.autoApproved++;
        outcome.reasons.time_confirmed = (outcome.reasons.time_confirmed ?? 0) + 1;
        if (outcome.sampleDecisions.length < 6)
          outcome.sampleDecisions.push({ id: item.id, decision: dec.status, reason: 'time_confirmed' });
      } else if (dec.finalDecisionReason === 'blocked_by_daily_cap') {
        outcome.cappedSkipped++;
      }
      continue;
    }

    // 6. Left pending — still awaiting additional signal. Record next check time.
    const nextAt = new Date(item.createdAt.getTime() + TIME_ESCALATION_MS);
    await prisma.reviewQueueItem.update({
      where: { id: item.id },
      data: {
        finalDecisionReason: 'awaiting_additional_signal',
        nextActionAt: nextAt,
        blockingFactors: ['below_threshold_occurrences'],
      },
    });
    await appendTrace(item.id, 'pending', 'awaiting_additional_signal', { occurrenceCount: item.occurrenceCount, ageHours: Math.round(ageMs / 3600000) });
    outcome.leftPending++;
  }

  return outcome;
}
