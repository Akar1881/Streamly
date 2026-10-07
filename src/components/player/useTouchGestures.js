'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp } from '@/lib/player/time';

/**
 * ============================================================================
 *  PLAYER — touch gestures
 * ============================================================================
 *  The finger equivalent of the keyboard: double-tap a side of the picture to
 *  skip, drag up and down to change the volume or the brightness, tap once for
 *  the controls, and — when the viewer has asked for it — press and hold for 2×.
 *
 *  This is a hook rather than more of `VideoPlayer` because it is a state
 *  machine in its own right. A press is not yet a tap, not yet a double tap, not
 *  yet a drag and not yet a hold, and which of those it becomes is only settled
 *  over the next few hundred milliseconds, by how far the finger moved and how
 *  long it stayed. That reasoning belongs in one place; spread through a render
 *  it would be unreadable.
 *
 *  It runs on pointer events rather than touch events, so a stylus and a finger
 *  take the same path and there is one set of timers to reason about. Only
 *  `pointerType === 'touch'` is routed here — `VideoPlayer` owns that dispatch,
 *  because the mouse has its own gesture (hold for 2×) on the same events.
 *
 *  Nothing here is mouse-only or touch-only by accident: the aim is that a
 *  visitor on a phone gets the shortcuts a visitor at a keyboard already has.
 * ============================================================================
 */

/** How far a finger must travel before a press stops being a press. */
const SLOP = 14;

/** The window in which a second tap is a double tap. */
const DOUBLE_TAP_MS = 300;

/** How far apart two taps may land and still be a double tap. */
const DOUBLE_TAP_SLOP = 90;

/**
 * How long a finger must rest before it counts as a hold.
 *
 * Longer than the mouse's, because on a finger a "tap" is a far looser thing —
 * at the mouse's delay an ordinary unhurried double tap would trip the hold on
 * its way to being a second tap.
 */
const TOUCH_HOLD_MS = 350;

/** How long a badge stays up after the finger lifts. */
const HUD_MS = 650;

/** The dimmest the picture can be dragged to. */
const MIN_BRIGHTNESS = 0.15;

/**
 * @param {object} options
 * @param {boolean} options.holdEnabled   whether "Hold for 2×" is switched on
 * @param {number}  options.skipSeconds    how far a double tap jumps
 * @param {number}  options.volume         0…1, read when a drag starts
 * @param {number}  options.brightness     0…1, read when a drag starts
 * @param {(seconds: number) => void} options.onSkip
 * @param {(volume: number) => void} options.onVolume
 * @param {(brightness: number) => void} options.onBrightness
 * @param {() => void} options.onControls  a single tap: show or hide the chrome
 * @param {() => void} options.onHoldStart
 * @param {() => boolean} options.onHoldEnd  returns whether a hold was live
 * @returns {{ hud: object|null, down: Function, move: Function, up: Function, cancel: Function }}
 */
