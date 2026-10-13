/**
 * Review queue + review actions repository.
 *
 * When an action is taken, we:
 *   1. write a ReviewAction row (history)
 *   2. update the ReviewQueueItem status
 *   3. update the linked Contribution.status if present
 *
 * All three happen in a single transaction so the review UI never shows an
 * inconsistent snapshot.
 */

import type {
  Prisma,
  ReviewStatus,
  VerificationConfidence,
} from '@prisma/client';
import { prisma } from '../client';

export interface CreateReviewItemInput {
  targetType: string;
  targetId: string;
  contributionId?: string | null;
  verificationRunId?: string | null;
  priority?: number;
  confidence?: VerificationConfidence;
  recommendedAction?: string | null;
  summary?: string | null;
}

export async function createReviewItem(input: CreateReviewItemInput, client: Prisma.TransactionClient = prisma) {
  return client.reviewQueueItem.create({
    data: {
      targetType: input.targetType,
      targetId: input.targetId,
      contributionId: input.contributionId ?? null,
      verificationRunId: input.verificationRunId ?? null,
      priority: input.priority ?? 3,
      confidence: input.confidence ?? 'unverified',
      recommendedAction: input.recommendedAction ?? null,
      summary: input.summary ?? null,
    },
  });
}

export async function listReviewQueue(filter?: {
  status?: ReviewStatus;
  limit?: number;
}) {
  return prisma.reviewQueueItem.findMany({
    where: filter?.status ? { status: filter.status } : {},
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    take: filter?.limit ?? 100,
    include: {
      contribution: { include: { country: true } },
      actions: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });
}

export interface TakeActionInput {
  reviewItemId: string;
  action: 'approve' | 'reject' | 'merge' | 'mark_proposal_only' | 'request_changes';
  reviewer?: string;
  notes?: string;
}

export async function takeAction(input: TakeActionInput) {
  const statusMap: Record<TakeActionInput['action'], ReviewStatus> = {
    approve: 'approved',
    reject: 'rejected',
    merge: 'merged',
    mark_proposal_only: 'proposal_only',
    request_changes: 'pending',
  };

  return prisma.$transaction(async (tx) => {
    const item = await tx.reviewQueueItem.findUnique({
      where: { id: input.reviewItemId },
    });
    if (!item) {
      throw new Error(`[reviewRepo] Review item not found: ${input.reviewItemId}`);
    }

    const action = await tx.reviewAction.create({
      data: {
        reviewQueueId: item.id,
        action: input.action,
        reviewer: input.reviewer ?? 'admin',
        notes: input.notes ?? null,
      },
    });

    const newStatus = statusMap[input.action];
    const updatedItem = await tx.reviewQueueItem.update({
      where: { id: item.id },
      data: { status: newStatus },
    });

    // Cascade status to linked contribution
    if (item.contributionId) {
      const contribMap: Record<ReviewStatus, 'accepted' | 'rejected' | 'merged' | 'under_review' | 'submitted'> = {
        approved: 'accepted',
        rejected: 'rejected',
        merged: 'merged',
        pending: 'under_review',
        proposal_only: 'under_review',
        // V9 auto-resolution outcomes cascade to contribution status
        auto_approved: 'accepted',
        escalated: 'accepted',
        expired: 'rejected',
        conflict: 'under_review',
      };
      await tx.contribution.update({
        where: { id: item.contributionId },
        data: { status: contribMap[newStatus] },
      });
    }

    return { item: updatedItem, action };
  });
}

/** Admin API queue metadata; private submission content/actions stay in admin detail views. */
export async function listReviewQueueMetadata(filter?: { status?: ReviewStatus; limit?: number }) {
  return prisma.reviewQueueItem.findMany({
    where: filter?.status ? { status: filter.status } : {},
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    take: filter?.limit ?? 100,
    select: { id: true, targetType: true, targetId: true, priority: true,
      confidence: true, recommendedAction: true, status: true, createdAt: true, updatedAt: true },
  });
}
