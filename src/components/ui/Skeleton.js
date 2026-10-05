/**
 * Loading placeholders. The shimmer itself is the `.skeleton` utility in
 * globals.css, so it follows the theme automatically.
 */

export function Skeleton({ className = '' }) {
  return <div className={`skeleton rounded-[var(--radius-card)] ${className}`} />;
}

/** Matches the footprint of a PosterCard so the layout does not jump. */
export function PosterSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[2/3] w-full" />
      <Skeleton className="mt-2 h-4 w-3/4 rounded" />
      <Skeleton className="mt-1 h-3 w-1/3 rounded" />
    </div>
  );
}

/** A full grid of poster placeholders. */
export function GridSkeleton({ count = 18 }) {
  return (
    <div
      className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4
        lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
    >
      {Array.from({ length: count }, (_, index) => (
        <PosterSkeleton key={index} />
      ))}
    </div>
  );
}

/** A horizontal row of poster placeholders. */
export function RowSkeleton({ count = 8 }) {
  return (
    <div>
      <Skeleton className="mb-3 h-7 w-48 rounded" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="w-[140px] shrink-0 sm:w-[160px] lg:w-[180px]">
            <PosterSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stands in for the detail-page hero. */
export function HeroSkeleton() {
  return <Skeleton className="aspect-[16/10] w-full sm:aspect-[21/9] lg:aspect-[2.6/1]" />;
}

export default Skeleton;
