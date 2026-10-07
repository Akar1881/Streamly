'use client';

import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  PLAYER — the buttons over the picture
 * ============================================================================
 *  Play/pause and the two ten-second skips, centred on the video.
 *
 *  These exist alongside the bar's controls rather than instead of them: the
 *  bar is where a viewer goes to find a setting, and this is where they go when
 *  they just want to stop the film. They are faded out with the rest of the
 *  chrome and, like it, stay in the DOM so Tab still reaches them — so the
 *  wrapper takes no pointer events and only the buttons take them back.
 * ============================================================================
 */

/** The two skips, which differ only in direction, glyph and target. */
function SkipButton({ forward, seconds, onSkip }) {
  return (
    <button
      type="button"
      onClick={() => onSkip(forward ? seconds : -seconds)}
      aria-label={`${forward ? 'Forward' : 'Rewind'} ${seconds} seconds`}
      className="relative grid size-12 place-items-center rounded-full bg-white/10 text-white
        backdrop-blur-sm transition-colors hover:bg-white/25 sm:size-14"
    >
      <Icon name={forward ? 'rotate-cw' : 'rotate-ccw'} size={26} />
      {/* The number rides in the middle of the arrow, the way every player
          draws it, so the button says what it does without a label. */}
      <span className="absolute text-[9px] font-semibold tabular-nums">{seconds}</span>
    </button>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.playing
 * @param {() => void} props.onTogglePlay
 * @param {(seconds: number) => void} props.onSkip
 * @param {boolean} props.visible
 * @param {boolean} props.buffering
 */
export default function PlayerCenterControls({
  playing,
  onTogglePlay,
  onSkip,
  visible,
  buffering,
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-20 grid place-items-center
        transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {buffering ? (
        <Icon name="loader" size={36} className="animate-spin text-white/85" />
      ) : (
        // The buttons only take pointer events while they can be seen. Left
        // enabled they would still be clickable at zero opacity, and a click
        // meant to pause the film would land on an invisible play button.
        <div
          className={`flex items-center gap-5 transition-opacity sm:gap-8
            ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          <SkipButton forward={false} seconds={10} onSkip={onSkip} />

          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid size-16 place-items-center rounded-full bg-white/10 text-white
              backdrop-blur-sm transition-colors hover:bg-white/25 sm:size-18"
          >
            <Icon
              name={playing ? 'pause' : 'play'}
              size={30}
              className={playing ? 'fill-white' : 'ml-0.5 fill-white'}
            />
          </button>

          <SkipButton forward seconds={10} onSkip={onSkip} />
        </div>
      )}
    </div>
  );
}
