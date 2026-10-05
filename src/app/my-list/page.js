'use client';

import { useEffect, useState } from 'react';
import { clearMyList, getMyList, onStorageChange } from '@/lib/storage';
import MediaGrid from '@/components/media/MediaGrid';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { GridSkeleton } from '@/components/ui/Skeleton';

/**
 * The saved-titles page.
 *
 * Entirely client-side: the list lives in the visitor's browser, so there is
 * nothing to render on the server and nothing to sign in to.
 */
export default function MyListPage() {
  const [items, setItems] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(getMyList());
    setHydrated(true);
    return onStorageChange(() => setItems(getMyList()));
  }, []);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My List</h1>
          <p className="mt-1 text-sm text-muted">
            {hydrated && items.length > 0
              ? `${items.length} saved ${items.length === 1 ? 'title' : 'titles'}, kept in this browser`
              : 'Titles you save are kept in this browser'}
          </p>
        </div>

        {hydrated && items.length > 0 && (
          <Button
            variant="ghost"
            icon="x"
            onClick={() => {
              clearMyList();
              setItems([]);
            }}
          >
            Clear all
          </Button>
        )}
      </header>

      {!hydrated && <GridSkeleton count={12} />}

      {hydrated && items.length === 0 && (
        <EmptyState
          icon="bookmark"
          title="Nothing saved yet"
          description="Tap the bookmark on any movie or show and it will appear here."
          actionLabel="Browse movies"
          actionHref="/movies"
        />
      )}

      {hydrated && items.length > 0 && <MediaGrid items={items} />}
    </div>
  );
}