export function useTouchGestures({
  holdEnabled,
  skipSeconds,
  volume,
  brightness,
  onSkip,
  onVolume,
  onBrightness,
  onControls,
  onHoldStart,
  onHoldEnd,
}) {
  /** What the badge should say, or null when there is nothing to show. */
  const [hud, setHud] = useState(null);

  const press = useRef(null); // the live press: where, when, and from what
  const mode = useRef(null); // 'volume' | 'brightness' | 'none', once settled
  const lastTap = useRef(0);
  const lastTapX = useRef(0);
  const tapTimer = useRef(0);
  const holdTimer = useRef(0);
  const hudTimer = useRef(0);

  // The callbacks are read through a ref so that a timer scheduled now still
  // calls the version from the render it was scheduled in, not from whenever it
  // happens to fire. The assignment runs after every render, which is always
  // before a finger can get to it.
  const latest = useRef({});
  useEffect(() => {
    latest.current = {
      holdEnabled,
      skipSeconds,
      volume,
      brightness,
      onSkip,
      onVolume,
      onBrightness,
      onControls,
      onHoldStart,
      onHoldEnd,
    };
  });

  /** Puts a badge up, keeping the same object when nothing it shows changed. */
  const showHud = useCallback((next) => {
    window.clearTimeout(hudTimer.current);
    setHud((current) => {
      if (!current || current.kind !== next.kind || current.side !== next.side) return next;
      // A drag reports every few pixels; only a whole percentage is worth a
      // re-render, and at this rate of change the viewer cannot tell.
      if (Math.round(current.value * 100) === Math.round(next.value * 100)) return current;
      return next;
    });
  }, []);

  /** Leaves the badge up long enough to read, then takes it down. */
  const fadeHud = useCallback(() => {
    window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(null), HUD_MS);
  }, []);

  const down = useCallback((event) => {
    window.clearTimeout(holdTimer.current);
    window.clearTimeout(hudTimer.current);
    // A second press settles what the first one was. Cancelling the pending
    // single-tap action here is what lets a tap be followed by a drag without
    // the chrome appearing halfway through it.
    window.clearTimeout(tapTimer.current);

    // Measured once, here, rather than per move: the box is what turns a
    // position into "left half or right half", and it is also the travel a drag
    // is scaled against.
    const box = event.currentTarget.getBoundingClientRect();
    const settings = latest.current;

    press.current = {
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      box,
      volume: settings.volume,
      brightness: settings.brightness,
    };
    mode.current = null;

    if (settings.holdEnabled) {
      holdTimer.current = window.setTimeout(() => {
        // If the finger has already gone somewhere, it is a drag that happens
        // to be slow, not a hold.
        if (mode.current) return;
        latest.current.onHoldStart?.();
      }, TOUCH_HOLD_MS);
    }
  }, []);

  const move = useCallback(
    (event) => {
      const start = press.current;
      if (!start) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (!mode.current) {
        // The first direction the finger commits to decides what this is. A
        // vertical drag that starts on the left half is the brightness and on
        // the right half the volume, which is where both are reached for.
        if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
          window.clearTimeout(holdTimer.current);
          latest.current.onHoldEnd?.();
          const { box } = start;
          mode.current = event.clientX < box.left + box.width / 2 ? 'brightness' : 'volume';
        } else if (Math.abs(dx) > SLOP) {
          // A horizontal drag is not a gesture this player claims. Having
          // decided that, it stays decided: a finger that wanders diagonally
          // must not become a volume drag halfway through.
          mode.current = 'none';
        }
      }

      if (mode.current !== 'volume' && mode.current !== 'brightness') return;

      // The full height of the picture is the full range, which is about the
      // sensitivity a thumb expects. Dragging up always means more.
      const travel = Math.max(start.box.height, 1);
      const delta = -dy / travel;

      if (mode.current === 'volume') {
        const next = clamp(start.volume + delta, 0, 1);
        latest.current.onVolume?.(next);
        showHud({ kind: 'volume', value: next });
      } else {
        const next = clamp(start.brightness + delta, MIN_BRIGHTNESS, 1);
        latest.current.onBrightness?.(next);
        showHud({ kind: 'brightness', value: next });
      }
    },
    [showHud],
  );

  const up = useCallback(
    (event) => {
      const start = press.current;
      press.current = null;
      window.clearTimeout(holdTimer.current);

      if (!start) return;

      // A hold ends on its own terms; it is neither a drag nor a tap.
      if (latest.current.onHoldEnd?.()) {
        mode.current = null;
        lastTap.current = 0;
        fadeHud();
        return;
      }

      if (mode.current) {
        // A drag. It said everything it had to say while the finger was down.
        mode.current = null;
        lastTap.current = 0;
        fadeHud();
        return;
      }

      const settings = latest.current;

      if (
        event.timeStamp - lastTap.current < DOUBLE_TAP_MS &&
        Math.abs(event.clientX - lastTapX.current) < DOUBLE_TAP_SLOP
      ) {
        window.clearTimeout(tapTimer.current);
        lastTap.current = 0;

        // Which side was tapped is the direction of the jump, which is the
        // whole gesture: the thumb does not have to find a button.
        const back = event.clientX < start.box.left + start.box.width / 2;
        settings.onSkip?.(back ? -settings.skipSeconds : settings.skipSeconds);
        showHud({ kind: 'skip', side: back ? 'left' : 'right' });
        fadeHud();
        return;
      }

      lastTap.current = event.timeStamp;
      lastTapX.current = event.clientX;
      window.clearTimeout(tapTimer.current);
      // Waiting out the double-tap window is the price of having a double tap at
      // all: acting now would mean acting before the second tap could arrive.
      // It is bearable because a tap does not start or stop the film — the
      // buttons do — so the delay is only ever felt on the chrome appearing.
      tapTimer.current = window.setTimeout(() => {
        lastTap.current = 0;
        latest.current.onControls?.();
      }, DOUBLE_TAP_MS);
    },
    [fadeHud, showHud],
  );

  /** The browser took the pointer away — a system gesture, or the edge of the screen. */
  const cancel = useCallback(() => {
    const wasLive = press.current !== null || mode.current !== null;
    press.current = null;
    mode.current = null;
    lastTap.current = 0;
    window.clearTimeout(holdTimer.current);
    latest.current.onHoldEnd?.();
    // Also on a drag: a cancelled drag never reaches `up`, and without this its
    // badge would stay on screen with nothing left to take it down.
    if (wasLive) fadeHud();
  }, [fadeHud]);

  useEffect(
    () => () => {
      window.clearTimeout(tapTimer.current);
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(hudTimer.current);
    },
    [],
  );

  return { hud, down, move, up, cancel };
}
