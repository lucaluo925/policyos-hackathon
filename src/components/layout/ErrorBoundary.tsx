'use client';

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  title?: string;
  description?: string;
  showHomeLink?: boolean;
}

/**
 * Shared error UI for route-level error boundaries.
 * Next.js 16 passes `unstable_retry` (was `reset` in older versions).
 */
export function ErrorBoundary({
  error,
  unstable_retry,
  title = 'Something went wrong',
  description = 'An error occurred while rendering this page. You can try again, or continue exploring other parts of PolicyOS.',
  showHomeLink = true,
}: ErrorBoundaryProps) {
  useEffect(() => {
    // Surface the error to the browser console for debugging.
    // In a production system this would ship to an observability backend (Sentry, Datadog, etc.).
    console.error('[PolicyOS error boundary]', error);
  }, [error]);

  const digestLabel = error.digest ? `Error ref: ${error.digest}` : null;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="p-6 rounded-xl bg-surface border border-red-500/30">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-10 h-10 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center text-lg flex-shrink-0">
            !
          </span>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-xs text-muted mt-0.5">
              PolicyOS surfaced an unexpected error rather than showing stale or partial data.
            </p>
          </div>
        </div>

        <p className="text-sm text-muted leading-relaxed mb-4">{description}</p>

        {error.message && (
          <details className="mb-4 text-xs">
            <summary className="cursor-pointer text-muted hover:text-foreground transition-colors">
              Show technical detail
            </summary>
            <pre className="mt-2 p-3 rounded-lg bg-background border border-border/50 overflow-x-auto text-[11px] text-muted whitespace-pre-wrap break-words">
              {error.message}
              {digestLabel ? `\n\n${digestLabel}` : ''}
            </pre>
          </details>
        )}

        <div className="flex flex-wrap gap-2">
          {unstable_retry && (
            <button
              onClick={unstable_retry}
              className="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
            >
              Try again
            </button>
          )}
          {showHomeLink && (
            <Link
              href="/"
              className="px-4 py-2 rounded-lg bg-surface-2 border border-border text-foreground text-sm font-medium hover:bg-background transition-colors"
            >
              Go to home
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
