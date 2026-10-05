import Link from 'next/link';
import site from '@config/site';
import { neighbourEpisodes } from '@/lib/tmdb/tv';
import Icon from '@/components/ui/Icon';

/**
 * Previous / next episode links under the player, which cross season
 * boundaries so a binge never dead-ends at the last episode of a season.
 */
export default function EpisodeNav({ show, slug, season, episode }) {
  if (!site.player.episodeNav) return null;

  const { previous, next } = neighbourEpisodes(show.seasons, season, episode);
  if (!previous && !next) return null;

  const linkClasses = `flex items-center gap-2 rounded-[var(--radius-button)] border
    border-line bg-card px-4 py-2.5 text-sm transition-colors hover:bg-card-hover`;

  return (
    <nav className="flex items-center justify-between gap-3">
      {previous ? (
        <Link href={`/watch/tv/${slug}/${previous.season}/${previous.episode}`} className={linkClasses}>
          <Icon name="chevron-left" size={16} />
          <span>
            Previous
            <span className="ml-1.5 text-muted">
              S{previous.season}E{previous.episode}
            </span>
          </span>
        </Link>
      ) : (
        <span />
      )}

      {next ? (
        <Link href={`/watch/tv/${slug}/${next.season}/${next.episode}`} className={linkClasses}>
          <span>
            Next
            <span className="ml-1.5 text-muted">
              S{next.season}E{next.episode}
            </span>
          </span>
          <Icon name="chevron-right" size={16} />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
