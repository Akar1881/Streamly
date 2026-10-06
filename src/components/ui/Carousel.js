'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * How far the pointer must travel before a press counts as a drag. Below this
 * the gesture stays a click, so tapping a poster still opens it.
 */
const DRAG_THRESHOLD = 6;

/** Share of the row's speed it keeps for every 16 ms it glides after release. */
const FRICTION = 0.94;
/**
 * Release speeds, in px per ms. Under MIN the throw has stopped being motion
 * and is just a slow creep, so the snap takes over; above MAX a whip of the
 * mouse would fling the row further than anyone can follow.
 */
const MIN_VELOCITY = 0.05;
const MAX_VELOCITY = 4;
/** Share of the distance left to cover, per 16 ms, while easing onto a card. */
const SETTLE_EASE = 0.28;
/** A gesture untouched for longer than this has no speed worth carrying over. */
const VELOCITY_TIMEOUT = 80;
/** Longest frame the glide will integrate, so a stalled tab cannot teleport the row. */
const MAX_FRAME = 32;

/** Readers who asked for less motion get the snap without the throw. */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Where the row would come to rest if it snapped right now: the `.snap-item`
 * sitting nearest the current offset.
 *
 * Measured from the track's padding box, because that is the edge CSS scroll
 * snapping aligns to — the track carries `px-2` so the first card lines up with
 * the heading above it.
 */
function snapTarget(track) {
  const items = track.querySelectorAll('.snap-item');
  if (!items.length) return track.scrollLeft;

  const trackLeft = track.getBoundingClientRect().left;
  const padding = parseFloat(getComputedStyle(track).paddingLeft) || 0;

  let nearest = track.scrollLeft;
  let shortest = Infinity;

  items.forEach((item) => {
    // Distance from the aligned position, i.e. how far the row sits from
    // parking this card at the left edge.
    const offset = item.getBoundingClientRect().left - trackLeft - padding;
    const distance = Math.abs(offset);
    if (distance < shortest) {
      shortest = distance;
      nearest = track.scrollLeft + offset;
    }
  });

  return nearest;
}

/** Hands the row back to the CSS snap, undoing what a drag switched off. */
function releaseSnap(track) {
  track.style.removeProperty('scroll-snap-type');
  track.style.removeProperty('user-select');
}

/**
 * A horizontally scrolling strip with the prev/next arrows used throughout the
 * site (content rows, cast, episodes, related titles).
 *
 * The row can be moved four ways: the arrow buttons (desktop), a trackpad or
 * shift-wheel, click-and-drag with the mouse, and the glide a drag leaves
 * behind. On touch devices the browser's own panning and momentum already do
 * the job, so touch is left untouched.
 *
 * The arrows are desktop-only; on mobile the strip simply scrolls, and they are
 * hidden so they cannot cover content.
 */
