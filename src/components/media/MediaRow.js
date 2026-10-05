import Carousel from '@/components/ui/Carousel';
import PosterCard from './PosterCard';

/**
 * A titled, horizontally scrolling row of posters — the building block of the
 * home page and the "Related" sections.
 */
export default function MediaRow({ title, items, action, priority = false }) {
  if (!items?.length) return null;

  return (
    <Carousel title={title} action={action}>
      {items.map((item, index) => (
        <div
          key={`${item.mediaType}-${item.id}`}
          className="snap-item w-[140px] shrink-0 sm:w-[160px] lg:w-[180px]"
        >
          <PosterCard
            item={item}
            priority={priority && index < 6}
            sizes="(max-width: 640px) 140px, (max-width: 1024px) 160px, 180px"
          />
        </div>
      ))}
    </Carousel>
  );
}
