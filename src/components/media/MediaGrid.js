import PosterCard from './PosterCard';

/**
 * The responsive poster grid used by the browse, search and My List pages.
 * Two columns on a phone, scaling to eight on a wide desktop.
 */
export default function MediaGrid({ items, priorityCount = 6 }) {
  if (!items?.length) return null;

  return (
    <div
      className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4
        lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
    >
      {items.map((item, index) => (
        <PosterCard
          key={`${item.mediaType}-${item.id}`}
          item={item}
          priority={index < priorityCount}
        />
      ))}
    </div>
  );
}
