'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function JudgeLogin({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(logout: boolean) {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/judge/${logout ? 'logout' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(logout ? {} : { code }), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        const messages: Record<number, string> = { 401: 'The testing code was not accepted.', 403: 'Open the judge entrance on this website.' };
        throw new Error(messages[res.status] ?? 'Sign-in is unavailable. Try again.');
      }
      setCode(''); router.refresh();
    } catch (cause) { setError(cause instanceof Error && (cause.message === 'The testing code was not accepted.' || cause.message === 'Open the judge entrance on this website.' || cause.message === 'Sign-in is unavailable. Try again.') ? cause.message : 'The request did not finish. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4">
    {authenticated ? <><p>You are signed in for live testing. Sessions last up to eight hours and end no later than the authorized testing deadline.</p><button disabled={busy} onClick={() => submit(true)} className="rounded-lg border border-border p-3 disabled:opacity-50">{busy ? 'Signing out…' : 'Sign out'}</button></>
      : <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!busy) void submit(false); }}>
        <label className="block" htmlFor="judge-code">Testing code</label><input id="judge-code" type="password" autoComplete="off" maxLength={512} required value={code} onChange={event => setCode(event.target.value)} className="w-full rounded-lg border border-border bg-background p-3" />
        <button disabled={busy || !code} className="rounded-lg bg-accent px-4 py-3 text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in for testing'}</button>
      </form>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
  </section>;
}
