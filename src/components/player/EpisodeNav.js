import Link from 'next/link';
import site from '@config/site';
import { neighbourEpisodes } from '@/lib/tmdb/tv';
import Icon from '@/components/ui/Icon';
import SeasonSwitcher from './SeasonSwitcher';

/**
 * Previous / next episode links under the player, which cross season
 * boundaries so a binge never dead-ends at the last episode of a season.
 *
 * The season picker sits beside them, not in the header: switching season is
 * the same kind of move as next/previous — it takes the viewer somewhere else —
 * so it belongs with the controls that do that.
 *
 * The links are wrapped in their own flex groups rather than laid out with
 * `justify-between` and empty `<span />` spacers, because the row now has to
 * hold two things on the right. With one child on a side, `justify-between`
 * would push the season picker to the far left instead of keeping it against
 * the Next button.
 */
export default function EpisodeNav({ show, slug, season, episode }) {
  if (!site.player.episodeNav) return null;

  const { previous, next } = neighbourEpisodes(show.seasons, season, episode);

  const linkClasses = `flex items-center gap-2 rounded-[var(--radius-button)] border
    border-line bg-card px-4 py-2.5 text-sm transition-colors hover:bg-card-hover`;

  return (
    <nav className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {previous && (
          <Link
            href={`/watch/tv/${slug}/${previous.season}/${previous.episode}`}
            className={linkClasses}
          >
            <Icon name="chevron-left" size={16} />
            <span>
              Previous
              <span className="ml-1.5 text-muted">
                S{previous.season}E{previous.episode}
              </span>
            </span>
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
        <SeasonSwitcher seasons={show.seasons} slug={slug} season={season} />

        {next && (
          <Link
            href={`/watch/tv/${slug}/${next.season}/${next.episode}`}
            className={linkClasses}
          >
            <span>
              Next
              <span className="ml-1.5 text-muted">
                S{next.season}E{next.episode}
              </span>
            </span>
            <Icon name="chevron-right" size={16} />
          </Link>
        )}
      </div>
    </nav>
  );
}

