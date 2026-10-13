/**
 * Monitored sources + source snapshots repository.
 *
 * Every pipeline run writes a SourceSnapshot row (even on no-change) so we
 * have provable evidence the source was checked. The MonitoredSource's
 * `last_hash` / `last_checked_at` are only updated on successful fetches.
 */

import type { Domain, SourceType } from '@prisma/client';
import { prisma } from '../client';

export async function listActiveSources(filter?: { domain?: Domain; countryIso?: string }) {
  return prisma.monitoredSource.findMany({
    where: {
      active: true,
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
    include: { country: true },
    orderBy: [{ trustPriority: 'asc' }, { sourceName: 'asc' }],
  });
}

export async function getSourceByPipelineKey(pipelineKey: string) {
  return prisma.monitoredSource.findFirst({
    where: { pipelineKey, active: true },
    include: { country: true },
  });
}

export async function upsertSource(input: {
  countryIso: string;
  domain: Domain;
  sourceName: string;
  sourceUrl: string;
  sourceType: SourceType;
  trustPriority?: number;
  parserKey?: string;
  pipelineKey?: string;
  checkFrequencyHours?: number;
}) {
  const country = await prisma.country.findFirst({
    where: {
      OR: [
        { iso2: input.countryIso.toUpperCase() },
        { iso3: input.countryIso.toUpperCase() },
      ],
    },
    select: { id: true },
  });
  if (!country) {
    throw new Error(`[sourceRepo] Unknown country iso: ${input.countryIso}`);
  }
  // Prisma upsert requires a unique constraint; we don't have one on URL so
  // do find-or-create.
  const existing = await prisma.monitoredSource.findFirst({
    where: { countryId: country.id, sourceUrl: input.sourceUrl },
  });
  if (existing) {
    return prisma.monitoredSource.update({
      where: { id: existing.id },
      data: {
        sourceName: input.sourceName,
        sourceType: input.sourceType,
        trustPriority: input.trustPriority ?? existing.trustPriority,
        parserKey: input.parserKey ?? existing.parserKey,
        pipelineKey: input.pipelineKey ?? existing.pipelineKey,
        checkFrequencyHours:
          input.checkFrequencyHours ?? existing.checkFrequencyHours,
        domain: input.domain,
      },
    });
  }
  return prisma.monitoredSource.create({
    data: {
      countryId: country.id,
      domain: input.domain,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      trustPriority: input.trustPriority ?? 3,
      parserKey: input.parserKey ?? null,
      pipelineKey: input.pipelineKey ?? null,
      checkFrequencyHours: input.checkFrequencyHours ?? 24,
    },
  });
}

export async function recordSnapshot(input: {
  monitoredSourceId: string;
  contentHash: string;
  snapshotText?: string | null;
  fetchStatus: number;
  byteSize?: number | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.sourceSnapshot.create({
    data: {
      monitoredSourceId: input.monitoredSourceId,
      contentHash: input.contentHash,
      snapshotText: input.snapshotText ?? null,
      fetchStatus: input.fetchStatus,
      byteSize: input.byteSize ?? null,
      metadata: (input.metadata ?? {}) as object,
    },
  });
}

export async function updateSourceAfterCheck(input: {
  id: string;
  hash: string;
  success: boolean;
}) {
  const now = new Date();
  return prisma.monitoredSource.update({
    where: { id: input.id },
    data: {
      lastCheckedAt: now,
      lastSuccessAt: input.success ? now : undefined,
      lastHash: input.success ? input.hash : undefined,
    },
  });
}

export async function getOverdueSources() {
  // Sources past their check frequency window — used by the admin dashboard
  // and the daily cron to prioritise attention.
  const all = await prisma.monitoredSource.findMany({
    where: { active: true },
    include: { country: true },
  });
  const now = Date.now();
  return all.filter((s) => {
    const lastChecked = s.lastCheckedAt?.getTime() ?? 0;
    const windowMs = s.checkFrequencyHours * 60 * 60 * 1000;
    return now - lastChecked > windowMs;
  });
}

export async function listRecentSnapshots(sourceId: string, limit = 10) {
  return prisma.sourceSnapshot.findMany({
    where: { monitoredSourceId: sourceId },
    orderBy: { fetchedAt: 'desc' },
    take: limit,
  });
}
