import EmptyState from '@/components/ui/EmptyState';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <EmptyState
        icon="alert-circle"
        title="We could not find that page"
        description="The title may have been removed, or the link might be wrong."
        actionLabel="Back to home"
        actionHref="/"
      />
    </div>
  );
}
