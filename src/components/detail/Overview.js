import site from '@config/site';
import { formatMoney, joinMeta, year } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/**
 * The Overview tab: synopsis, genre pills and whichever facts the title
 * actually has. Used by both movie and TV detail pages.
 */
export default function Overview({ media }) {
  const isTv = media.mediaType === 'tv';
  const genres = media.genres ?? [];

  /** Rows are omitted entirely when the value is missing. */
  const facts = [
    ['Status', media.status],
    ['Type', isTv ? media.type : null],
    ['Original title', media.originalTitle !== media.title ? media.originalTitle : null],
    ['Original language', media.spokenLanguages?.[0]?.english_name],
    [
      'Seasons',
      isTv && media.numberOfSeasons ? `${media.numberOfSeasons} (${media.numberOfEpisodes} episodes)` : null,
    ],
    ['Runtime', !isTv && media.runtime ? `${media.runtime} min` : null],
    ['Budget', !isTv ? formatMoney(media.budget) : null],
    ['Revenue', !isTv ? formatMoney(media.revenue) : null],
    ['First aired', isTv ? year(media.releaseDate) : null],
    ['Last aired', isTv && media.lastAirDate ? year(media.lastAirDate) : null],
    ['Network', isTv ? media.networks?.map((network) => network.name).join(', ') : null],
    ['Studio', media.productionCompanies?.[0]?.name],
    ['Country', media.productionCountries?.[0]?.name],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="space-y-5">
      {media.tagline && <p className="text-sm italic text-muted">“{media.tagline}”</p>}

      {media.overview && (
        <p className="max-w-3xl text-sm leading-relaxed text-muted">{media.overview}</p>
      )}

      {genres.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {genres.map((genre) => (
            <span
              key={genre.id}
              className="rounded-[var(--radius-pill)] border border-line bg-card px-3
                py-1 text-xs text-muted"
            >
              {genre.name}
            </span>
          ))}
        </div>
      )}

      {facts.length > 0 && (
        <dl
          className="grid gap-x-8 gap-y-3 border-t border-line pt-5
            sm:grid-cols-2 lg:grid-cols-3"
        >
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
              <dd className="mt-0.5 text-sm text-text">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {media.homepage && (
        <a
          href={media.homepage}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-text"
        >
          <Icon name="globe" size={15} />
          Official site
        </a>
      )}
    </div>
  );
}

/** Small helper used by the Collection tab heading. */
export function collectionMeta(collection) {
  return joinMeta([`${collection.items.length} films`, year(collection.items[0]?.releaseDate)]);
}
