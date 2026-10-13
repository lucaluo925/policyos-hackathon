/**
 * Score repository — domain_scores + score_submetrics + score_change_logs.
 *
 * The write surface is narrow by design: scores are only written by the
 * score engine (`src/lib/scoring`). External callers read via `getDomainScore`
 * and `listSubmetrics`, and consume change-logs for the "why did this change"
 * UI.
 */

import type { Domain } from '@prisma/client';
import { prisma } from '../client';

export async function getDomainScore(countryId: number, domain: Domain) {
  return prisma.domainScore.findUnique({
    where: { countryId_domain: { countryId, domain } },
  });
}

export async function getAllDomainScoresForCountry(countryId: number) {
  return prisma.domainScore.findMany({ where: { countryId } });
}

export async function listSubmetrics(countryId: number, domain: Domain) {
  return prisma.scoreSubmetric.findMany({
    where: { countryId, domain },
    orderBy: { key: 'asc' },
  });
}

export async function upsertDomainScore(input: {
  countryId: number;
  domain: Domain;
  score: number;
  methodologyVersion?: string;
  explanation?: string | null;
}) {
  return prisma.domainScore.upsert({
    where: {
      countryId_domain: { countryId: input.countryId, domain: input.domain },
    },
    create: {
      countryId: input.countryId,
      domain: input.domain,
      score: input.score,
      methodologyVersion: input.methodologyVersion ?? '1.0',
      explanation: input.explanation ?? null,
    },
    update: {
      score: input.score,
      methodologyVersion: input.methodologyVersion ?? undefined,
      explanation: input.explanation ?? undefined,
      lastComputedAt: new Date(),
    },
  });
}

export async function upsertSubmetric(input: {
  countryId: number;
  domain: Domain;
  key: string;
  score: number;
  weight: number;
  explanation?: string | null;
}) {
  return prisma.scoreSubmetric.upsert({
    where: {
      countryId_domain_key: {
        countryId: input.countryId,
        domain: input.domain,
        key: input.key,
      },
    },
    create: input,
    update: {
      score: input.score,
      weight: input.weight,
      explanation: input.explanation ?? undefined,
      lastComputedAt: new Date(),
    },
  });
}

export async function logScoreChange(input: {
  countryId: number;
  domain: Domain;
  previousScore: number;
  newScore: number;
  triggeringPolicyId?: string | null;
  triggeringVersionId?: string | null;
  explanation?: string | null;
}) {
  return prisma.scoreChangeLog.create({
    data: {
      countryId: input.countryId,
      domain: input.domain,
      previousScore: input.previousScore,
      newScore: input.newScore,
      delta: input.newScore - input.previousScore,
      triggeringPolicyId: input.triggeringPolicyId ?? null,
      triggeringVersionId: input.triggeringVersionId ?? null,
      explanation: input.explanation ?? null,
    },
  });
}

export async function listScoreChanges(filter?: {
  countryIso?: string;
  domain?: Domain;
  limit?: number;
}) {
  return prisma.scoreChangeLog.findMany({
    where: {
      ...(filter?.domain ? { domain: filter.domain } : {}),
      ...(filter?.countryIso
        ? {
            country: {
              OR: [
                { iso2: filter.countryIso.toUpperCase() },
                { iso3: filter.countryIso.toUpperCase() },
              ],
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter?.limit ?? 30,
    include: { country: true, triggeringPolicy: true },
  });
}
