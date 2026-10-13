import type { PrismaClient } from '@prisma/client';
import type { PolicyEventRecord } from './types';

export function toPolicyEventData(r: PolicyEventRecord) {
  return {
    agency: r.agency,
    docType: r.docType,
    title: r.title,
    action: r.action,
    abstract: r.abstract,
    htmlUrl: r.htmlUrl,
    publicationDate: new Date(`${r.publicationDate}T00:00:00Z`),
    publicInspectionAt: r.publicInspectionAt ? new Date(r.publicInspectionAt) : null,
    eventInstant: new Date(r.eventInstant),
    eventTimeSource: r.eventTimeSource,
    eventType: r.eventType,
    chinaRelated: r.chinaRelated,
    semisRelated: r.semisRelated,
    direction: r.direction,
    relevant: r.relevant,
    taggerVersion: r.taggerVersion,
    raw: { firedRules: r.firedRules },
  };
}

/**
 * Upsert events; never touches reviewStatus / reviewNote so human review
 * survives re-ingestion. Returns the externalIds that were newly created.
 */
export async function upsertPolicyEvents(prisma: PrismaClient, records: PolicyEventRecord[]): Promise<string[]> {
  if (!records.length) return [];
  const existing = await prisma.policyEvent.findMany({
    where: { source: 'federal_register', externalId: { in: records.map((r) => r.externalId) } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId));
  const created: string[] = [];
  for (const r of records) {
    const data = toPolicyEventData(r);
    await prisma.policyEvent.upsert({
      where: { source_externalId: { source: r.source, externalId: r.externalId } },
      create: { source: r.source, externalId: r.externalId, ...data },
      update: data,
    });
    if (!seen.has(r.externalId)) created.push(r.externalId);
  }
  return created;
}
