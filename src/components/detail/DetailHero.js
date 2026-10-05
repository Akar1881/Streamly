import Image from 'next/image';
import site from '@config/site';
import { backdropUrl, logoUrl } from '@/lib/images';
import { formatRating, formatRuntime, joinMeta, toSlugId, year } from '@/lib/format';
import Icon from '@/components/ui/Icon';
import Button from '@/components/ui/Button';
import SaveButton from './SaveButton';
import ShareButton from './ShareButton';
import TrailerButton from './TrailerButton';
import { findTrailer } from '@/lib/tmdb/movies';

/**
 * The full-width header on a movie or TV detail page: backdrop, title artwork,
 * metadata line and the action row.
 *
 * `media` is the object returned by `getMovie` or `getShow` — both are shaped
 * identically so this component does not branch on type.
 */
export default function DetailHero({ media }) {
  const isTv = media.mediaType === 'tv';

  const backdrop = backdropUrl(media.backdropPath);
  const logo = media.logoPath ? logoUrl(media.logoPath) : null;
  const trailer = findTrailer(media.videos);

  /**
   * For TV the primary action continues where the visitor left off; for a film
   * it just plays.
   */
  const firstSeason = media.seasons?.[0]?.season_number ?? 1;
  const watchHref = isTv
    ? `/watch/tv/${toSlugId(media.id, media.title)}/${firstSeason}/1`
    : `/watch/movie/${toSlugId(media.id, media.title)}`;

  const meta = joinMeta([
    isTv ? 'TV' : 'Movie',
    year(media.releaseDate),
    isTv ? `${media.numberOfSeasons} seasons` : formatRuntime(media.runtime),
    formatRating(media.voteAverage),
  ]);

  return (
    <section className="relative">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-card)]
          border border-line bg-card sm:aspect-[21/9] lg:aspect-[2.6/1]"
      >
        {backdrop && (
          <Image
            src={backdrop}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent" />

        {/* ---------- actions, bottom-right ----------
            `z-10` is load-bearing: the title block below is also absolutely
            positioned and, being later in the DOM, would otherwise paint over
            this row and swallow its clicks. */}
        <div className="absolute bottom-4 right-4 z-10 hidden items-center gap-2 sm:flex">
          <TrailerButton trailer={trailer} />
          <ShareButton title={media.title} />
          <SaveButton media={media} />
        </div>

        {/* ---------- title block ---------- */}
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 lg:p-10">
          <div className="max-w-2xl">
            {logo ? (
              <div className="relative mb-3 h-16 w-52 sm:h-20 sm:w-72 lg:h-24 lg:w-96">
                <Image
                  src={logo}
                  alt={media.title}
                  fill
                  sizes="384px"
                  className="object-contain object-left drop-shadow-lg"
                />
              </div>
            ) : (
              <h1 className="mb-3 text-2xl font-bold text-white drop-shadow-lg sm:text-4xl lg:text-5xl">
                {media.title}
              </h1>
            )}

            <p className="mb-4 text-sm text-white/80">{meta}</p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="lg"
                href={watchHref}
                icon="play"
                className="!bg-white !text-black"
              >
                {isTv ? `Watch S${firstSeason}E1` : 'Watch now'}
              </Button>

              {/* Actions repeat on phones, where the top-right row is hidden. */}
              <div className="flex items-center gap-2 sm:hidden">
                <TrailerButton trailer={trailer} />
                <SaveButton media={media} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- title + meta fallback below the artwork ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-3 sm:mt-5">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{media.title}</h2>

        {media.certification && (
          <span
            className="rounded-md border border-line bg-card px-2 py-0.5 text-xs
              font-medium text-muted"
          >
            {media.certification}
          </span>
        )}

        {media.status && !isTv && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="info" size={13} />
            {media.status}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-muted">{meta}</p>
    </section>
  );
}
