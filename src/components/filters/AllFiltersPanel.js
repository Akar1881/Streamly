'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';

/**
 * The "All Filters" dialog: every filter control in one place, laid out as a
 * grid instead of a scrolling row.
 *
 * It receives the controls already rendered by `FilterBar`, so there is exactly
 * one definition of what a filter is — this component only decides how they are
 * arranged. Filters apply to the URL as they are picked, so the results behind
 * the dialog are always up to date and there is nothing to submit.
 *
 * Presented as a bottom sheet on phones and a centred dialog from `sm` up.
 */
export default function AllFiltersPanel({ controls, activeCount, onClear, onClose }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    // The page scrolls on <body>, so locking it is what freezes the background.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="All filters"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm
        sm:items-center sm:p-6"
    >
      {/* Clicks inside the card must not reach the backdrop's close handler. */}
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85dvh] w-full flex-col rounded-t-[var(--radius-card)]
          border border-line bg-surface sm:max-w-3xl sm:rounded-[var(--radius-card)]"
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="sliders" size={17} />
            <h2 className="text-base font-semibold">All Filters</h2>
            {activeCount > 0 && (
              <span className="text-xs text-muted">
                {activeCount} active
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="grid size-8 place-items-center rounded-full text-muted transition-colors
              hover:bg-card hover:text-text"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="flex flex-wrap gap-2 overflow-y-auto p-5">{controls}</div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onClear}
            disabled={activeCount === 0}
            className="text-sm text-muted transition-colors hover:text-text
              disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear all
          </button>

          <Button variant="primary" onClick={onClose}>
            Show results
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
