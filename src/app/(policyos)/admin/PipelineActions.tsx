'use client';

import { useState } from 'react';

interface PipelineResult {
  status: string;
  changeDetected?: boolean;
  changeType?: string | null;
  newHash?: string;
  metadata?: {
    linkCount?: number;
  };
  message?: string;
  error?: string;
}

export default function PipelineActions() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/pipeline/canada-immigration', {
        method: 'GET',
      });
      const data = (await res.json()) as PipelineResult;
      if (!res.ok) {
        setError(data.error || data.message || `Request failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setResult(null);
    setError(null);
  }

  const newHashShort = result?.newHash ? result.newHash.slice(0, 10) : null;

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Running...' : 'Run Canada Immigration Check'}
        </button>
        {(result || error) && (
          <button
            type="button"
            onClick={clear}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-2 text-muted hover:text-white border border-border"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          <div className="font-medium mb-1">Pipeline failed</div>
          <div className="text-xs">{error}</div>
        </div>
      )}

      {result && !error && (
        <div className="p-3 rounded-lg bg-surface-2 border border-border text-sm">
          <div className="font-medium mb-2">Pipeline result</div>
          <dl className="grid grid-cols-2 gap-1 text-xs">
            <dt className="text-muted">Status</dt>
            <dd className="font-mono">{result.status}</dd>
            <dt className="text-muted">Change detected</dt>
            <dd className="font-mono">{String(result.changeDetected ?? false)}</dd>
            <dt className="text-muted">Change type</dt>
            <dd className="font-mono">{result.changeType ?? 'n/a'}</dd>
            {newHashShort && (
              <>
                <dt className="text-muted">New hash</dt>
                <dd className="font-mono">{newHashShort}…</dd>
              </>
            )}
            {result.metadata?.linkCount !== undefined && (
              <>
                <dt className="text-muted">Link count</dt>
                <dd className="font-mono">{result.metadata.linkCount}</dd>
              </>
            )}
          </dl>
          {result.message && (
            <p className="mt-2 text-xs text-muted">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
