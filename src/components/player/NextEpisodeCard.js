'use client';

import Link from 'next/link';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  PLAYER — the next-episode card
 * ============================================================================
 *  Offered over the picture once the episode is nearly over — the player mounts
 *  it past a fraction of the runtime rather than at the first frame, so it
 *  appears over the credits and nowhere else.
 *
 *  It is a link and nothing more. The player hands it a finished `href` and the
 *  three things worth printing, because the player is deliberately ignorant of
 *  what an episode is — the same reason it is handed stream URLs instead of a
 *  TMDB id. Deciding *which* episode comes next, and whether it can be watched
 *  at all, is the watch page's job; see `getNextEpisode` in `src/lib/tmdb/tv.js`.
 *
 *  Two sizes, because the picture under it is not the same size on both. Inline
 *  on a phone the player is about 200px tall and a card with a desktop-sized
 *  still covers half of it; on a desktop it is a small stamp in the corner of a
 *  large frame. So everything — the still, the padding, the type — steps up at
 *  `sm`, which is the same breakpoint the rest of the chrome uses.
 *
 *  The still is a plain `<img>`, not `next/image`, for the reason the poster in
 *  `VideoPlayer` is: it is one image in a corner that is either there or not
 *  there, and it is drawn at a fixed size the browser can work out itself.
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {string}  props.href         where the next episode is watched
 * @param {string}  props.code         "S2E3"
 * @param {string}  props.title        the episode's name
 * @param {string}  [props.still]      its thumbnail, already a URL
 * @param {boolean} props.raised       whether the control bar is up under it
 * @param {() => void} props.onDismiss
 */
export default function NextEpisodeCard({ href, code, title, still, raised, onDismiss }) {
  return (
    // The strip spans the frame so the card can sit against the right edge, and
    // `pointer-events-none` keeps it from swallowing clicks meant for the
    // picture — only the card itself takes the pointer back.
    //
    // `bottom` is animated rather than fixed, because the bar hides itself after
    // a few idle seconds and the card must not be left floating a bar's height
    // above nothing. It drops into the corner as the bar goes.
    <div
      className={`pointer-events-none absolute inset-x-0 z-30 flex justify-end px-3
        transition-[bottom] duration-200 sm:px-4
        ${raised ? 'bottom-[4.5rem] sm:bottom-[4.75rem]' : 'bottom-3 sm:bottom-4'}`}
    >
      <div className="pointer-events-auto relative">
        <Link
          href={href}
          aria-label={`Next episode: ${code} ${title}`}
          className="group flex w-56 items-center gap-2.5 rounded-[var(--radius-card)]
            border border-white/15 bg-black/75 p-2 backdrop-blur-md transition-colors
            hover:border-white/30 hover:bg-black/85 sm:w-80 sm:gap-3 sm:p-2.5"
        >
          <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-[var(--radius-button)] bg-white/10 sm:w-32">
            {still ? (
              <img src={still} alt="" aria-hidden="true" className="size-full object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-white/50">
                <Icon name="video" size={18} />
              </span>
            )}

            {/* The play badge, on hover only — it says what the card already is
                rather than adding anything, so it costs nothing to keep it off
                until the pointer is actually on the thing. */}
            <span
              className="absolute inset-0 grid place-items-center bg-black/35 opacity-0
                transition-opacity group-hover:opacity-100"
            >
              <span className="grid size-7 place-items-center rounded-full bg-white/90 text-black">
                <Icon name="play" size={13} className="translate-x-px fill-black" />
              </span>
            </span>
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide sm:text-xs">
              <span className="text-white/55">Next</span>
              <span className="text-white/35">·</span>
              <span className="tabular-nums text-white/80">{code}</span>
            </span>

            {/* Two lines at the most: an episode title is usually a sentence,
                and the third line is where it stops being a card and starts
                being a paragraph over the picture. */}
            <span className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-white sm:text-sm">
              {title}
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss next episode"
          className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full
            border border-white/15 bg-black/85 text-white/70 transition-colors hover:text-white"
        >
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
  );
}
