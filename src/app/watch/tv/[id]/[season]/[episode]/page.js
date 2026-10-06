import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSeason, getShow } from '@/lib/tmdb/tv';
import { daysUntil, formatDate, formatRuntime, joinMeta, parseId, toSlugId } from '@/lib/format';
import EmbedPlayer from '@/components/player/EmbedPlayer';
import ReleaseNotice from '@/components/media/ReleaseNotice';
import EpisodeNav from '@/components/player/EpisodeNav';
import EpisodeCard from '@/components/media/EpisodeCard';
import Carousel from '@/components/ui/Carousel';
import Icon from '@/components/ui/Icon';

export const revalidate = 21600;

async function load(params) {
  const { id, season, episode } = await params;

  const tmdbId = parseId(id);
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);

  if (!tmdbId || !Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber)) {
    notFound();
  }

  try {
    const [show, seasonData] = await Promise.all([
      getShow(tmdbId),
      getSeason(tmdbId, seasonNumber),
    ]);

    const current = seasonData.episodes.find(
      (item) => item.episodeNumber === episodeNumber,
    );
    if (!current) notFound();

    return { show, season: seasonData, episode: current, seasonNumber, episodeNumber };
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }) {
  const { show, episode, seasonNumber, episodeNumber } = await load(params);

  return {
    title: `${show.title} — S${seasonNumber}E${episodeNumber}`,
    description: episode.overview || show.overview,
    // Player page — see the matching note in the movie watch route and the
    // explanation in `robots.js`.
    robots: { index: false, follow: true },
  };
}

export default async function WatchEpisodePage({ params }) {
  const { show, season, episode, seasonNumber, episodeNumber } = await load(params);

  const slug = toSlugId(show.id, show.title);
  const detailHref = `/tv/${slug}`;

  // A deep link to an episode that has not aired yet has nothing to play.
  const unaired = (daysUntil(episode.airDate) ?? 0) > 0;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href={detailHref}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted
          transition-colors hover:text-text"
      >
        <Icon name="chevron-left" size={16} />
        Back to {show.title}
      </Link>

      {unaired ? (
        <ReleaseNotice
          title={`S${seasonNumber}E${episodeNumber} · ${episode.name}`}
          date={episode.airDate}
          noun="episode"
          participle="aired"
        />
      ) : (
        <EmbedPlayer media={show} season={seasonNumber} episode={episodeNumber} />
      )}

      <header className="mt-6">
        <p className="text-sm text-muted">
          {show.title} · Season {seasonNumber}
        </p>

        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {episodeNumber}. {episode.name}
        </h1>

        <p className="mt-1 text-sm text-muted">
          {joinMeta([formatRuntime(episode.runtime), formatDate(episode.airDate)])}
        </p>

        {episode.overview && (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{episode.overview}</p>
        )}
      </header>

      <div className="mt-6">
        <EpisodeNav show={show} slug={slug} season={seasonNumber} episode={episodeNumber} />
      </div>

      {season.episodes.length > 1 && (
        <div className="mt-10">
          <Carousel title={`Season ${seasonNumber}`}>
            {season.episodes.map((item) => (
              <div key={item.id} className="snap-item w-[240px] shrink-0 sm:w-[280px]">
                <EpisodeCard episode={item} showId={show.id} showSlug={slug} />
              </div>
            ))}
          </Carousel>
        </div>
      )}
    </div>
  );
}
