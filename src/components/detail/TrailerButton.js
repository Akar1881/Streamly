'use client';

import { useState } from 'react';
import Icon from '@/components/ui/Icon';
import Button from '@/components/ui/Button';

/**
 * Opens the title's trailer in a modal rather than navigating away, so the
 * visitor keeps their place on the page.
 *
 * Uses the privacy-friendly `youtube-nocookie` embed and only mounts the
 * iframe once opened, so no third-party request is made until asked for.
 */
export default function TrailerButton({ trailer, size = 'md' }) {
  const [open, setOpen] = useState(false);

  if (!trailer?.key) return null;

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        icon="video"
        onClick={() => setOpen(true)}
        title="Watch trailer"
      >
        <span className="hidden sm:inline">Trailer</span>
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Trailer"
          className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-4xl overflow-hidden rounded-[var(--radius-card)]
              border border-line bg-black shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative aspect-video">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0`}
                title={trailer.name ?? 'Trailer'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close trailer"
            className="absolute right-5 top-5 grid size-10 place-items-center rounded-full
              bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
      )}
    </>
  );
}
