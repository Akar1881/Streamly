'use client';

import PlayerMenu, { MenuDivider, MenuRow } from '@/components/player/PlayerMenu';

/**
 * ============================================================================
 *  PLAYER — speed menu
 * ============================================================================
 *  Playback rate, plus the "hold for 2×" gesture that is faster than any menu.
 *
 *  The rates are the ones viewers recognise. `1` is labelled Normal rather than
 *  `1×` because it is the state you are trying to get back to, and seeing the
 *  word makes it easier to spot.
 * ============================================================================
 */

const RATES = [
  { value: 0.5, label: '0.5×' },
  { value: 0.75, label: '0.75×' },
  { value: 1, label: 'Normal' },
  { value: 1.25, label: '1.25×' },
  { value: 1.5, label: '1.5×' },
  { value: 2, label: '2×' },
];

/**
 * @param {object} props
 * @param {number} props.rate
 * @param {(rate: number) => void} props.onRate
 * @param {boolean} props.hold    whether holding the player runs at 2×
 * @param {(hold: boolean) => void} props.onHold
 * @param {() => void} props.onClose
 */
export default function SpeedMenu({ rate, onRate, hold, onHold, onClose }) {
  return (
    <PlayerMenu title="Speed" onClose={onClose}>
      {/* A switch rather than a row of rates: it is a different kind of thing —
          a gesture you use in passing, not a setting you leave on. */}
      <button
        type="button"
        role="switch"
        aria-checked={hold}
        onClick={() => onHold(!hold)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors
          hover:bg-white/10"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-white">Hold for 2×</span>
          <span className="mt-0.5 block text-xs leading-snug text-white/50">
            Temporarily speed up while holding the video
          </span>
        </span>

        <span
          className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors
            ${hold ? 'bg-accent' : 'bg-white/25'}`}
        >
          <span
            className={`size-4 rounded-full bg-white transition-transform
              ${hold ? 'translate-x-4' : 'translate-x-0'}`}
          />
        </span>
      </button>

      <MenuDivider />

      {RATES.map((option) => (
        <MenuRow
          key={option.value}
          label={option.label}
          selected={rate === option.value}
          onClick={() => onRate(option.value)}
        />
      ))}
    </PlayerMenu>
  );
}
