'use client';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';

export default function AdminError({
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
      title="Admin dashboard error"
      description="The operations dashboard couldn't render. This typically indicates a persistence-layer issue — pipeline runs and audit writes may still be landing in the store."
    />
  );
}
