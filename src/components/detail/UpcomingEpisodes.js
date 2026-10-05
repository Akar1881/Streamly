'use client';

import { useEffect, useState } from 'react';
import { formatAirCountdown, formatDate } from '@/lib/format';
import Icon from '@/components/ui/Icon';

/**
 * The "next episode" pill in the season header, and the panel it opens.
 *
 * The whole list is server-rendered and handed over as a prop, so opening the
 * panel costs no request. Only shows that still have unreleased episodes get
 * one, so the trigger simply disappears once a series has finished.
 */
export default function UpcomingEpisodes({ episodes }) {
  const [open, setOpen] = useState(false);
  const next = episodes[0];
  const count = episodes.length;

  // Escape closes the panel; the page behind it stops scrolling while it is up.
  useEffect(() => {
    if (!open) return undefined;

    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!next) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Next episode: ${next.name}. ${count} upcoming episodes.`}
        className="group flex max-w-full items-center gap-3 rounded-[var(--radius-pill)] border
          border-line bg-card py-1.5 pl-2.5 pr-2 text-left transition-colors hover:bg-card-hover"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-text">
          <Icon name="calendar" size={15} />
        </span>

        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span
              className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[11px]
                font-semibold text-muted"
            >
              S{next.seasonNumber}E{next.episodeNumber}
            </span>
            <span className="truncate text-sm font-medium text-text">{next.name}</span>
          </span>

          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Icon name="calendar" size={12} />
              {formatDate(next.airDate)}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="clock" size={12} />
              {formatAirCountdown(next.airDate)}
            </span>
          </span>
        </span>

        <span
          className="ml-1 grid size-6 shrink-0 place-items-center rounded-full border border-line
            text-[11px] font-semibold text-muted"
        >
          {count}
        </span>
        <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
      </button>

      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm
            sm:items-center sm:p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Upcoming episodes"
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[var(--radius-card)]
              border border-line bg-surface shadow-2xl sm:rounded-[var(--radius-card)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-line p-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">Upcoming Episodes</h2>
                  <span
                    className="rounded-[var(--radius-pill)] border border-line bg-card px-2 py-0.5
                      text-xs font-medium text-muted"
                  >
                    {count}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  All unreleased episodes with their air dates
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-8 shrink-0 place-items-center rounded-full border border-line
                  bg-card text-muted transition-colors hover:text-text"
              >
                <Icon name="x" size={16} />
              </button>
            </header>

            <ul className="divide-y divide-line overflow-y-auto">
              {episodes.map((episode) => (
                <li key={episode.id} className="p-4 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span
                      className="shrink-0 rounded-md border border-line bg-card px-2 py-0.5
                        text-[11px] font-semibold text-muted"
                    >
                      S{episode.seasonNumber}E{episode.episodeNumber}
                    </span>
                    <span className="truncate text-sm font-medium text-text">{episode.name}</span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Icon name="calendar" size={12} />
                      {formatDate(episode.airDate)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Icon name="clock" size={12} />
                      {formatAirCountdown(episode.airDate)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
