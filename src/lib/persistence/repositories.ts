/**
 * Typed repository helpers that sit on top of the unified {@link store}.
 *
 * Each entity has a stable key prefix:
 *   contribution:{id}     — user-submitted policy suggestions/corrections
 *   review:{id}           — review queue items (seed + writes)
 *   audit:{id}            — audit log entries (seed + writes)
 *   pipeline:{id}         — pipeline run records (seed + writes)
 *   version:{id}          — policy version history (seed + writes)
 *   score_change:{id}     — score recomputation records (seed + writes)
 *
 * The `getMerged*` helpers return a unified view that includes both the seed
 * data (hydrated lazily into the store) and any subsequent writes. Because
 * hydration writes seeds into the store itself, `list()` on the store already
 * returns the merged view — the getMerged helpers simply add sorting/shaping
 * that the UI expects.
 */

import type { CategoryKey } from '@/lib/data/metrics';
import type {
  AuditLogEntry,
  PipelineRun,
  ReviewQueueItem,
} from '@/lib/freshness/types';
import { store } from './singleton';

// ─── Contribution type ──────────────────────────────────────────────────────
// The Contribution shape lives here because it's specific to the persistence
// layer (the freshness module deals with verified policies, not raw user
// submissions). The existing /api/contributions route accepts free-form data;
// we formalise the fields it already uses.

export type ContributionStatus = 'pending' | 'approved' | 'rejected' | 'merged';

export interface Contribution {
  id: string;
  createdAt: string;
  status: ContributionStatus;
  type: string; // e.g. 'policy_update' | 'new_policy' | 'correction'
  country: string; // ISO code or country name
  category: CategoryKey;
  title: string;
  description: string;
  sourceUrl: string;
  email?: string;
  // Optional reviewer metadata populated when a contribution is triaged.
  reviewedBy?: string;
  reviewedAt?: string;
  reviewerNotes?: string;
}

// ─── ID helpers ─────────────────────────────────────────────────────────────

function newId(prefix: string): string {
  // crypto.randomUUID is available in Node 19+ and all Edge runtimes.
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}-${uuid}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Contributions ──────────────────────────────────────────────────────────

export async function createContribution(
  data: Omit<Contribution, 'id' | 'createdAt' | 'status'>,
): Promise<Contribution> {
  const contribution: Contribution = {
    ...data,
    id: newId('contrib'),
    createdAt: nowIso(),
    status: 'pending',
  };
  await store.set(`contribution:${contribution.id}`, contribution);
  return contribution;
}

export async function listContributions(filters?: {
  status?: string;
}): Promise<Contribution[]> {
  const all = await store.list<Contribution>('contribution');
  const filtered = filters?.status
    ? all.filter((c) => c.status === filters.status)
    : all;
  return filtered.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function updateContribution(
  id: string,
  updates: Partial<Contribution>,
): Promise<Contribution | null> {
  const key = `contribution:${id}`;
  const existing = await store.get<Contribution>(key);
  if (!existing) return null;
  const merged: Contribution = { ...existing, ...updates, id: existing.id };
  await store.set(key, merged);
  return merged;
}

// ─── Review queue ───────────────────────────────────────────────────────────

export async function createReviewItem(
  data: Omit<ReviewQueueItem, 'id' | 'createdAt'>,
): Promise<ReviewQueueItem> {
  const item: ReviewQueueItem = {
    ...data,
    id: newId('rq'),
    createdAt: nowIso(),
  };
  await store.set(`review:${item.id}`, item);
  return item;
}

export async function listReviewItems(filters?: {
  status?: string;
  countryIso?: string;
}): Promise<ReviewQueueItem[]> {
  const all = await store.list<ReviewQueueItem>('review');
  let out = all;
  if (filters?.status) out = out.filter((r) => r.status === filters.status);
  if (filters?.countryIso)
    out = out.filter((r) => r.countryIso === filters.countryIso);
  return out.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function updateReviewItem(
  id: string,
  action: 'approve' | 'reject' | 'merge',
  reviewerNotes?: string,
): Promise<ReviewQueueItem | null> {
  const key = `review:${id}`;
  const existing = await store.get<ReviewQueueItem>(key);
  if (!existing) return null;

  const statusMap: Record<typeof action, ReviewQueueItem['status']> = {
    approve: 'approved',
    reject: 'rejected',
    merge: 'merged',
  };

  const updated: ReviewQueueItem = {
    ...existing,
    status: statusMap[action],
    reviewerNotes: reviewerNotes ?? existing.reviewerNotes,
    reviewedAt: nowIso(),
  };
  await store.set(key, updated);
  return updated;
}

// ─── Audit log ──────────────────────────────────────────────────────────────

export async function appendAuditLog(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'>,
): Promise<AuditLogEntry> {
  const full: AuditLogEntry = {
    ...entry,
    id: newId('al'),
    timestamp: nowIso(),
  };
  await store.set(`audit:${full.id}`, full);
  return full;
}

export async function listAuditLog(filters?: {
  entityId?: string;
  entityType?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const all = await store.list<AuditLogEntry>('audit');
  let out = all;
  if (filters?.entityId) out = out.filter((e) => e.entityId === filters.entityId);
  if (filters?.entityType)
    out = out.filter((e) => e.entityType === filters.entityType);
  out = out.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  if (filters?.limit) out = out.slice(0, filters.limit);
  return out;
}

// ─── Pipeline runs ──────────────────────────────────────────────────────────

export async function recordPipelineRun(
  data: Omit<PipelineRun, 'id'>,
): Promise<PipelineRun> {
  const run: PipelineRun = {
    ...data,
    id: newId('pr'),
  };
  await store.set(`pipeline:${run.id}`, run);
  return run;
}

export async function listPipelineRuns(limit?: number): Promise<PipelineRun[]> {
  const all = await store.list<PipelineRun>('pipeline');
  const sorted = all.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  return limit ? sorted.slice(0, limit) : sorted;
}

// ─── Merged getters for the UI ──────────────────────────────────────────────
// These return the unified seed-plus-writes view. Because MemoryStore hydrates
// seed data on first access, these are equivalent to the list helpers above —
// but naming them explicitly keeps the UI/intent clear and leaves room to add
// de-duplication or shape adjustments later.

export async function getMergedReviewQueue(filters?: {
  status?: string;
  countryIso?: string;
  category?: string;
}): Promise<ReviewQueueItem[]> {
  const items = await listReviewItems({
    status: filters?.status,
    countryIso: filters?.countryIso,
  });
  if (filters?.category) {
    return items.filter((i) => i.category === filters.category);
  }
  return items;
}

export async function getMergedAuditLog(filters?: {
  entityId?: string;
  entityType?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  return listAuditLog(filters);
}

export async function getMergedPipelineRuns(limit?: number): Promise<PipelineRun[]> {
  return listPipelineRuns(limit);
}

// Re-export commonly-used types so callers can
// `import type { AuditLogEntry } from '@/lib/persistence'`.
export type { AuditLogEntry, PipelineRun, ReviewQueueItem };
