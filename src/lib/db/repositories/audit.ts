/**
 * Audit log repository.
 *
 * The audit log is append-only — there's no update/delete. All mutating
 * endpoints and all pipeline runs are expected to write at least one audit
 * entry so every state change is traceable.
 */

import type { Prisma, VerificationConfidence } from '@prisma/client';
import { prisma } from '../client';

export interface AuditInput {
  entityType: string;
  entityId: string;
  actionType: string;
  previousValue?: unknown;
  newValue?: unknown;
  sourceUrl?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  confidence?: VerificationConfidence;
  summary?: string | null;
}

export async function append(input: AuditInput, client: Prisma.TransactionClient = prisma) {
  return client.auditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      actionType: input.actionType,
      previousValue: (input.previousValue ?? undefined) as object | undefined,
      newValue: (input.newValue ?? undefined) as object | undefined,
      sourceUrl: input.sourceUrl ?? null,
      actorType: input.actorType ?? 'system',
      actorId: input.actorId ?? null,
      confidence: input.confidence ?? 'unverified',
      summary: input.summary ?? null,
    },
  });
}

export async function listAudit(filter?: {
  entityType?: string;
  entityId?: string;
  limit?: number;
}) {
  return prisma.auditLog.findMany({
    where: {
      ...(filter?.entityType ? { entityType: filter.entityType } : {}),
      ...(filter?.entityId ? { entityId: filter.entityId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter?.limit ?? 50,
  });
}

/** API timeline metadata only. Full context remains in the authenticated admin workflow.
 * Do not fetch actor identifiers or arbitrary JSON just to strip them afterwards.
 */
export async function listAuditMetadata(filter?: {
  entityType?: string;
  entityId?: string;
  limit?: number;
}) {
  return prisma.auditLog.findMany({
    where: {
      ...(filter?.entityType ? { entityType: filter.entityType } : {}),
      ...(filter?.entityId ? { entityId: filter.entityId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter?.limit ?? 50,
    select: { id: true, entityType: true, entityId: true, actionType: true,
      actorType: true, confidence: true, createdAt: true },
  });
}
