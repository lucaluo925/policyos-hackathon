'use client';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';

export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorBoundary
      error={error}
      unstable_retry={unstable_retry}
      title="Page failed to render"
      description="We couldn't render this page. This is most likely a transient issue — try again, or navigate elsewhere."
    />
  );
}
