'use client';

/**
 * /admin/login — simple password form. Submits to /api/admin/login,
 * redirects to /admin (or ?next=<path>) on success. The password never
 * touches client state beyond the input element; we post it straight to
 * the server and then clear it.
 */

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');
  const nextPath = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/admin';

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure we never leave the password in a history/ref-like state.
  useEffect(() => () => setPassword(''), []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      // Wipe the password from state as soon as the request fires.
      setPassword('');
      if (res.ok) {
        // Hard navigation: the client router may hold a prefetched /admin
        // response from before login (a redirect back here), so a soft
        // router.replace() would bounce the user to this page again.
        window.location.replace(nextPath);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data?.error ?? `Login failed (${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
      <div className="p-6 rounded-xl bg-surface border border-border">
        <h1 className="text-xl font-bold mb-1">Admin access</h1>
        <p className="text-xs text-muted mb-5">
          Enter the admin password to view the Freshness Engine dashboard.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1 text-muted uppercase tracking-wider" htmlFor="pw">
              Password
            </label>
            <input
              id="pw"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-sm focus:outline-none focus:border-accent"
            />
          </div>
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className="w-full px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Checking…' : 'Unlock admin'}
          </button>
          <p className="text-[10px] text-muted text-center">
            Single shared password. Session lasts until the browser closes.
          </p>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
