import Link from 'next/link';
import Image from 'next/image';
import { stillUrl } from '@/lib/images';
import { formatDate, formatRating, formatRuntime } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/**
 * One episode in a season's strip. Links straight into the player.
 */
export default function EpisodeCard({ episode, showId, showSlug }) {
  const href = `/watch/tv/${showSlug ?? showId}/${episode.seasonNumber}/${episode.episodeNumber}`;
  const image = stillUrl(episode.stillPath);
  const rating = formatRating(episode.voteAverage);

  return (
    <Link href={href} className="group block focus:outline-none" aria-label={episode.name}>
      <div
        className="relative aspect-video overflow-hidden rounded-[var(--radius-card)]
          border border-line bg-card transition-colors group-hover:border-muted/40"
      >
        {image ? (
          <Image
            src={image}
            alt=""
            fill
            sizes="(max-width: 640px) 70vw, 280px"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full place-items-center text-muted">
            <Icon name="video" size={24} />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />

        {/* episode number */}
        <span
          className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-[11px]
            font-semibold text-white backdrop-blur-sm"
        >
          S{episode.seasonNumber}E{episode.episodeNumber}
        </span>

        {/* rating */}
        {rating && rating !== '0.0' && (
          <span
            className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/70
              px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm"
          >
            <Icon name="star" size={10} className="fill-star text-star" />
            {rating}
          </span>
        )}

        {/* play on hover */}
        <div
          className="absolute inset-0 grid place-items-center opacity-0 transition-opacity
            group-hover:opacity-100"
        >
          <span className="grid size-10 place-items-center rounded-full bg-white/90 text-black">
            <Icon name="play" size={16} className="translate-x-px fill-black" />
          </span>
        </div>
      </div>

      <p className="mt-2 line-clamp-1 text-sm font-medium text-text">{episode.name}</p>
      <p className="text-xs text-muted">
        {[formatRuntime(episode.runtime), formatDate(episode.airDate)].filter(Boolean).join(' · ')}
      </p>
    </Link>
  );
}
