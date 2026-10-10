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
 *
 * ---------------------------------------------------------------------------
 * What the row does at 360px
 * ---------------------------------------------------------------------------
 *
 * Three controls on one line is wider than a phone, and none of them can shrink:
 * a button's minimum width is the width of the word inside it, so flex has
 * nothing to give and the row simply overflows. That is not a cramped row, it is
 * the whole document — the page scrolls sideways under the viewer and the Next
 * button sits off the edge of the screen.
 *
 * So the row does two things. It wraps, which is the hard guarantee: a line that
 * cannot fit moves to the next one rather than widening the page, and `ml-auto`
 * on the right-hand group keeps that group against the right edge whether it is
 * on the same line as the others or below them. And below `sm` the two buttons
 * drop the words `Previous` and `Next`, which are the parts that were costing
 * the room — the chevrons already point the way, the episode code is the part
 * worth reading, and the `aria-label` keeps the sentence for anyone hearing it
 * instead of seeing it. The wrapping is then a fallback rather than the normal
 * case.
 */
export default function EpisodeNav({ show, slug, season, episode }) {
  if (!site.player.episodeNav) return null;

  const { previous, next } = neighbourEpisodes(show.seasons, season, episode);

  const linkClasses = `flex items-center gap-2 rounded-[var(--radius-button)] border
    border-line bg-card px-3 py-2.5 text-sm transition-colors hover:bg-card-hover sm:px-4`;

  return (
    <nav className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-3">
        {previous && (
          <Link
            href={`/watch/tv/${slug}/${previous.season}/${previous.episode}`}
            aria-label={`Previous episode, season ${previous.season} episode ${previous.episode}`}
            className={linkClasses}
          >
            <Icon name="chevron-left" size={16} />
            <span>
              <span className="hidden sm:inline">Previous</span>
              <span className="text-muted sm:ml-1.5">
                S{previous.season}E{previous.episode}
              </span>
            </span>
          </Link>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <SeasonSwitcher seasons={show.seasons} slug={slug} season={season} />

        {next && (
          <Link
            href={`/watch/tv/${slug}/${next.season}/${next.episode}`}
            aria-label={`Next episode, season ${next.season} episode ${next.episode}`}
            className={linkClasses}
          >
            <span>
              <span className="hidden sm:inline">Next</span>
              <span className="text-muted sm:ml-1.5">
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

