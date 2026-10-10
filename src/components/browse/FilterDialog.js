'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  FILTER DIALOG
 * ============================================================================
 *  The modal shell every filter panel uses: a title and a line of help, the
 *  panel itself, then a footer with "Clear All" on the left and Cancel / Apply
 *  on the right.
 *
 *  Changes are only committed by Apply. Until then the panel edits a draft, so
 *  Cancel (or Escape, or a click on the backdrop) leaves the results — and the
 *  URL — untouched.
 * ============================================================================
 */
export default function FilterDialog({
  title,
  subtitle,
  onClose,
  onClear,
  onApply,
  clearLabel = 'Clear All',
  width = 'max-w-2xl',
  children,
}) {
  // Escape closes; the page behind must not scroll while the dialog is up.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto
        bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        // Only a press that starts on the backdrop dismisses — not a drag that
        // happens to end there after selecting a slider thumb.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/*
        The card is capped at the viewport height and laid out as a column, so
        only the middle grows a scrollbar. Without the cap a long panel — the
        genre grid is nineteen rows on a phone — is taller than the screen, and
        because the card is centred the top half ends up above the scrollable
        area where no amount of scrolling can reach it.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[calc(100dvh-2rem)] w-full ${width} flex-col
          rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-2xl sm:p-6`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full
              text-muted transition-colors hover:bg-card hover:text-text"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* `min-h-0` is what actually lets this shrink: a flex child refuses to
            go below its content size without it, which is the same overflow by
            another route. */}
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">{children}</div>

        <div className="mt-6 flex shrink-0 items-center justify-between gap-3">
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="h-9 rounded-[var(--radius-pill)] border border-line px-4 text-sm
                text-text transition-colors hover:bg-card"
            >
              {clearLabel}
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[var(--radius-pill)] px-4 text-sm text-muted
                transition-colors hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApply}
              className="h-9 rounded-[var(--radius-pill)] bg-accent px-5 text-sm font-medium
                text-accent-text transition-opacity hover:opacity-90"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
