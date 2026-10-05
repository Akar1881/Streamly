import Link from 'next/link';
import Image from 'next/image';
import { posterUrl } from '@/lib/images';
import { formatRating, toSlugId, year } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/**
 * The poster tile used by every grid and row on the site.
 *
 * Title and meta sit in an overlay that fades in on hover, so the artwork is
 * unobstructed at rest — matching the reference layout.
 */
export default function PosterCard({ item, priority = false, sizes }) {
  const href = `/${item.mediaType === 'tv' ? 'tv' : 'movies'}/${toSlugId(item.id, item.title)}`;
  const image = posterUrl(item.posterPath);
  const rating = formatRating(item.voteAverage);
  const released = year(item.releaseDate);

  return (
    <Link
      href={href}
      className="group block focus:outline-none"
      aria-label={item.title}
    >
      <div
        className="relative aspect-[2/3] overflow-hidden rounded-[var(--radius-card)]
          border border-line bg-card transition-all duration-300
          group-hover:border-muted/40 group-focus-visible:border-muted
          group-hover:shadow-xl group-hover:shadow-black/40"
      >
        {image ? (
          <Image
            src={image}
            alt={item.title}
            fill
            priority={priority}
            sizes={sizes ?? '(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 15vw'}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full place-items-center text-muted">
            <Icon name="film" size={28} />
          </div>
        )}

        {/* rating chip */}
        {rating && (
          <div
            className="absolute right-2 top-2 flex items-center gap-1 rounded-full
              bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm"
          >
            <Icon name="star" size={11} className="fill-star text-star" />
            {rating}
          </div>
        )}

        {/* hover overlay */}
        <div
          className="absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t
            from-black/90 via-black/60 to-transparent p-3 opacity-0 transition-all duration-300
            group-hover:translate-y-0 group-hover:opacity-100
            group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
        >
          <p className="line-clamp-2 text-sm font-medium leading-snug text-white">{item.title}</p>
          <p className="mt-0.5 text-xs text-white/70">
            {[item.mediaType === 'tv' ? 'TV' : 'Movie', released].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* play affordance */}
        <div
          className="absolute inset-0 grid place-items-center opacity-0 transition-opacity
            duration-300 group-hover:opacity-100"
        >
          <span className="grid size-11 place-items-center rounded-full bg-white/90 text-black">
            <Icon name="play" size={18} className="translate-x-px fill-black" />
          </span>
        </div>
      </div>

      {/* title under the card, always visible (needed on touch devices) */}
      <p className="mt-2 line-clamp-1 text-sm text-text transition-colors group-hover:text-text">
        {item.title}
      </p>
      <p className="text-xs text-muted">{released}</p>
    </Link>
  );
}
