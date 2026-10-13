'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface EventReviewRow {
  externalId: string;
  eventType: string;
  direction: string;
  eventInstant: string; // ISO
  title: string;
  htmlUrl: string;
  reviewStatus: string;
  reviewNote: string | null;
  firedRules: string[];
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-400',
  approved: 'bg-green-500/15 text-green-400',
  rejected: 'bg-gray-500/15 text-gray-400',
};

export default function EventReviewActions({ items }: { items: EventReviewRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function decide(externalId: string, status: 'approved' | 'rejected' | 'pending') {
    setBusy(externalId);
    setError(null);
    try {
      const res = await fetch('/api/events/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId, status, note: notes[externalId] || undefined }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(`${externalId}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) {
    return <p className="text-sm text-muted">No relevant events awaiting review.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {items.map((e) => (
        <div key={e.externalId} className="p-4 rounded-xl bg-surface border border-border">
          <div className="flex flex-wrap items-center gap-2 mb-1 text-xs">
            <span className={`px-2 py-0.5 rounded font-medium ${STATUS_STYLE[e.reviewStatus] ?? 'bg-surface-2 text-muted'}`}>
              {e.reviewStatus}
            </span>
            <span className="text-muted">{e.eventType}</span>
            <span className="text-muted">· {e.direction}</span>
            <span className="text-muted">· {new Date(e.eventInstant).toISOString().replace('T', ' ').slice(0, 16)} UTC</span>
            <span className="text-muted">· {e.externalId}</span>
          </div>
          <a href={e.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">
            {e.title}
          </a>
          {e.firedRules.length > 0 && (
            <div className="text-[11px] text-muted mt-1">rules: {e.firedRules.join(', ')}</div>
          )}
          {e.reviewNote && <div className="text-[11px] text-muted mt-1">note: {e.reviewNote}</div>}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <input
              value={notes[e.externalId] ?? ''}
              onChange={(ev) => setNotes((n) => ({ ...n, [e.externalId]: ev.target.value }))}
              placeholder="Reason (semis is the subject? cluster?)"
              className="flex-1 min-w-48 px-2 py-1 rounded bg-background border border-border text-xs"
            />
            <button
              disabled={busy === e.externalId}
              onClick={() => decide(e.externalId, 'approved')}
              className="px-3 py-1 rounded text-xs font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50"
            >
              Keep
            </button>
            <button
              disabled={busy === e.externalId}
              onClick={() => decide(e.externalId, 'rejected')}
              className="px-3 py-1 rounded text-xs font-medium bg-gray-500/15 text-gray-300 hover:bg-gray-500/25 disabled:opacity-50"
            >
              Drop
            </button>
            {e.reviewStatus !== 'pending' && (
              <button
                disabled={busy === e.externalId}
                onClick={() => decide(e.externalId, 'pending')}
                className="px-3 py-1 rounded text-xs text-muted hover:text-foreground disabled:opacity-50"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
