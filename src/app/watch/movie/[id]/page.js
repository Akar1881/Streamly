import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMovie } from '@/lib/tmdb/movies';
import { daysUntil, formatRuntime, joinMeta, parseId, toSlugId, year } from '@/lib/format';
import PlayerStage from '@/components/player/PlayerStage';
import ReleaseNotice from '@/components/media/ReleaseNotice';
import MediaRow from '@/components/media/MediaRow';
import Icon from '@/components/ui/Icon';

export const revalidate = 21600;

async function load(params) {
  const { id } = await params;
  const tmdbId = parseId(id);
  if (!tmdbId) notFound();

  try {
    return await getMovie(tmdbId);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }) {
  const movie = await load(params);
  return {
    title: `Watch ${movie.title}`,
    description: movie.overview,
    // This page is an embedded player and nothing else. Indexing it would put
    // a title-less frame in search results and invite it to compete with the
    // detail page, which is the one worth ranking. `follow` keeps the links
    // out of here counting towards that page. See `robots.js` for why this
    // page is deliberately crawlable rather than Disallowed.
    robots: { index: false, follow: true },
  };
}

export default async function WatchMoviePage({ params }) {
  const movie = await load(params);
  const detailHref = `/movies/${toSlugId(movie.id, movie.title)}`;

  // A future release date, or a title TMDB still lists as unfinished and gives
  // no date, has nothing to play yet — show the countdown instead of an empty
  // player.
  const days = daysUntil(movie.releaseDate);
  const unreleased = days === null ? Boolean(movie.status) && movie.status !== 'Released' : days > 0;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href={detailHref}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted
          transition-colors hover:text-text"
      >
        <Icon name="chevron-left" size={16} />
        Back to details
      </Link>

      {unreleased ? (
        <ReleaseNotice title={movie.title} date={movie.releaseDate} />
      ) : (
        <PlayerStage media={movie} />
      )}

      <header className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{movie.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {joinMeta([year(movie.releaseDate), formatRuntime(movie.runtime), movie.certification])}
        </p>

        {movie.overview && (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{movie.overview}</p>
        )}
      </header>

      {movie.related.length > 0 && (
        <div className="mt-10">
          <MediaRow title="More like this" items={movie.related} />
        </div>
      )}
    </div>
  );
}
