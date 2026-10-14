'use client';

import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  PLAYER — menu shell
 * ============================================================================
 *  The panel behind the captions, quality, speed and appearance menus.
 *
 *  Unlike the filter popovers in `src/components/ui/Dropdown.js` this is not
 *  portalled. Those have to escape their trigger because they live inside a
 *  horizontally scrolling row whose `overflow` would crop them; this panel lives
 *  inside the player frame, which is a plain positioned box, so being a child of
 *  it is both simpler and correct — it cannot end up outside the video.
 *
 *  The panel is capped, and the middle of it is what scrolls. There are two
 *  caps and the shorter one wins, because the two ways a menu can go wrong pull
 *  in opposite directions.
 *
 *  The room left above the control bar is the hard one. This panel is a child
 *  of the player frame, the frame clips its children, and on a phone that frame
 *  is a 16:9 box barely 200px tall with the bar claiming the bottom of it — so a
 *  menu laid out at its natural height used to lose its top off the top of the
 *  picture.
 *
 *  The other cap is the fixed `28rem`, and it is for the opposite failure. A
 *  menu's height is its content's, and the captions list runs to a row per
 *  language a release shipped; a fullscreen player on a phone, meanwhile, is a
 *  frame-relative cap of the entire screen. The two together make a list that
 *  grows without limit inside a cap that never stops it, which is a menu that
 *  covers the film it is being used to choose subtitles for. The fixed cap is
 *  what keeps the panel a panel at every size.
 *
 *  Header and footer are pinned, so the title and the action always stay in
 *  view.
 *
 *  The colours are deliberately hard-coded black and white rather than the
 *  theme's `--card` and `--text`. This panel is always over video, and the light
 *  theme's near-white surfaces would read as a hole punched in the picture. The
 *  hero carousel solves the same problem the same way.
 * ============================================================================
 */

/** The panel itself. */
export default function PlayerMenu({ title, onBack, onClose, children, footer, wide = false }) {
  // The `min()` below is the two caps from the header, shorter one winning, and
  // the `28rem` is written out as a literal on purpose: Tailwind reads this file
  // as plain text, so a value assembled from a constant would reach the scanner
  // as `min(${…},…)` and compile to nothing at all.
  return (
    <div
      role="dialog"
      aria-label={title}
      className={`absolute bottom-[4.75rem] right-2 z-30 flex max-h-[min(28rem,calc(100%-5.25rem))]
        max-w-[calc(100%-1rem)] flex-col overflow-hidden
        rounded-[var(--radius-card)] border border-white/10 bg-black/90 text-white shadow-2xl
        backdrop-blur-md sm:right-3 ${wide ? 'w-[21rem]' : 'w-[17.5rem]'}`}
    >
      <header className="flex shrink-0 items-center gap-1 px-2 py-2.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="grid size-7 shrink-0 place-items-center rounded-full text-white/70
              transition-colors hover:bg-white/10 hover:text-white"
          >
            <Icon name="chevron-left" size={16} />
          </button>
        )}

        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{title}</h2>

        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="grid size-7 shrink-0 place-items-center rounded-full text-white/70
            transition-colors hover:bg-white/10 hover:text-white"
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      {/* `min-h-0` is what lets this give way: a flex child will not shrink below
          its content without it, which would push the header off the top again. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/10 py-1">
        {children}
      </div>

      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  );
}

/**
 * One row inside a menu.
 *
 * `role` is `menuitemradio` rather than a plain button because every list here
 * is a choice between mutually exclusive options, and a screen reader should
 * announce which one is current — the tick is decoration to anyone who cannot
 * see it.
 */
export function MenuRow({ label, hint, trailing, selected = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors
        ${
          disabled
            ? 'cursor-default text-white/40'
            : selected
              ? 'text-white'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
        }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>

      {trailing && <span className="shrink-0 text-xs text-white/50">{trailing}</span>}
      {selected && <Icon name="check" size={15} className="shrink-0 text-white" />}
    </button>
  );
}

/** A small caption between groups of rows, such as "Standard translation". */
export function MenuNote({ children }) {
  return (
    <p className="px-3 pb-1 pt-3 text-xs text-white/45 first:pt-1.5">{children}</p>
  );
}

/** A hairline between groups. */
export function MenuDivider() {
  return <div className="my-1 border-t border-white/10" />;
}
