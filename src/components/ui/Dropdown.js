'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

/** Gap between the trigger and the panel, and the smallest viewport inset. */
const GAP = 8;
const MARGIN = 16;
/** The tallest the panel ever gets, used to keep it on screen near the bottom. */
const MAX_PANEL_HEIGHT = 340;
/** Long lists (every spoken language) are trimmed once filtered. */
const MAX_FILTERED = 60;

/**
 * A small popover-based select used by every filter control and the season
 * picker.
 *
 * Deliberately not a native `<select>`: the option lists need an optional
 * search box (companies are looked up from TMDB as you type) and need to match
 * the rest of the dark UI.
 *
 * The panel is rendered into `document.body` and positioned with viewport
 * coordinates rather than being a child of the trigger. It has to be: the
 * filter bar is a horizontally scrolling row, and `overflow-x: auto` forces
 * `overflow-y: auto` as well, which would crop the panel down to the height of
 * the row and make it unclickable. Escaping the row also means the panel is
 * never cut off at the edge of the screen.
 *
 * Two kinds of searchable list are supported and they behave differently:
 *   - `onSearch` given  → the term is sent away and the results are shown
 *     (production companies have no "list everything" endpoint).
 *   - no `onSearch`     → the already-loaded options are filtered here, in the
 *     browser (languages, networks). No request, so no loading state and
 *     nothing to go wrong.
 *
 * @param {object}   props
 * @param {string}   props.label        button text when nothing is selected
 * @param {string}   props.icon         optional leading icon
 * @param {Array}    props.options      [{ value, label }]
 * @param {string}   props.value        current value
 * @param {Function} props.onChange     (value | null) => void
 * @param {boolean}  props.searchable   show a filter box inside the popover
 * @param {Function} props.onSearch     (query) => Promise<[{ value, label }]>
 * @param {boolean}  props.loading
 * @param {'left'|'right'} props.align  which edge of the trigger to line up with
 * @param {number}   props.width        preferred panel width in pixels
 */
export default function Dropdown({
  label,
  icon,
  options = [],
  value,
  onChange,
  searchable = false,
  onSearch,
  loading = false,
  align = 'left',
  width = 256,
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null); // { top, left, width } in viewport units
  const [query, setQuery] = useState('');
  const [asyncOptions, setAsyncOptions] = useState([]);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const containerRef = useRef(null);
  const panelRef = useRef(null);

  // Defensive: a caller that passes nothing, or a list that has not loaded
  // yet, must not take the whole page down with it.
  const list = Array.isArray(options) ? options : [];
  const selected = list.find((option) => String(option.value) === String(value));
  const isActive = Boolean(value);

  const term = query.trim();
  const searching = searchable && term.length > 0;
  const remote = Boolean(onSearch);

  let visible = list;
  if (searching) {
    visible = remote
      ? asyncOptions
      : list
          .filter((option) => option.label.toLowerCase().includes(term.toLowerCase()))
          .slice(0, MAX_FILTERED);
  }

  const busy = loading || (searching && asyncLoading);

  const hint = busy
    ? 'Loading…'
    : searching
      ? 'No matches'
      : searchable && list.length === 0
        ? 'Start typing to search'
        : 'No options';

  /**
   * Works out where the panel belongs in viewport coordinates, nudging it back
   * inside the window on every edge so it is always fully visible.
   */
  const place = useCallback(() => {
    const trigger = containerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(width, window.innerWidth - MARGIN * 2);

    let left = align === 'right' ? rect.right - panelWidth : rect.left;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - panelWidth - MARGIN));

    // Opens downwards by default; slides up only when it would fall off the
    // bottom of the window.
    const top = Math.max(
      MARGIN,
      Math.min(rect.bottom + GAP, window.innerHeight - MAX_PANEL_HEIGHT - MARGIN),
    );

    // Scroll fires constantly — including from our own option list — so bail out
    // when nothing actually moved rather than re-rendering every frame.
    setBox((previous) =>
      previous?.top === top && previous?.left === left && previous?.width === panelWidth
        ? previous
        : { top, left, width: panelWidth },
    );
  }, [align, width]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setAsyncOptions([]);
  }, []);

  // Measured before the panel mounts, so it never paints in the wrong place.
  function toggle() {
    if (open) {
      close();
      return;
    }
    place();
    setOpen(true);
  }

  // --- keep the panel anchored while the page moves -----------------------
  useEffect(() => {
    if (!open) return undefined;

    // Captured, so a scroll of the filter row itself also repositions it.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);

    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  // --- close on outside click / Escape ------------------------------------
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      // The trigger handles its own clicks — closing here would make the button
      // close and immediately reopen the panel.
      if (containerRef.current?.contains(event.target)) return;
      // The panel lives in a portal, so it is not inside `containerRef`.
      if (panelRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') close();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  // --- remote (searchable) options ----------------------------------------
  useEffect(() => {
    if (!open || !remote || !term) return undefined;

    let cancelled = false;
    setAsyncLoading(true);

    const timer = setTimeout(() => {
      Promise.resolve(onSearch(term))
        .then((results) => {
          // An `onSearch` that forgets to return anything must not leave this
          // undefined — the list is mapped over on the next render.
          if (!cancelled) setAsyncOptions(Array.isArray(results) ? results : []);
        })
        .catch(() => {
          if (!cancelled) setAsyncOptions([]);
        })
        .finally(() => {
          if (!cancelled) setAsyncLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, open, remote, onSearch]);

  function choose(option) {
    onChange(String(option.value));
    close();
  }

  function clear(event) {
    event.stopPropagation();
    onChange(null);
    setQuery('');
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex h-9 items-center gap-2 rounded-[var(--radius-pill)] border px-3.5
          text-sm transition-colors
          ${
            isActive
              ? 'border-line bg-card text-text'
              : 'border-line bg-transparent text-muted hover:bg-card hover:text-text'
          }`}
      >
        {icon && <Icon name={icon} size={15} />}
        <span className="max-w-[9rem] truncate">{selected?.label ?? label}</span>

        {isActive ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label}`}
            onClick={clear}
            onKeyDown={(event) => event.key === 'Enter' && clear(event)}
            className="-mr-1 text-muted transition-colors hover:text-text"
          >
            <Icon name="x" size={14} />
          </span>
        ) : (
          <Icon name="chevron-down" size={14} />
        )}
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{ position: 'fixed', top: box.top, left: box.left, width: box.width }}
            className="z-[70] overflow-hidden rounded-[var(--radius-card)] border border-line
              bg-surface shadow-2xl"
          >
            {searchable && (
              <div className="border-b border-line p-2">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Type to search…"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 w-full rounded-[var(--radius-button)] border border-line bg-card
                    px-3 text-sm text-text placeholder:text-muted focus:outline-none"
                />
              </div>
            )}

            <div className="max-h-72 overflow-y-auto py-1">
              {visible.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-muted">{hint}</p>
              ) : (
                visible.map((option) => {
                  const active = String(option.value) === String(value);

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => choose(option)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2
                        text-left text-sm transition-colors
                        ${active ? 'bg-card text-text' : 'text-muted hover:bg-card hover:text-text'}`}
                    >
                      <span className="truncate">{option.label}</span>
                      {active && <Icon name="chevron-right" size={14} />}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
