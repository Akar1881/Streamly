'use client';

import Icon from '@/components/ui/Icon';
import PlayerMenu from '@/components/player/PlayerMenu';

/**
 * ============================================================================
 *  PLAYER — Sync to audio
 * ============================================================================
 *  The panel behind the Captions menu's "Sync to audio" row.
 *
 *  It is a view of `useAudioSync` and holds nothing of its own — the session
 *  outlives the panel on purpose, so the viewer can start it, close the panel
 *  and keep watching while the subtitles correct themselves. Closing therefore
 *  does *not* stop it; the button does, and Cancel is the way to abandon a run.
 *
 *  The reading is the point of the panel, so it is the largest thing in it. A
 *  live number that walks towards a value and stops is how the viewer can tell
 *  the feature is working rather than waiting on faith — and it is why the value
 *  holds steady when the correlation dips instead of dropping to zero and
 *  climbing back, which would read as a feature that had lost its place.
 * ============================================================================
 */

/** `+1.4` — signed, because which way it moved is the whole content of the number. */
function reading(offset) {
  // The same minus sign as the stepper's reading, so the two do not disagree
  // about how a negative number looks when they sit one menu apart.
  const shown = Math.abs(offset ?? 0) < 0.05 ? 0 : offset;
  return `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${Math.abs(shown).toFixed(1)}`;
}

/** The round badge at the top, matching the panel's mock. */
function Badge({ live }) {
  return (
    <span
      className={`grid size-11 place-items-center rounded-full border transition-colors
        ${live ? 'border-white/40 bg-white/10 text-white' : 'border-white/15 bg-white/5 text-white/70'}`}
    >
      <Icon name="audio-waveform" size={19} />
    </span>
  );
}

/** What the panel says under the reading, given where the session is. */
function message(status, seconds, score) {
  switch (status) {
    case 'listening':
      // The percentage is the correlation, not a progress bar, and it is shown
      // as words rather than a number: "0.62" invites the viewer to read a
      // precision into it that a heuristic does not have.
      if (score >= 0.6) return `Listening — that sounds like a match. ${Math.round(seconds)}s in.`;
      if (score >= 0.35) return `Listening — getting there. ${Math.round(seconds)}s in.`;
      return `Listening to the audio. ${Math.round(seconds)}s in.`;

    case 'done':
      return 'Applied. The subtitles have been moved to match.';

    case 'unclear':
      return 'Could not tell from that. Try starting it over a stretch where somebody is talking.';

    case 'unsupported':
      return 'This browser will not let the player listen to its own audio.';

    default:
      return 'Listens to the audio and works out the subtitle delay for you.';
  }
}

/**
 * @param {object} props
 * @param {string} props.status       from `useAudioSync`
 * @param {number} props.seconds
 * @param {number|null} props.offset
 * @param {number} props.score
 * @param {() => void} props.onStart
 * @param {() => void} props.onStop
 * @param {() => void} props.onCancel
 * @param {() => void} props.onBack
 * @param {() => void} props.onClose
 */
export default function SyncToAudioPanel({
  status,
  seconds,
  offset,
  score,
  onStart,
  onStop,
  onCancel,
  onBack,
  onClose,
}) {
  const listening = status === 'listening';
  const unsupported = status === 'unsupported';

  return (
    <PlayerMenu
      title="Sync to audio"
      onBack={onBack}
      onClose={onClose}
      footer={
        <div className="border-t border-white/10 p-2">
          <button
            type="button"
            disabled={unsupported}
            onClick={listening ? onStop : onStart}
            className={`h-10 w-full rounded-[var(--radius-button)] text-sm font-medium transition-colors
              ${
                unsupported
                  ? 'cursor-default bg-white/10 text-white/35'
                  : 'bg-white text-black hover:bg-white/90'
              }`}
          >
            {unsupported
              ? 'Unavailable'
              : listening
                ? 'Stop & apply'
                : status === 'idle'
                  ? 'Start sync'
                  : 'Sync again'}
          </button>
        </div>
      }
    >
      <div className="px-4 pb-3 pt-4 text-center">
        <div className="flex justify-center">
          <Badge live={listening} />
        </div>

        <h3 className="mt-3 text-sm font-semibold text-white">Sync to audio</h3>

        <p className="mx-auto mt-1 max-w-[15rem] text-xs leading-snug text-white/55">
          {message(status, seconds, score)}
        </p>

        <div className="mt-4">
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">
            {reading(offset)}
            <span className="ml-1 text-base font-normal text-white/45">s</span>
          </p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
            Subtitle offset
          </p>
        </div>

        {listening && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 text-xs text-white/50 underline-offset-2 transition-colors hover:text-white/80 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
    </PlayerMenu>
  );
}
