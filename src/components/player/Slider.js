'use client';

import { useCallback, useRef, useState } from 'react';
import { clamp } from '@/lib/player/time';

/**
 * ============================================================================
 *  PLAYER — slider
 * ============================================================================
 *  The mechanics behind the seek bar, the volume bar and every control in the
 *  appearance panel: turn a pointer position into a value, and keep the value
 *  there while the pointer is held.
 *
 *  Not an `<input type="range">`. That element brings a native thumb and a
 *  native look that cannot be restyled consistently across browsers, and it
 *  cannot show the buffered ranges underneath the played part — which is the one
 *  thing a seek bar is really for. What it gives up it puts back by hand: arrow
 *  keys, Home and End, and `role="slider"` with a live `aria-valuenow`.
 *
 *  Two structural details are load-bearing. The thumb is a **sibling** of the
 *  track rather than a child, because the track clips its contents and would
 *  otherwise cut the thumb in half at both ends. And the track carries its own
 *  height, because the wrapper is a centred flex row — a child with no height
 *  collapses to nothing inside one.
 *
 *  Pointer capture on the wrapper is what makes a drag survive leaving the
 *  element. Without it a seek that wanders above the bar stops tracking halfway,
 *  which is the most common way a hand-rolled seek bar feels broken.
 * ============================================================================
 */

/**
 * @param {object} props
 * @param {number} props.value           current value, in `0…max`
 * @param {number} props.max
 * @param {number} [props.step]          keyboard increment
 * @param {(value: number, final: boolean) => void} props.onChange
 *        `final` is false while dragging and true on release, so a caller can
 *        preview a seek without committing to it.
 * @param {(value: number) => string} [props.format]  for the tooltip and `aria-valuetext`
 * @param {string} [props.label]         accessible name
 * @param {string} [props.className]     the hit area's height
 * @param {string} [props.trackClassName] the visible bar's height
 * @param {string} [props.fillClassName]
 * @param {React.ReactNode} [props.children]  drawn inside the track, behind the fill
 */
export default function Slider({
  value,
  max,
  step = 0,
  onChange,
  format,
  label,
  className = '',
  trackClassName = 'h-1.5',
  fillClassName = 'bg-accent',
  children,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(null); // ratio, or null

  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const ratio = safeMax ? clamp(value / safeMax, 0, 1) : 0;
  const percent = `${ratio * 100}%`;

  const ratioAt = useCallback((clientX) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (!rect.width) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  function handlePointerDown(event) {
    if (!safeMax) return;
    // Capture so the drag keeps reporting even once the pointer leaves the bar.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    onChange(ratioAt(event.clientX) * safeMax, false);
  }

  function handlePointerMove(event) {
    const at = ratioAt(event.clientX);
    setHover(at);
    if (dragging) onChange(at * safeMax, false);
  }

  function handlePointerUp(event) {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);
    onChange(ratioAt(event.clientX) * safeMax, true);
  }

  function handleKeyDown(event) {
    if (!safeMax) return;
    const delta = step || safeMax / 20;
    const keys = {
      ArrowRight: value + delta,
      ArrowUp: value + delta,
      ArrowLeft: value - delta,
      ArrowDown: value - delta,
      Home: 0,
      End: safeMax,
    };

    if (!(event.key in keys)) return;
    event.preventDefault();
    onChange(clamp(keys[event.key], 0, safeMax), true);
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(safeMax)}
      aria-valuenow={Math.round(clamp(value, 0, safeMax))}
      aria-valuetext={format ? format(value) : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHover(null)}
      onKeyDown={handleKeyDown}
      className={`group relative flex cursor-pointer touch-none items-center ${className}`}
    >
      <div className="relative w-full">
        {/* The visible bar. Kept thin while the hit area above stays tall — a
            4px bar is a miserable thing to hit with a thumb. `relative` so any
            caller-drawn layer (the buffered ranges) measures against the bar
            rather than the taller wrapper. */}
        <div
          className={`relative w-full overflow-hidden rounded-full bg-white/25 ${trackClassName}`}
        >
          {children}

          <div
            className={`relative h-full rounded-full ${fillClassName}`}
            style={{ width: percent }}
          />
        </div>

        {/* A sibling of the clipped bar, so the thumb is never cut in half.
            Positioned by its centre to line up with the end of the fill. */}
        <div
          className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full
            bg-white shadow-md transition-transform
            ${dragging ? 'scale-125' : 'scale-0 group-hover:scale-100 group-focus-visible:scale-100'}`}
          style={{ left: percent }}
        />
      </div>

      {/* Hover position, so the seek bar can show a time before you commit. */}
      {hover !== null && !dragging && format && (
        <div
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded
            bg-black/90 px-1.5 py-0.5 text-xs tabular-nums text-white shadow-lg"
          style={{ left: `${hover * 100}%` }}
        >
          {format(hover * safeMax)}
        </div>
      )}
    </div>
  );
}
