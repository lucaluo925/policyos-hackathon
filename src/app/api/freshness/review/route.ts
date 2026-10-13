/**
 * Review queue API.
 *
 * GET — returns ReviewQueueItem rows (optionally filtered by status).
 * POST — takes an action (approve | reject | merge | mark_proposal_only |
 *        request_changes) on an item. The repository takes care of the
 *        transactional cascade to the linked Contribution and writes the
 *        ReviewAction row; this route layers an AuditLog entry on top.
 */

import { privateJson } from '@/lib/auth/private-response';
import type { ReviewStatus } from '@prisma/client';
import {
  isDatabaseConfigured,
  reviewRepo,
  auditRepo,
} from '@/lib/db';
import { isAdminRequest } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReviewActionKey =
  | 'approve'
  | 'reject'
  | 'merge'
  | 'mark_proposal_only'
  | 'request_changes';

const VALID_ACTIONS: ReviewActionKey[] = [
  'approve',
  'reject',
  'merge',
  'mark_proposal_only',
  'request_changes',
];

function dbUnavailableResponse() {
  return privateJson(
    {
      error:
        'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace to enable the review queue.',
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return privateJson({ error: 'unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return dbUnavailableResponse();

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const validStatuses: ReviewStatus[] = [
      'pending',
      'approved',
      'rejected',
      'merged',
      'proposal_only',
    ];
    const status =
      statusParam && validStatuses.includes(statusParam as ReviewStatus)
        ? (statusParam as ReviewStatus)
        : undefined;

    const items = await reviewRepo.listReviewQueueMetadata(
      status ? { status, limit: 200 } : { limit: 200 },
    );

    return privateJson({
      items,
      count: items.length,
      filters: { status: status ?? 'all' },
    });
  } catch {
    return privateJson(
      {
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return privateJson({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) return dbUnavailableResponse();

  try {
    const body = await request.json();
    const { itemId, action, reviewerNotes, reviewedBy } = body as {
      itemId?: string;
      action?: ReviewActionKey;
      reviewerNotes?: string;
      reviewedBy?: string;
    };

    if (!itemId || !action) {
      return privateJson(
        { error: 'Missing required fields: itemId and action' },
        { status: 400 },
      );
    }

    if (!VALID_ACTIONS.includes(action)) {
      return privateJson(
        {
          error: `Invalid action '${action}'. Must be one of: ${VALID_ACTIONS.join(', ')}`,
        },
        { status: 400 },
      );
    }

    const { item, action: actionRow } = await reviewRepo.takeAction({
      reviewItemId: itemId,
      action,
      reviewer: reviewedBy ?? 'admin',
      notes: reviewerNotes,
    });

    // Audit trail. We key on the review item id so the audit view for that
    // item shows every action in chronological order.
    const actionType =
      action === 'reject' || action === 'request_changes'
        ? 'review_rejected'
        : 'review_approved';

    await auditRepo.append({
      entityType: 'review_queue_item',
      entityId: item.id,
      actionType,
      actorType: 'admin',
      actorId: reviewedBy ?? 'admin',
      summary: reviewerNotes || `Reviewer action: ${action}`,
      newValue: {
        action,
        status: item.status,
        reviewActionId: actionRow.id,
      },
    });

    return privateJson({ success: true, item, action: actionRow });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('not found') ? 404 : 500;
    return privateJson(
      { error: status === 404 ? 'Review item not found' : 'Internal server error' },
      { status },
    );
  }
}
