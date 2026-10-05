import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMovie } from '@/lib/tmdb/movies';
import { formatRuntime, joinMeta, parseId, toSlugId, year } from '@/lib/format';
import EmbedPlayer from '@/components/player/EmbedPlayer';
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
  };
}

export default async function WatchMoviePage({ params }) {
  const movie = await load(params);
  const detailHref = `/movies/${toSlugId(movie.id, movie.title)}`;

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

      <EmbedPlayer media={movie} />

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
