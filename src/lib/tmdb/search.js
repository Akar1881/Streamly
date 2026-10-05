import site from '@config/site';
import { tmdbFetch } from './client';
import { normaliseMedia } from './normalise';

/**
 * Global search.
 *
 * `search/multi` returns movies, shows and people mixed together, which is what
 * the "All" tab shows. The other tabs hit the type-specific endpoints so that
 * paging works per tab.
 */

const ENDPOINTS = {
  all: 'search/multi',
  movie: 'search/movie',
  tv: 'search/tv',
  person: 'search/person',
};

export const SEARCH_TABS = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV Shows' },
  { value: 'person', label: 'People' },
];

export async function search(query, { type = 'all', page = 1 } = {}) {
  const trimmed = query?.trim();
  if (!trimmed) {
    return { items: [], page: 1, totalPages: 0, totalResults: 0 };
  }

  const data = await tmdbFetch(ENDPOINTS[type] ?? ENDPOINTS.all, {
    params: { query: trimmed, page },
    revalidate: site.tmdb.revalidate.search,
  });

  return {
    items: (data.results ?? [])
      .map((item) => shapeResult(item, type))
      .filter(Boolean)
      // People with no photo are usually crew stubs; they look broken in a grid.
      .filter((item) => item.mediaType !== 'person' || item.profilePath),
    page: data.page ?? page,
    totalPages: Math.min(data.total_pages ?? 1, 500),
    totalResults: data.total_results ?? 0,
  };
}

function shapeResult(item, requestedType) {
  const mediaType =
    item.media_type ?? (requestedType === 'all' ? null : requestedType);

  if (mediaType === 'person') {
    return {
      id: item.id,
      mediaType: 'person',
      name: item.name,
      profilePath: item.profile_path,
      knownFor: item.known_for_department,
    };
  }

  if (mediaType === 'movie' || mediaType === 'tv') {
    return normaliseMedia(item, mediaType);
  }

  return null; // collections and other stray types
}

/**
 * Lighter call used by the header's type-ahead dropdown — fewer results, no
 * paging, and it never throws so a flaky keystroke cannot break the input.
 */
export async function quickSearch(query, limit = 7) {
  try {
    const { items } = await search(query, { type: 'all' });
    return items.slice(0, limit);
  } catch {
    return [];
  }
}
