'use client';
import { useEffect } from 'react';
import { Button, Empty, T } from '@hms/ui';

// Route error boundary: shows a generic message only. Error details (which may contain
// identifiers or server messages) are never rendered; the digest lets operators find the log.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('route error', error.digest ?? '');
  }, [error]);
  return (
    <div className="site-container site-section">
      <Empty
        title="Something went wrong"
        description="This page could not be loaded. Please try again, or contact the hospital directly."
      />
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" href="/">
          Return home
        </Button>
      </div>
      {error.digest && (
        <p style={{ textAlign: 'center', fontSize: 13 }}>
          <T en={'Reference: {0}'} values={[error.digest]} />
        </p>
      )}
    </div>
  );
}
