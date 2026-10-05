'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * How far the pointer must travel before a press counts as a drag. Below this
 * the gesture stays a click, so tapping a poster still opens it.
 */
const DRAG_THRESHOLD = 6;

/**
 * A horizontally scrolling strip with the prev/next arrows used throughout the
 * site (content rows, cast, episodes, related titles).
 *
 * The row can be moved three ways: the arrow buttons (desktop), a trackpad or
 * shift-wheel, and click-and-drag with the mouse. On touch devices the browser's
 * own panning and momentum already do the job, so touch is left untouched.
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
  const drag = useRef({ startX: 0, startScroll: 0, moved: false });
  // Set on release so the click that follows a drag can be swallowed.
  const suppressClick = useRef(false);
  // Removes the window listeners belonging to the gesture in progress.
  const detach = useRef(null);

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

  // A gesture in flight when the row unmounts (navigating away mid-drag) would
  // otherwise leave listeners on window.
  useEffect(() => () => detach.current?.(), []);

  /** Scrolls by ~85% of a screenful, so a sliver stays visible for context. */
  function scrollBy(direction) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' });
  }

  const endDrag = useCallback(() => {
    detach.current?.();
    detach.current = null;

    const track = trackRef.current;
    if (track) {
      track.style.removeProperty('scroll-snap-type');
      track.style.removeProperty('user-select');
    }

    suppressClick.current = drag.current.moved;
    drag.current.moved = false;
    setDragging(false);
  }, []);

  function onPointerDown(event) {
    // Touch, already handled natively by the browser's panning and momentum.
    // Intercepting it would only make the row feel worse.
    if (event.pointerType === 'touch' || event.button !== 0) return;

    const track = trackRef.current;
    if (!track) return;

    drag.current = { startX: event.clientX, startScroll: track.scrollLeft, moved: false };
    suppressClick.current = false;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - drag.current.startX;

      if (!drag.current.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        drag.current.moved = true;
        setDragging(true);
        // Free-form panning fights `scroll-snap-type: mandatory`, which would
        // yank the row to the nearest card on every frame. It is restored on
        // release. `user-select` stops the drag from painting a text selection
        // across the row.
        track.style.scrollSnapType = 'none';
        track.style.userSelect = 'none';
      }

      track.scrollLeft = drag.current.startScroll - dx;
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
