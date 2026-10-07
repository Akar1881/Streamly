'use client';

import Icon from '@/components/ui/Icon';
import Slider from '@/components/player/Slider';
import { formatClock } from '@/lib/player/time';

/**
 * ============================================================================
 *  PLAYER — the bottom bar
 * ============================================================================
 *  The seek bar, the volume, the clock and the buttons that open a menu. The
 *  large play/pause and skip buttons over the picture live in
 *  `PlayerCenterControls.js`.
 *
 *  It owns no state. Everything here is a value the player holds and a callback
 *  that changes it, which keeps the two views of the same playback (this bar and
 *  the centre buttons) from ever disagreeing.
 * ============================================================================
 */

/** Every round icon button in the bar. */
const BUTTON = `grid size-9 shrink-0 place-items-center rounded-full text-white/85
  transition-colors hover:bg-white/15 hover:text-white`;

/** The three text buttons — Captions, the quality, the speed. */
const TEXT_BUTTON = `flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm
  transition-colors hover:bg-white/15`;

/**
 * Selects or mutes the volume depending on where the pointer is.
 *
 * Exported because the player's touch badge names the same state and would
 * otherwise have to guess at it a second time.
 */
export function volumeIcon(muted, volume) {
  if (muted || volume === 0) return 'volume-x';
  return volume < 0.5 ? 'volume-1' : 'volume-2';
}

/**
 * @param {object} props
 * @param {boolean} props.playing
 * @param {number}  props.currentTime
 * @param {number}  props.duration
 * @param {number}  props.buffered   seconds buffered from the start
 * @param {(seconds: number, final: boolean) => void} props.onSeek
 * @param {number}  props.volume     0…1
 * @param {boolean} props.muted
 * @param {(volume: number) => void} props.onVolume
 * @param {() => void} props.onToggleMute
 * @param {boolean} props.captionsOn   whether a track is showing
 * @param {string}  props.captionsLabel
 * @param {string|null} props.openMenu  which menu is open, if any
 * @param {(menu: string|null) => void} props.onOpenMenu
 * @param {string}  props.qualityLabel
 * @param {string}  props.speedLabel
 * @param {boolean} props.pipSupported
 * @param {() => void} props.onTogglePip
 * @param {boolean} props.fullscreen
 * @param {() => void} props.onToggleFullscreen
 * @param {boolean} props.visible      false once the controls auto-hide
 * @param {(hovering: boolean) => void} [props.onHover]
 *        whether the pointer is on the bar, so the player knows not to hide the
 *        controls out from under it
 */
export default function PlayerControls({
  playing,
  currentTime,
  duration,
  buffered,
  onSeek,
  volume,
  muted,
  onVolume,
  onToggleMute,
  captionsOn,
  captionsLabel,
  openMenu,
  onOpenMenu,
  qualityLabel,
  speedLabel,
  pipSupported,
  onTogglePip,
  fullscreen,
  onToggleFullscreen,
  visible,
  onHover,
}) {
  // `duration` is NaN until the browser has read the metadata, and Infinity for
  // a live stream. Both would render as a broken bar, so both read as zero here
  // and the seek bar simply has nothing to show until there is a real duration.
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;

  // On a phone the bar is about 340px wide and the three text buttons alone
  // want more than that, which pushed the fullscreen button off the right edge.
  // Below `sm` the labels are dropped and each button becomes its own icon.
  //
  // The label is repeated as `aria-label` because hiding it takes it out of the
  // accessibility tree — without it these three buttons would be nameless to a
  // screen reader on exactly the screens where they have no visible text.
  const menuButton = (id, text, { icon, compactIcon }) => (
    <button
      type="button"
      onClick={() => onOpenMenu(openMenu === id ? null : id)}
      aria-expanded={openMenu === id}
      aria-haspopup="dialog"
      aria-label={text}
      className={`${TEXT_BUTTON} ${openMenu === id ? 'bg-white/15 text-white' : 'text-white/85'}`}
    >
      {icon && <Icon name={icon} size={15} className="hidden sm:block" />}
      <Icon name={compactIcon ?? icon} size={19} className="sm:hidden" />
      <span className="hidden sm:inline">{text}</span>
    </button>
  );

  // Hovering pins the bar open so it cannot vanish under the pointer. A finger
  // also fires `pointerenter` and then never fires the matching `pointerleave`,
  // which on a phone left the bar stuck on screen for good — so the hover is
  // taken from a mouse and ignored from a touch.
  const hover = (on) => (event) => {
    if (event.pointerType !== 'touch') onHover(on);
  };

  return (
    <div
      onPointerEnter={onHover ? hover(true) : undefined}
      onPointerLeave={onHover ? hover(false) : undefined}
      // `pointer-events-none` while hidden so a click where a button used to be
      // toggles playback rather than pressing something invisible.
      className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/45
        to-transparent px-2 pb-2.5 pt-8 transition-opacity duration-200 sm:px-3
        ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <Slider
        label="Seek"
        value={currentTime}
        max={total}
        format={formatClock}
        onChange={onSeek}
        className="h-4"
      >
        {/* Buffered ranges, behind the played part. One bar to the furthest
            buffered point rather than every range: a seek can leave disjoint
            ranges behind, and drawing those as separate slivers is more
            confusion than information. */}
        <div
          className="absolute inset-y-0 left-0 h-full rounded-full bg-white/20"
          style={{ width: total ? `${Math.min(buffered / total, 1) * 100}%` : '0%' }}
        />
      </Slider>

      <div className="mt-1 flex items-center gap-0.5">
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
          className={BUTTON}
        >
          <Icon name={volumeIcon(muted, volume)} size={19} />
        </button>

        {/* Hidden on the narrowest screens: at that width the volume slider
            costs more room than it earns, and the button still mutes. */}
        <div className="hidden w-20 sm:block">
          <Slider
            label="Volume"
            value={muted ? 0 : volume}
            max={1}
            step={0.05}
            onChange={(next) => onVolume(next)}
            format={(value) => `${Math.round(value * 100)}%`}
            className="h-4"
          />
        </div>

        <span className="ml-1 shrink-0 text-sm tabular-nums text-white/90">
          {formatClock(currentTime)}
          {/* The total is the first thing dropped when the bar is out of room;
              the seek bar already says how far through the film we are. */}
          {total > 0 && (
            <span className="hidden text-white/50 min-[400px]:inline">
              {' '}
              / {formatClock(total)}
            </span>
          )}
        </span>

        <div className="flex-1" />

        {menuButton('captions', captionsLabel, {
          icon: captionsOn ? 'captions' : 'captions-off',
          compactIcon: captionsOn ? 'captions' : 'captions-off',
        })}
        {menuButton('quality', qualityLabel, { compactIcon: 'gauge' })}
        {menuButton('speed', speedLabel, { compactIcon: 'zap' })}

        {/* Picture-in-picture is a desktop affordance — a phone hands video to
            the system player instead — and it is the first thing worth giving up
            when the bar runs out of room. */}
        {pipSupported && (
          <button
            type="button"
            onClick={onTogglePip}
            aria-label="Picture in picture"
            className={`${BUTTON} hidden sm:grid`}
          >
            <Icon name="picture-in-picture" size={19} />
          </button>
        )}

        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          aria-pressed={fullscreen}
          className={BUTTON}
        >
          <Icon name={fullscreen ? 'minimize' : 'maximize'} size={19} />
        </button>
      </div>
    </div>
  );
}
