'use client';

import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  PLAYER — the skip button
 * ============================================================================
 *  Offered while the playhead is inside a range the community has timed: the
 *  recap, the opening titles, or the end credits. One click moves to the end of
 *  that range, which is the whole feature — the viewer is never asked to guess
 *  how far in they are.
 *
 *  The player decides *which* range is live and hands over the type; the words
 *  live here, because they are the only thing this component knows. A type it
 *  has no label for is not rendered rather than shown as a nameless button.
 *
 *  It is the same dark glass as the next-episode card, because that is what the
 *  player already draws over a picture and a white pill in the same corner would
 *  read as belonging to a different thing. The glyph carries the seek bar's own
 *  colour, which is the only thing connecting the button to the pale band it is
 *  standing in for — and it is the one accent that survives being drawn on a
 *  dark surface rather than the other way round.
 * ============================================================================
 */

/** What each range is called on the button. */
const LABELS = {
  recap: 'Skip Recap',
  intro: 'Skip Intro',
  outro: 'Skip Outro',
};

/**
 * @param {object} props
 * @param {'recap'|'intro'|'outro'} props.type  which range is playing
 * @param {() => void} props.onSkip
 */
export default function SkipSegmentButton({ type, onSkip }) {
  const label = LABELS[type];
  if (!label) return null;

  return (
    <button
      type="button"
      onClick={onSkip}
      className="pointer-events-auto flex items-center gap-1.5 rounded-[var(--radius-pill)]
        border border-white/15 bg-black/75 px-3.5 py-2 text-xs font-semibold text-white
        backdrop-blur-md transition-colors hover:border-white/30 hover:bg-black/85
        sm:gap-2 sm:px-5 sm:py-2.5 sm:text-sm"
    >
      <Icon name="skip-forward" size={16} className="text-segment" />
      {label}
    </button>
  );
}
