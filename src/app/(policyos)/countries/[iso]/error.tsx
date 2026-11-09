'use client';

import { ErrorBoundary } from '@/components/layout/ErrorBoundary';

export default function CountryError({
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
      title="Country brief failed to load"
      description="We couldn't render the policy brief for this country. The country code may be invalid, or a freshness metadata lookup failed."
    />
  );
}
