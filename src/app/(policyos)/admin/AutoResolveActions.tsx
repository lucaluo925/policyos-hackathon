'use client';

/**
 * Trigger the V9 auto-resolution engine manually from admin.
 * Shows a live summary of what the resolver did (approved / expired /
 * conflicts / collapsed) on success.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ResolveOutcome {
  scanned: number;
  collapsed: number;
  autoApproved: number;
  conflicted: number;
  expired: number;
  cappedSkipped: number;
  leftPending: number;
  reasons: Record<string, number>;
}

export default function AutoResolveActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ResolveOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const res = await fetch('/api/review/auto-resolve', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setOutcome(data.outcome as ResolveOutcome);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Resolving…' : 'Run auto-resolver now'}
        </button>
        <span className="text-[10px] text-muted">
          Scheduled daily at 04:00 UTC (Vercel cron). Manual trigger for immediate cleanup.
        </span>
      </div>
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{error}</div>
      )}
      {outcome && (
        <div className="p-3 rounded-lg bg-surface-2 border border-border text-xs">
          <div className="font-medium mb-1">Last run:</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-muted">scanned:</span> <span className="font-mono">{outcome.scanned}</span>
            </div>
            <div>
              <span className="text-muted">duplicates collapsed:</span>{' '}
              <span className="font-mono">{outcome.collapsed}</span>
            </div>
            <div>
              <span className="text-muted">auto-approved:</span>{' '}
              <span className="font-mono text-green-400">{outcome.autoApproved}</span>
            </div>
            <div>
              <span className="text-muted">expired:</span> <span className="font-mono">{outcome.expired}</span>
            </div>
            <div>
              <span className="text-muted">conflicts:</span>{' '}
              <span className="font-mono text-red-400">{outcome.conflicted}</span>
            </div>
            <div>
              <span className="text-muted">capped/skipped:</span>{' '}
              <span className="font-mono">{outcome.cappedSkipped}</span>
            </div>
            <div className="col-span-3">
              <span className="text-muted">left pending:</span>{' '}
              <span className="font-mono">{outcome.leftPending}</span>
              {Object.keys(outcome.reasons).length > 0 && (
                <span className="ml-3 text-muted">
                  by reason:{' '}
                  {Object.entries(outcome.reasons)
                    .map(([r, c]) => `${r.replace(/_/g, ' ')}=${c}`)
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