export default function Carousel({ children, title, action, className = '' }) {
  const trackRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Drag bookkeeping lives in a ref, not state: it changes on every pointer
  // event and must never trigger a re-render mid-gesture.
  const drag = useRef({
    startX: 0,
    startScroll: 0,
    moved: false,
    velocity: 0,
    lastTime: 0,
    lastScroll: 0,
  });
  // Set on release so the click that follows a drag can be swallowed.
  const suppressClick = useRef(false);
  // Removes the window listeners belonging to the gesture in progress.
  const detach = useRef(null);
  // The single animation frame driving the glide, whichever phase it is in.
  const frame = useRef(null);

  const sync = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const { scrollLeft, scrollWidth, clientWidth } = track;
    setCanScrollLeft(scrollLeft > 8);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 8);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    sync();
    track.addEventListener('scroll', sync, { passive: true });

    // Content can load after mount, changing scrollWidth.
    const observer = new ResizeObserver(sync);
    observer.observe(track);

    return () => {
      track.removeEventListener('scroll', sync);
      observer.disconnect();
    };
  }, [sync]);

  /** Drops a glide in flight — used when a new gesture starts or we unmount. */
  const stopGlide = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  // A gesture or glide in flight when the row unmounts (navigating away
  // mid-drag) would otherwise leave listeners and frames behind.
  useEffect(
    () => () => {
      detach.current?.();
      stopGlide();
    },
    [stopGlide],
  );

  /** Scrolls by ~85% of a screenful, so a sliver stays visible for context. */
  function scrollBy(direction) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' });
  }

  /**
   * Carries the row on after the pointer lets go, in two phases that share one
   * animation frame: the throw decays under friction, then, once it has slowed
   * to a crawl, the row eases onto the nearest card.
   *
   * Running both here rather than handing the tail to CSS scroll snapping is
   * what keeps the release from reading as a stall followed by a jerk — the
   * snap is restored only once the row has already arrived where it was going.
   */
  const glide = useCallback(
    (releaseVelocity) => {
      const track = trackRef.current;
      if (!track) return;

      if (prefersReducedMotion()) {
        releaseSnap(track);
        return;
      }

      let velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, releaseVelocity));
      let last = performance.now();
      // The parking spot, decided once when the throw is spent: re-deciding it
      // every frame would have the row chasing whichever card is nearest.
      let target = track.scrollLeft;

      const settleStep = (now) => {
        const dt = Math.min(now - last, MAX_FRAME);
        last = now;

        const distance = target - track.scrollLeft;

        if (Math.abs(distance) < 0.5) {
          track.scrollLeft = target;
          releaseSnap(track);
          frame.current = null;
          return;
        }

        // Exponential ease-out: cover a fixed share of what is left each frame.
        track.scrollLeft += distance * (1 - Math.pow(1 - SETTLE_EASE, dt / 16));
        frame.current = requestAnimationFrame(settleStep);
      };

      function startSettle() {
        target = snapTarget(track);
        frame.current = requestAnimationFrame(settleStep);
      }

      const throwStep = (now) => {
        const dt = Math.min(now - last, MAX_FRAME);
        last = now;
        velocity *= Math.pow(FRICTION, dt / 16);

        const before = track.scrollLeft;
        track.scrollLeft = before + velocity * dt;

        // Either end of the row: there is nowhere left to travel, so stop
        // rather than spinning out the decay against the wall.
        if (track.scrollLeft === before || Math.abs(velocity) < MIN_VELOCITY) {
          startSettle();
          return;
        }

        frame.current = requestAnimationFrame(throwStep);
      };

      frame.current = requestAnimationFrame(throwStep);
    },
    [],
  );

  const endDrag = useCallback(() => {
    detach.current?.();
    detach.current = null;

    const track = trackRef.current;
    const wasDrag = drag.current.moved;
    drag.current.moved = false;

    // A press held still before release has no speed to carry: the pointer has
    // not moved for a while, so whatever it was doing before is stale.
    const stale = performance.now() - drag.current.lastTime > VELOCITY_TIMEOUT;
    const velocity = stale ? 0 : drag.current.velocity;

    suppressClick.current = wasDrag;
    setDragging(false);

    if (!track) return;
    if (!wasDrag) {
      // A plain click: snap was never switched off, so there is nothing to
      // restore and the row has not moved.
      releaseSnap(track);
      return;
    }

    // A drag always ends by easing onto a card — a throw keeps the speed it was
    // released with, a slow placement starts from a standstill. Letting the
    // browser snap the second case instead would land the row with a jerk.
    glide(velocity);
  }, [glide]);

  function onPointerDown(event) {
    // Touch, already handled natively by the browser's panning and momentum.
    // Intercepting it would only make the row feel worse.
    if (event.pointerType === 'touch' || event.button !== 0) return;

    const track = trackRef.current;
    if (!track) return;

    // Catch the row mid-glide so it follows the pointer from where it is,
    // rather than fighting the animation. Snap stays off so the row does not
    // jump to a card the moment it is grabbed.
    stopGlide();

    const now = performance.now();
    drag.current = {
      startX: event.clientX,
      startScroll: track.scrollLeft,
      moved: false,
      velocity: 0,
      lastTime: now,
      lastScroll: track.scrollLeft,
    };
    suppressClick.current = false;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - drag.current.startX;

      if (!drag.current.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        drag.current.moved = true;
        setDragging(true);
        // Free-form panning fights `scroll-snap-type: mandatory`, which would
        // yank the row to the nearest card on every frame. It is restored once
        // the release glide has finished. `user-select` stops the drag from
        // painting a text selection across the row.
        track.style.scrollSnapType = 'none';
        track.style.userSelect = 'none';
      }

      track.scrollLeft = drag.current.startScroll - dx;

      // Sample the pointer's speed as it goes, smoothed so one jittery event
      // cannot decide the whole throw. Read scrollLeft back rather than the
      // target: at either end the browser clamps, and a clamped row is not
      // moving, however fast the pointer is.
      const time = performance.now();
      const dt = time - drag.current.lastTime;
      if (dt > 0) {
        const instant = (track.scrollLeft - drag.current.lastScroll) / dt;
        drag.current.velocity = drag.current.velocity * 0.7 + instant * 0.3;
        drag.current.lastTime = time;
        drag.current.lastScroll = track.scrollLeft;
      }
    };

    detach.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };

    // Listen on window rather than using `setPointerCapture`: capturing would
    // retarget the click that follows a plain press, breaking the card links.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  /**
   * Swallows the click a drag would otherwise fire on release, so dragging
   * across a poster never navigates to it.
   */
  function onClickCapture(event) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const arrowClasses = `hidden size-8 place-items-center rounded-full border border-line
    bg-card text-muted transition-all hover:bg-card-hover hover:text-text
    disabled:cursor-not-allowed disabled:opacity-30 lg:grid`;

  return (
    <section className={className}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-4">
          {title && <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>}

          <div className="flex items-center gap-2">
            {action}
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              disabled={!canScrollLeft}
              aria-label="Scroll left"
              className={arrowClasses}
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              disabled={!canScrollRight}
              aria-label="Scroll right"
              className={arrowClasses}
            >
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </div>
      )}

      {/*
        The track sits inside the page's own padding so the first card lines up
        with the heading above it, rather than running into the page edge.

        The small negative margin + matching padding gives the cards room to
        grow on hover: `overflow-x: auto` forces `overflow-y: auto` too, so
        without it the scale and shadow would be clipped on all four sides.

        `dragstart` is blocked so the browser's native image/link dragging does
        not hijack the gesture and cancel our pointer events.
      */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onDragStart={(event) => event.preventDefault()}
        className={`no-scrollbar snap-row -mx-2 -my-2 flex gap-3 overflow-x-auto px-2 py-2
          ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        {children}
      </div>
    </section>
  );
}
