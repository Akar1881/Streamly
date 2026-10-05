'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import site from '@config/site';
import { buildDiscoverParams } from '@/lib/tmdb/filters';
import { fetchTmdb } from '@/lib/tmdb/browser';
import { normaliseMedia } from '@/lib/tmdb/normalise';
import MediaGrid from '@/components/media/MediaGrid';
import { GridSkeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';

/**
 * ============================================================================
 *  BROWSE RESULTS
 * ============================================================================
 *  Owns the result grid for /movies and /tv.
 *
 *  The first page is rendered on the server and handed in as `initialItems`, so
 *  the page is useful immediately and indexable. Subsequent pages are fetched
 *  in the browser as the visitor scrolls.
 *
 *  Filters live in the URL, so this component just watches `searchParams` and
 *  resets whenever they change.
 * ============================================================================
 */
export default function BrowseResults({ mediaType, initialItems, initialTotalPages }) {
  const searchParams = useSearchParams();
  const key = searchParams.toString();

  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Tracks which filter set the current `items` belong to, so a stale response
  // from a previous filter set can never be appended.
  const activeKey = useRef(key);

  /** Reset the list whenever the filters change. */
  useEffect(() => {
    activeKey.current = key;
    setItems(initialItems);
    setTotalPages(initialTotalPages);
    setPage(1);
    setError(null);
  }, [key, initialItems, initialTotalPages]);

  const loadMore = useCallback(async () => {
    if (loading || page >= totalPages) return;

    const requestKey = activeKey.current;
    const nextPage = page + 1;

    setLoading(true);
    setError(null);

    try {
      const filters = Object.fromEntries(new URLSearchParams(requestKey));
      const data = await fetchTmdb(`discover/${mediaType}`, {
        ...buildDiscoverParams(mediaType, filters),
        page: nextPage,
        language: site.tmdb.language,
        include_adult: site.tmdb.includeAdult,
      });

      // Filters changed while this was in flight — throw the result away.
      if (activeKey.current !== requestKey) return;

      const fresh = (data.results ?? []).map((item) => normaliseMedia(item, mediaType));

      setItems((current) => {
        // TMDB can repeat a title across pages; de-duplicate by id.
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...fresh.filter((item) => !seen.has(item.id))];
      });
      setPage(nextPage);
      setTotalPages(Math.min(data.total_pages ?? nextPage, 500));
    } catch (requestError) {
      if (activeKey.current === requestKey) setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [loading, page, totalPages, mediaType]);

  /** Infinite scroll via a sentinel at the end of the grid. */
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!site.browse.infiniteScroll) return undefined;

    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '600px' }, // start loading before the visitor hits the end
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="Nothing matches those filters"
        description="Try widening your search — remove a filter or pick a different year."
      />
    );
  }

  const hasMore = page < totalPages;

  return (
    <div className="space-y-8">
      <MediaGrid items={items} />

      {error && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted">
          <Icon name="alert-circle" size={15} />
          {error}
        </p>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-4">
          {loading ? (
            <span className="flex items-center gap-2 text-sm text-muted">
              <Icon name="loader" size={16} className="animate-spin" />
              Loading more…
            </span>
          ) : (
            <Button variant="secondary" onClick={loadMore}>
              Load more
            </Button>
          )}
        </div>
      )}

      {loading && items.length === 0 && <GridSkeleton />}
    </div>
  );
}
