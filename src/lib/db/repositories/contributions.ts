/**
 * Contribution repository. Writes are accepted unconditionally (the review
 * queue is the gatekeeper for whether they ever affect a policy record).
 */

import type { ContributionStatus, Domain } from '@prisma/client';
import { prisma } from '../client';

export interface ContributionCreateInput {
  contributionType: string;
  countryIso?: string | null;
  domain?: Domain | null;
  title: string;
  body: string;
  sourceUrl?: string | null;
  submitterName?: string | null;
  submitterEmail?: string | null;
}

export async function createContribution(input: ContributionCreateInput) {
  let countryId: number | null = null;
  if (input.countryIso) {
    const c = await prisma.country.findFirst({
      where: {
        OR: [
          { iso2: input.countryIso.toUpperCase() },
          { iso3: input.countryIso.toUpperCase() },
        ],
      },
      select: { id: true },
    });
    countryId = c?.id ?? null;
  }

  return prisma.contribution.create({
    data: {
      contributionType: input.contributionType,
      countryId,
      domain: input.domain ?? null,
      title: input.title,
      body: input.body,
      sourceUrl: input.sourceUrl ?? null,
      submitterName: input.submitterName ?? null,
      submitterEmail: input.submitterEmail ?? null,
      status: 'submitted',
    },
  });
}

export async function listContributions(filter?: {
  status?: ContributionStatus;
  limit?: number;
}) {
  return prisma.contribution.findMany({
    where: filter?.status ? { status: filter.status } : {},
    orderBy: { createdAt: 'desc' },
    take: filter?.limit ?? 50,
    include: { country: true },
  });
}

export async function updateContributionStatus(
  id: string,
  status: ContributionStatus,
) {
  return prisma.contribution.update({
    where: { id },
    data: { status },
  });
}
