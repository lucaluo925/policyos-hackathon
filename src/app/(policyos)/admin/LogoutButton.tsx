'use client';

/**
 * Small client-side Logout button for the admin dashboard. Posts to
 * /api/admin/logout to clear the session cookie, then redirects to the
 * login page.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      router.replace('/admin/login');
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="px-3 py-1 rounded-lg text-xs font-medium bg-surface-2 border border-border text-muted hover:text-foreground hover:border-accent/40 transition-colors disabled:opacity-50"
      title="Clear the admin_auth cookie and return to login."
    >
      {busy ? 'Logging out…' : 'Logout'}
    </button>
  );
}
