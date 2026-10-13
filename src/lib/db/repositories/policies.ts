/**
 * Policy + PolicyVersion repository.
 *
 * Two rules this module enforces:
 *
 *  1. **Versioning, not overwriting.** Any update that changes policy
 *     *meaning* (status, summary, effective date, source hash) should go
 *     through `createPolicyVersion()`, which atomically writes a new
 *     PolicyVersion row and points `policies.current_version_id` at it.
 *     The prior version rows are retained.
 *
 *  2. **Confidence lineage.** PolicyVersion.confidence persists the
 *     verification signal from the pipeline that produced it. The Policy
 *     table's confidence reflects the current version's confidence.
 */

import type {
  ChangeClassification,
  Domain,
  ImpactDirection,
  LifecycleStatus,
  SourceType,
  VerificationConfidence,
  VerificationMethod,
} from '@prisma/client';
import { prisma } from '../client';

export interface PolicyUpsertInput {
  id?: string; // stable id (e.g. 'us-c1'); omit to let cuid() generate
  countryIso: string; // iso2 or iso3
  domain: Domain;
  title: string;
  slug: string;
  summary?: string | null;
  status?: LifecycleStatus;
  announcedDate?: Date | null;
  effectiveDate?: Date | null;
  expiryDate?: Date | null;
  lastVerifiedAt?: Date | null;
  nextReviewAt?: Date | null;
  verificationConfidence?: VerificationConfidence;
  verificationMethod?: VerificationMethod;
  sourceType?: SourceType;
  officialSourceUrl?: string | null;
  sourceName?: string | null;
  sourceAvailable?: boolean;
  tags?: string[];
}

/**
 * Upsert a policy by (country, slug). Does NOT create a version row — call
 * `createPolicyVersion()` right after for the initial version.
 */
export async function upsertPolicyShell(input: PolicyUpsertInput) {
  const country = await prisma.country.findFirst({
    where: {
      OR: [{ iso2: input.countryIso.toUpperCase() }, { iso3: input.countryIso.toUpperCase() }],
    },
    select: { id: true },
  });
  if (!country) {
    throw new Error(`[policyRepo] Unknown country iso: ${input.countryIso}`);
  }

  return prisma.policy.upsert({
    where: {
      countryId_slug: { countryId: country.id, slug: input.slug },
    },
    create: {
      id: input.id,
      countryId: country.id,
      domain: input.domain,
      title: input.title,
      slug: input.slug,
      summary: input.summary ?? null,
      status: input.status ?? 'unknown',
      announcedDate: input.announcedDate ?? null,
      effectiveDate: input.effectiveDate ?? null,
      expiryDate: input.expiryDate ?? null,
      lastVerifiedAt: input.lastVerifiedAt ?? null,
      nextReviewAt: input.nextReviewAt ?? null,
      verificationConfidence: input.verificationConfidence ?? 'unverified',
      verificationMethod: input.verificationMethod ?? 'seeded_data',
      sourceType: input.sourceType ?? 'government',
      officialSourceUrl: input.officialSourceUrl ?? null,
      sourceName: input.sourceName ?? null,
      sourceAvailable: input.sourceAvailable ?? true,
      tags: input.tags ?? [],
    },
    update: {
      title: input.title,
      summary: input.summary ?? undefined,
      status: input.status ?? undefined,
      announcedDate: input.announcedDate ?? undefined,
      effectiveDate: input.effectiveDate ?? undefined,
      expiryDate: input.expiryDate ?? undefined,
      lastVerifiedAt: input.lastVerifiedAt ?? undefined,
      nextReviewAt: input.nextReviewAt ?? undefined,
      verificationConfidence: input.verificationConfidence ?? undefined,
      verificationMethod: input.verificationMethod ?? undefined,
      sourceType: input.sourceType ?? undefined,
      officialSourceUrl: input.officialSourceUrl ?? undefined,
      sourceName: input.sourceName ?? undefined,
      sourceAvailable: input.sourceAvailable ?? undefined,
      tags: input.tags ?? undefined,
    },
  });
}

export interface PolicyVersionInput {
  policyId: string;
  changeType: ChangeClassification;
  summary?: string | null;
  extractedText?: string | null;
  sourceUrl?: string | null;
  sourceHash?: string | null;
  confidence?: VerificationConfidence;
  approvedState?: LifecycleStatus | null;
  impactDirection?: ImpactDirection;
  impactMagnitude?: number;
  affectedSubmetrics?: string[];
  scoreExplanation?: string | null;
  setAsCurrent?: boolean;
  // V4 extraction provenance
  extractionMethod?: string | null;
  extractionConfidence?: VerificationConfidence | null;
  guidanceType?: string | null;
  // V5 structured extraction
  policyType?: string | null;
  numericValues?: Record<string, unknown> | null;
  mappingRules?: string[];
  // V7 evidence tier
  evidenceType?: string | null;
}

/**
 * Append a PolicyVersion. If `setAsCurrent` (default true), also updates the
 * Policy's `currentVersionId` pointer. Happens in a transaction so readers
 * never see a policy without a version.
 */
export async function createPolicyVersion(input: PolicyVersionInput) {
  return prisma.$transaction(async (tx) => {
    const previousCount = await tx.policyVersion.count({
      where: { policyId: input.policyId },
    });
    const versionNumber = previousCount + 1;

    const version = await tx.policyVersion.create({
      data: {
        policyId: input.policyId,
        versionNumber,
        changeType: input.changeType,
        summary: input.summary ?? null,
        extractedText: input.extractedText ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sourceHash: input.sourceHash ?? null,
        confidence: input.confidence ?? 'unverified',
        approvedState: input.approvedState ?? null,
        impactDirection: input.impactDirection ?? 'neutral',
        impactMagnitude: input.impactMagnitude ?? 0,
        affectedSubmetrics: input.affectedSubmetrics ?? [],
        scoreExplanation: input.scoreExplanation ?? null,
        extractionMethod: input.extractionMethod ?? null,
        extractionConfidence: input.extractionConfidence ?? null,
        guidanceType: input.guidanceType ?? null,
        policyType: input.policyType ?? null,
        numericValues: (input.numericValues ?? undefined) as object | undefined,
        mappingRules: input.mappingRules ?? [],
        evidenceType: input.evidenceType ?? null,
      },
    });

    if (input.setAsCurrent !== false) {
      await tx.policy.update({
        where: { id: input.policyId },
        data: { currentVersionId: version.id },
      });
    }

    return version;
  });
}

export async function listPoliciesByCountry(iso: string) {
  const code = iso.toUpperCase();
  return prisma.policy.findMany({
    where: {
      country: { OR: [{ iso2: code }, { iso3: code }] },
    },
    include: { currentVersion: true },
    orderBy: [{ domain: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function listPoliciesByDomain(domain: Domain) {
  return prisma.policy.findMany({
    where: { domain },
    include: { country: true, currentVersion: true },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getPolicyWithVersions(id: string) {
  return prisma.policy.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { versionNumber: 'desc' } },
      currentVersion: true,
      country: true,
    },
  });
}

export async function countPoliciesWithStaleStatus(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  return prisma.policy.count({
    where: { lastVerifiedAt: { lt: cutoff } },
  });
}
