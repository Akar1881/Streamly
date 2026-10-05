'use client';

import EmptyState from '@/components/ui/EmptyState';

/**
 * Catches render errors anywhere in the app so a single failed section cannot
 * take down the whole page.
 */
export default function Error({ error, reset }) {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <EmptyState
        icon="alert-circle"
        title="Something went wrong"
        description={
          error?.message ??
          'An unexpected error occurred. Trying again often clears it up.'
        }
        actionLabel="Try again"
        onAction={reset}
      />
    </div>
  );
}
