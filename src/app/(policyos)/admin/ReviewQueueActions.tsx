'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ReviewItemRow {
  id: string;
  verificationRunId: string | null;
  targetType: string;
  status: string;
  priority: number;
  confidence: string;
  summary: string | null;
  recommendedAction: string | null;
  createdAt: string; // ISO
  contributionTitle: string | null;
  countryName: string | null;
  countryIso: string | null;
  domain: string | null;
  sourceUrl: string | null;
  // V9 auto-resolution
  autoResolution: string | null;
  resolvedAt: string | null;
  occurrenceCount: number;
  // V10
  finalDecisionReason: string | null;
  nextActionAt: string | null;
  blockingFactors: string[];
  // V11 explainability
  resolutionTrace: Array<{ step: string; reason: string; at: string; rule?: string }> | null;
  priorityScore: number;
  multiSourceConfidence: number | null;
}

function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function priorityLabel(p: number): { label: string; style: string } {
  // 1 highest → 5 lowest
  if (p <= 1) return { label: 'critical', style: 'bg-red-500/15 text-red-400' };
  if (p === 2) return { label: 'high', style: 'bg-orange-500/15 text-orange-400' };
  if (p === 3) return { label: 'medium', style: 'bg-yellow-500/15 text-yellow-400' };
  return { label: 'low', style: 'bg-gray-500/15 text-gray-400' };
}

