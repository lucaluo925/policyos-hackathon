/**
 * Score recomputation engine.
 *
 * When a policy version lands with a non-zero impact, we:
 *   1. Recompute that country's domain score for the affected domain(s),
 *      by weight-averaging the submetric scores (with penalty inversion).
 *   2. Write a ScoreChangeLog row pointing back to the triggering policy
 *      and version, with a human-readable explanation.
 *
 * The engine does NOT derive submetric scores from policy text — that
 * requires domain-specific extraction which is out of scope for V3. Instead
 * the seed script seeds submetric scores from our existing metrics dataset,
 * and per-policy impact is applied as a nudge: `+impactMagnitude * direction`
 * across the version's `affectedSubmetrics`.
 *
 * That makes the system honest: score changes only move when a policy
 * version explicitly says which submetrics it affects, rather than
 * hallucinated from summary text.
 */

import type { Domain } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import {
  SUBMETRICS_BY_DOMAIN,
  METHODOLOGY_VERSION,
  type SubmetricDef,
} from './weights';

function computeDomainScore(
  submetricsBy: Record<string, number>,
  defs: readonly SubmetricDef[],
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const def of defs) {
    const raw = submetricsBy[def.key] ?? 50; // neutral default
    // Penalty submetrics: higher raw = lower score. We invert.
    const contribution = def.penalty ? (100 - raw) : raw;
    weightedSum += contribution * def.weight;
    totalWeight += def.weight;
  }
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

export async function recomputeDomainScore(
  countryId: number,
  domain: Domain,
  opts?: {
    triggeringPolicyId?: string | null;
    triggeringVersionId?: string | null;
    explanation?: string | null;
  },
) {
  const defs = SUBMETRICS_BY_DOMAIN[domain];
  const existingSubmetrics = await prisma.scoreSubmetric.findMany({
    where: { countryId, domain },
  });

  const byKey: Record<string, number> = {};
  for (const m of existingSubmetrics) byKey[m.key] = m.score;

  const newScore = Number(computeDomainScore(byKey, defs).toFixed(2));

  const previous = await prisma.domainScore.findUnique({
    where: { countryId_domain: { countryId, domain } },
  });
  const previousScore = previous?.score ?? 0;

  await prisma.domainScore.upsert({
    where: { countryId_domain: { countryId, domain } },
    create: {
      countryId,
      domain,
      score: newScore,
      methodologyVersion: METHODOLOGY_VERSION,
      explanation: opts?.explanation ?? null,
    },
    update: {
      score: newScore,
      methodologyVersion: METHODOLOGY_VERSION,
      explanation: opts?.explanation ?? undefined,
      lastComputedAt: new Date(),
    },
  });

  // Only log an actual change if the score moved. Otherwise the recompute
  // is a no-op we don't need to surface in the change feed.
  if (Math.abs(newScore - previousScore) < 0.005) return null;

  const log = await prisma.scoreChangeLog.create({
    data: {
      countryId,
      domain,
      previousScore,
      newScore,
      delta: newScore - previousScore,
      triggeringPolicyId: opts?.triggeringPolicyId ?? null,
      triggeringVersionId: opts?.triggeringVersionId ?? null,
      explanation: opts?.explanation ?? null,
    },
  });
  return log;
}

export async function recomputeScoresAfterPolicyChange(opts: {
  policyId: string;
  triggeringVersionId: string;
  explanation: string;
}) {
  const policy = await prisma.policy.findUnique({
    where: { id: opts.policyId },
    select: { countryId: true, domain: true },
  });
  if (!policy) return null;

  const version = await prisma.policyVersion.findUnique({
    where: { id: opts.triggeringVersionId },
  });
  if (!version) return null;

  // Apply the version's impact to affected submetrics before recompute.
  const sign =
    version.impactDirection === 'positive'
      ? 1
      : version.impactDirection === 'negative'
      ? -1
      : 0;

  if (sign !== 0 && version.impactMagnitude > 0) {
    for (const key of version.affectedSubmetrics) {
      // Nudge by 2 points per magnitude step (capped 0-100).
      const nudge = sign * version.impactMagnitude * 2;
      await prisma.scoreSubmetric.updateMany({
        where: { countryId: policy.countryId, domain: policy.domain, key },
        data: {
          // `updateMany` can't do min/max — we read then write in-memory
        },
      });
      // Refetch-and-clamp path: keeps simple code path, acceptable for small N.
      const row = await prisma.scoreSubmetric.findUnique({
        where: {
          countryId_domain_key: {
            countryId: policy.countryId,
            domain: policy.domain,
            key,
          },
        },
      });
      if (row) {
        const next = Math.max(0, Math.min(100, row.score + nudge));
        await prisma.scoreSubmetric.update({
          where: { id: row.id },
          data: {
            score: next,
            lastComputedAt: new Date(),
            // V4: flip this submetric from "seeded baseline" to "evidence-backed"
            // the moment a real PolicyVersion pushes it.
            evidenceBackedAt: new Date(),
            evidencePolicyVersionId: opts.triggeringVersionId,
          },
        });
      }
    }
  }

  return recomputeDomainScore(policy.countryId, policy.domain, {
    triggeringPolicyId: opts.policyId,
    triggeringVersionId: opts.triggeringVersionId,
    explanation: opts.explanation,
  });
}
