'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import site from '@config/site';
import { buildDiscoverParams, countActiveFilters } from '@/lib/tmdb/filters';
import { fetchTmdb } from '@/lib/tmdb/browser';
import { normaliseMedia } from '@/lib/tmdb/normalise';
import MediaGrid from '@/components/media/MediaGrid';
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
 *  the page is useful immediately and indexable. Every page after that is
 *  fetched in the browser as the visitor scrolls, and appended if it has not
 *  been seen already.
 * ============================================================================
 */
export default function BrowseResults({ mediaType, filters = {}, initialItems, initialTotalPages }) {
  const [items, setItems] = useState(initialItems);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /** A fresh first page arrived from the server — start over. */
  useEffect(() => {
    setItems(initialItems);
    setTotalPages(initialTotalPages);
    setPage(1);
    setError(null);
  }, [initialItems, initialTotalPages]);

  const loadMore = useCallback(async () => {
    if (loading || page >= totalPages) return;

    const nextPage = page + 1;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchTmdb(`discover/${mediaType}`, {
        ...buildDiscoverParams(mediaType, filters),
        page: nextPage,
        language: site.tmdb.language,
        include_adult: site.tmdb.includeAdult,
      });

      const fresh = (data.results ?? []).map((item) => normaliseMedia(item, mediaType));

      setItems((current) => {
        // TMDB can repeat a title across pages; de-duplicate by id.
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...fresh.filter((item) => !seen.has(item.id))];
      });

      setPage(nextPage);
      // TMDB reports thousands of pages for a broad query; nobody scrolls that
      // far and the deep pages get slower, so stop well before the end.
      setTotalPages(Math.min(data.total_pages ?? nextPage, 500));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [loading, page, totalPages, mediaType, filters]);

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
    const filtered = countActiveFilters(filters) > 0;

    return (
      <EmptyState
        icon="search"
        title={filtered ? 'No titles match these filters' : 'Nothing to show yet'}
        description={
          filtered
            ? 'Try widening the year or rating range, or clearing a filter or two.'
            : 'TMDB returned no titles for this page. Try reloading in a moment.'
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <MediaGrid items={items} />

      {error && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted">
          <Icon name="alert-circle" size={15} />
          {error}
        </p>
      )}

      {page < totalPages && (
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
    </div>
  );
}
