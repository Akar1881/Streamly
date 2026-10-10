'use client';

import { truncate } from '@/lib/format';

/**
 * ============================================================================
 *  PLAYER — what is playing
 * ============================================================================
 *  The title's own artwork, a line of synopsis and the words "You're watching",
 *  set into the bottom-left of the picture once the chrome has gone.
 *
 *  It exists for the moment the viewer looks up having forgotten what they put
 *  on — which is exactly the moment the player has faded everything else out.
 *  So it follows the chrome rather than the pointer: it is on screen when the
 *  bar is not, and it leaves the instant the bar comes back, because a viewer
 *  moving the mouse is a viewer who knows what they are watching.
 *
 *  That means it can be up over a running film, and it is built for that. The
 *  scrim is what makes three lines of white text legible over an arbitrary
 *  frame, and it is deliberately shallow — a third of the height, fading to
 *  nothing well above the middle — so the film is dimmed where the words are
 *  and untouched where it is not.
 *
 *  The synopsis is dropped below `sm` rather than shrunk. The player inline on
 *  a phone is about 200px tall, and a paragraph in the corner of it is a
 *  caption over the picture rather than information beside it.
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {string} [props.logo]      the title's logo artwork, already a URL
 * @param {string} [props.title]     falls back to the name when there is no logo
 * @param {string} [props.overview]
 * @param {boolean} props.visible    false while the controls are up
 */
export default function NowPlayingInfo({ logo, title, overview, visible }) {
  return (
    // `pointer-events-none` throughout: this sits over the gesture surface, and
    // a press on the words is a press on the film. `aria-hidden` because the
    // text repeats the page's own heading — a screen reader reaching it twice,
    // once vanishing and reappearing, is worse than not reaching it here.
    <div
      aria-hidden={!visible}
      className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-500
        ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div
        className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/75
          via-black/30 to-transparent"
      />

      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 lg:p-8">
        <div className="max-w-[75%] sm:max-w-md">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55 sm:mb-2 sm:text-[11px]">
            You&rsquo;re watching
          </p>

          {logo ? (
            // Height-led with `w-auto`, so a wide logo and a square one both sit
            // on the same baseline instead of one of them being stretched to a
            // box that suits neither.
            <img
              src={logo}
              alt=""
              className="mb-1.5 h-9 w-auto max-w-[70%] object-contain object-left drop-shadow-lg
                sm:mb-2 sm:h-14"
            />
          ) : (
            <p className="mb-1.5 text-base font-bold text-white drop-shadow-lg sm:mb-2 sm:text-2xl">
              {title}
            </p>
          )}

          {overview && (
            <p className="hidden text-xs leading-relaxed text-white/70 sm:line-clamp-3 sm:text-sm">
              {truncate(overview, 180)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
