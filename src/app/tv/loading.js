import { GridSkeleton, Skeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <Skeleton className="h-10 w-48 rounded" />
      <Skeleton className="mt-2 h-4 w-72 rounded" />
      <Skeleton className="mb-6 mt-6 h-9 w-full max-w-3xl rounded-[var(--radius-pill)]" />
      <GridSkeleton />
    </div>
  );
}