function PriorityBadge({ priority }: { priority: number }) {
  const { label, style } = priorityLabel(priority);
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${style}`}>{label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-500/15 text-yellow-400',
    approved: 'bg-green-500/15 text-green-400',
    rejected: 'bg-red-500/15 text-red-400',
    merged: 'bg-blue-500/15 text-blue-400',
    proposal_only: 'bg-purple-500/15 text-purple-400',
    // V9
    auto_approved: 'bg-green-500/15 text-green-400 border border-green-500/30',
    escalated: 'bg-teal-500/15 text-teal-400 border border-teal-500/30',
    expired: 'bg-gray-500/15 text-gray-400',
    conflict: 'bg-red-500/15 text-red-400 border border-red-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-500/15 text-gray-400'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function AutoResolutionBadge({ reason, occurrenceCount }: { reason: string | null; occurrenceCount: number }) {
  if (!reason) {
    return occurrenceCount > 1 ? (
      <span className="text-[10px] text-muted" title="Duplicate review items collapsed">
        ×{occurrenceCount}
      </span>
    ) : null;
  }
  const styles: Record<string, string> = {
    repeated_signal: 'bg-green-500/10 text-green-300',
    multi_source: 'bg-blue-500/10 text-blue-300',
    time_confirmed: 'bg-teal-500/10 text-teal-300',
    duplicate_merged: 'bg-gray-500/10 text-gray-300',
    low_confidence_aged_out: 'bg-gray-500/10 text-gray-300',
    conflict_detected: 'bg-red-500/10 text-red-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[reason] ?? 'bg-surface-2 text-muted'}`}>
      {reason.replace(/_/g, ' ')}
      {occurrenceCount > 1 && <span className="opacity-70">×{occurrenceCount}</span>}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    high: 'bg-green-500/15 text-green-400',
    medium: 'bg-yellow-500/15 text-yellow-400',
    low: 'bg-orange-500/15 text-orange-400',
    unverified: 'bg-red-500/15 text-red-400',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${
        styles[confidence] ?? 'bg-gray-500/15 text-gray-400'
      }`}
    >
      {confidence}
    </span>
  );
}

type ActionKind = 'approve' | 'reject' | 'merge' | 'mark_proposal_only';

interface ToastState {
  id: string;
  kind: 'success' | 'error';
  message: string;
}

export default function ReviewQueueActions({ items }: { items: ReviewItemRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<Record<string, ActionKind | null>>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  async function handleAction(itemId: string, action: ActionKind) {
    const notes =
      typeof window !== 'undefined'
        ? window.prompt(`Reviewer notes for "${action}" (optional):`, '')
        : null;

    setPending((p) => ({ ...p, [itemId]: action }));
    try {
      const res = await fetch('/api/freshness/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action, reviewerNotes: notes || undefined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = (data?.error as string | undefined) || `Request failed (${res.status})`;
        setToast({ id: itemId, kind: 'error', message });
      } else {
        setToast({ id: itemId, kind: 'success', message: `Item ${action.replace(/_/g, ' ')}d.` });
        router.refresh();
      }
    } catch (err) {
      setToast({
        id: itemId,
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    } finally {
      setPending((p) => ({ ...p, [itemId]: null }));
      setTimeout(() => {
        setToast((current) => (current && current.id === itemId ? null : current));
      }, 4000);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-surface border border-border p-6 text-sm text-muted">
        No review items in the queue yet. Contributions and low-confidence pipeline detections will show up here.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface border border-border overflow-hidden">
      {toast && (
        <div
          className={`px-4 py-2 text-sm ${
            toast.kind === 'success'
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {toast.message}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Priority</th>
              <th className="text-left px-4 py-3 font-medium">Target</th>
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium">Country</th>
              <th className="text-left px-4 py-3 font-medium">Domain</th>
              <th className="text-left px-4 py-3 font-medium">Confidence</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-left px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const currentAction = pending[item.id];
              const isBusy = currentAction != null;
              const isPending = item.status === 'pending';
              const title = item.contributionTitle ?? item.summary ?? item.recommendedAction ?? '—';
              return (
                <tr
                  key={item.id}
                  className="border-b border-border/50 hover:bg-surface-2/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {item.targetType.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3 font-medium max-w-xs truncate">{title}</td>
                  <td className="px-4 py-3 text-xs">{item.countryName ?? item.countryIso ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted">{item.domain ?? '—'}</td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge confidence={item.confidence} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={item.status} />
                      <AutoResolutionBadge
                        reason={item.autoResolution}
                        occurrenceCount={item.occurrenceCount}
                      />
                      {item.priorityScore > 0 && (
                        <span className="text-[10px] text-muted" title="V11 priority score">
                          p={item.priorityScore.toFixed(1)}
                          {item.multiSourceConfidence != null && (
                            <> · ms={item.multiSourceConfidence.toFixed(2)}</>
                          )}
                        </span>
                      )}
                      {item.resolutionTrace && item.resolutionTrace.length > 0 && (
                        <details className="text-[10px]">
                          <summary className="cursor-pointer text-accent/80 hover:text-accent">
                            trace ({item.resolutionTrace.length})
                          </summary>
                          <ol className="mt-1 list-decimal list-inside space-y-0.5 text-muted">
                            {item.resolutionTrace.slice(-5).map((t, i) => (
                              <li key={i}>
                                <span className="text-foreground">{t.step}</span>: {t.reason}
                                {t.rule && <span className="text-muted/60"> · {t.rule}</span>}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                    {item.resolvedAt ? (
                      <div className="flex flex-col">
                        <span>created {relativeTime(item.createdAt)}</span>
                        <span className="text-[10px] text-green-400/80">
                          resolved {relativeTime(item.resolvedAt)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <span>created {relativeTime(item.createdAt)}</span>
                        {item.nextActionAt && (
                          <span className="text-[10px] text-yellow-400/80">
                            retry {relativeTime(item.nextActionAt)}
                          </span>
                        )}
                        {item.finalDecisionReason && (
                          <span className="text-[10px] text-muted/70" title={item.blockingFactors.join(', ')}>
                            {item.finalDecisionReason.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.verificationRunId && (
                      <a
                        href={`/api/verify/records/${encodeURIComponent(item.verificationRunId)}`}
                        className="mb-2 inline-flex min-h-10 items-center rounded border border-border px-3 py-2 text-xs font-medium text-accent hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        Download saved evidence
                      </a>
                    )}
                    {isPending ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleAction(item.id, 'approve')}
                          disabled={isBusy}
                          className="px-2 py-1 rounded text-xs font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {currentAction === 'approve' ? '...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAction(item.id, 'reject')}
                          disabled={isBusy}
                          className="px-2 py-1 rounded text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {currentAction === 'reject' ? '...' : 'Reject'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAction(item.id, 'merge')}
                          disabled={isBusy}
                          className="px-2 py-1 rounded text-xs font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {currentAction === 'merge' ? '...' : 'Merge'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAction(item.id, 'mark_proposal_only')}
                          disabled={isBusy}
                          className="px-2 py-1 rounded text-xs font-medium bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {currentAction === 'mark_proposal_only' ? '...' : 'Proposal only'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
