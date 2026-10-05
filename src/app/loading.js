import { HeroSkeleton, RowSkeleton } from '@/components/ui/Skeleton';

/** Shown while the home page's TMDB requests are in flight. */
export default function Loading() {
  return (
    <div className="space-y-10 px-4 py-6 sm:px-6 lg:px-8">
      <HeroSkeleton />
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </div>
  );
}
