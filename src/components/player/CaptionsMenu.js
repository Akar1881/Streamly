'use client';

import Icon from '@/components/ui/Icon';
import PlayerMenu, { MenuDivider, MenuNote, MenuRow } from '@/components/player/PlayerMenu';

/**
 * ============================================================================
 *  PLAYER — captions menu
 * ============================================================================
 *  The track list, the subtitle delay, and the way into the appearance settings.
 *
 *  Delay is offered next to the tracks rather than buried in the settings panel
 *  because it is not a preference — it corrects a specific file that was timed
 *  slightly wrong, and a viewer reaches for it while watching, not while setting
 *  the site up. It steps in tenths, which is fine enough to fix a bad rip and
 *  coarse enough not to be fiddly.
 * ============================================================================
 */

/** One tenth of a second, in the direction asked for. */
const STEP = 0.1;

/** The furthest a subtitle may be shifted either way. */
const LIMIT = 30;

/**
 * @param {object} props
 * @param {{label: string, hint?: string}[]} props.tracks
 * @param {number|null} props.activeTrack  index into `tracks`, or null for off
 * @param {(index: number|null) => void} props.onSelectTrack
 * @param {number} props.delay             seconds, positive means subtitles later
 * @param {(delay: number) => void} props.onDelay
 * @param {() => void} props.onCustomize
 * @param {() => void} props.onClose
 */
export default function CaptionsMenu({
  tracks,
  activeTrack,
  onSelectTrack,
  delay,
  onDelay,
  onCustomize,
  onClose,
}) {
  const shift = (by) => onDelay(Math.round(Math.max(-LIMIT, Math.min(LIMIT, delay + by)) * 10) / 10);

  // A signed, one-decimal reading: `+0.4 s`, `-1.2 s`, `0.0 s`.
  const reading = `${delay > 0 ? '+' : delay < 0 ? '−' : ''}${Math.abs(delay).toFixed(1)} s`;

  return (
    <PlayerMenu title="Captions" onClose={onClose}>
      <MenuRow label="Off" selected={activeTrack === null} onClick={() => onSelectTrack(null)} />

      {tracks.map((track, index) => (
        <MenuRow
          key={`${track.src}-${index}`}
          label={track.label}
          trailing={track.hint}
          selected={activeTrack === index}
          onClick={() => onSelectTrack(index)}
        />
      ))}

      {tracks.length === 0 && <MenuNote>No subtitles available for this stream.</MenuNote>}

      <MenuDivider />

      <MenuNote>Standard translation</MenuNote>

      {/* The stepper is its own row shape rather than a `MenuRow` — it has two
          buttons and a live reading instead of a label and a tick. */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-white/70">
        <span className="min-w-0 flex-1 truncate">Subtitle Delay</span>

        <button
          type="button"
          onClick={() => shift(-STEP)}
          disabled={delay <= -LIMIT}
          aria-label="Subtitles earlier"
          className="grid size-6 place-items-center rounded-full text-white/80 transition-colors
            hover:bg-white/15 hover:text-white disabled:cursor-default disabled:opacity-30"
        >
          <Icon name="chevron-left" size={15} />
        </button>

        <span className="w-12 shrink-0 text-center text-xs tabular-nums text-white">{reading}</span>

        <button
          type="button"
          onClick={() => shift(STEP)}
          disabled={delay >= LIMIT}
          aria-label="Subtitles later"
          className="grid size-6 place-items-center rounded-full text-white/80 transition-colors
            hover:bg-white/15 hover:text-white disabled:cursor-default disabled:opacity-30"
        >
          <Icon name="chevron-right" size={15} />
        </button>
      </div>

      <MenuRow
        label="Customize"
        trailing="Appearance"
        onClick={onCustomize}
      />
    </PlayerMenu>
  );
}
