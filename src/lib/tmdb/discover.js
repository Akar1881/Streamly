import site from '@config/site';
import { tmdbFetch } from './client';
import { normaliseMedia } from './normalise';
import { buildDiscoverParams } from './filters';

/**
 * Runs a browse query. Server-side only — the filter option lists and the
 * param mapping live in `./filters.js`, which Client Components import.
 *
 * Returns the normalised items plus paging info for infinite scroll.
 */
export async function discover(mediaType, filters = {}, page = 1) {
  const data = await tmdbFetch(`discover/${mediaType}`, {
    params: {
      ...buildDiscoverParams(mediaType, filters),
      page,
      region: site.tmdb.region,
    },
    revalidate: site.tmdb.revalidate.catalog,
  });

  return {
    items: (data.results ?? []).map((item) => normaliseMedia(item, mediaType)),
    page: data.page ?? page,
    totalPages: Math.min(data.total_pages ?? 1, 500), // TMDB caps paging at 500
    totalResults: data.total_results ?? 0,
  };
}
