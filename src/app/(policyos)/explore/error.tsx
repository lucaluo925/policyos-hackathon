'use client';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';

export default function ExploreError({
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
      title="Map failed to load"
      description="The interactive policy map couldn't initialize. This is usually a browser or network issue — try again, or fall back to the country comparison view."
    />
  );
}
