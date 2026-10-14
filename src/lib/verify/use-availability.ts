'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VerificationAvailability } from './availability';

export function useVerificationAvailability() {
  const [availability, setAvailability] = useState<VerificationAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setLoading(true);
    try {
      const response = await fetch('/api/verify/availability', {
        cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
      });
      if (!response.ok) throw new Error('Check unavailable');
      const result = await response.json() as VerificationAvailability;
      if (!['available', 'daily_limit', 'budget_limit', 'expired', 'paused', 'unavailable', 'judge_required'].includes(result.status) ||
          !Number.isFinite(Date.parse(result.checkedAt)) ||
          (result.retryAt !== undefined && !Number.isFinite(Date.parse(result.retryAt)))) throw new Error('Invalid check');
      if (!controller.signal.aborted) setAvailability(result);
    } catch { if (!controller.signal.aborted) setAvailability(null); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void refresh(); });
    return () => { cancelled = true; mounted.current = false; active.current?.abort(); };
  }, [refresh]);
  return { availability, loading, refresh };
}
