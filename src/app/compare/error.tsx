'use client';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';

export default function CompareError({
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
      title="Comparison view failed"
      description="The comparison charts couldn't render. This can happen if a country code in the URL is invalid or the chart library failed to load."
    />
  );
}
