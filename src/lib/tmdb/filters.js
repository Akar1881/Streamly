import site from '@config/site';

/**
 * ============================================================================
 *  BROWSE PARAMS
 * ============================================================================
 *  The mapping from our own browsing options onto TMDB's `discover`
 *  parameters, plus a short list of well-known network ids.
 *
 *  Pure data and pure functions only — no server imports — because both
 *  `discover.js` on the server and `BrowseResults` in the browser need this.
 * ============================================================================
 */

/**
 * A short list of well-known networks, so a network id can be recognised
 * without asking TMDB for its name.
 */
export const POPULAR_NETWORKS = [
  { value: '213', label: 'Netflix' },
  { value: '1024', label: 'Prime Video' },
  { value: '2552', label: 'Apple TV+' },
  { value: '49', label: 'HBO' },
  { value: '2739', label: 'Disney+' },
  { value: '453', label: 'Hulu' },
  { value: '67', label: 'Showtime' },
  { value: '6', label: 'NBC' },
  { value: '2', label: 'ABC' },
  { value: '16', label: 'CBS' },
  { value: '19', label: 'FOX' },
  { value: '318', label: 'Starz' },
  { value: '174', label: 'AMC' },
  { value: '4', label: 'BBC One' },
];

/** TV uses different field names for the date and title sorts. */
const TV_SORT_ALIASES = {
  'primary_release_date.desc': 'first_air_date.desc',
  'primary_release_date.asc': 'first_air_date.asc',
  'title.asc': 'name.asc',
  'revenue.desc': 'popularity.desc', // revenue is not tracked for shows
};

/**
 * Maps browsing options onto TMDB's discover params.
 *
 * The browse pages currently pass an empty object, which leaves the query
 * ordered by `site.browse.defaultSort`. Every branch below is still honoured,
 * so narrowing by genre, year, rating, runtime, language, company or network is
 * a matter of supplying the params — the query side needs no changes.
 *
 * @param {'movie'|'tv'} mediaType
 * @param {object} filters  e.g. { genre: '28', year: '1999', rating: '8' }
 */
export function buildDiscoverParams(mediaType, filters = {}) {
  const isTv = mediaType === 'tv';
  const params = {};

  // --- sort ---------------------------------------------------------------
  const sort = filters.sort || site.browse.defaultSort;
  params.sort_by = isTv ? (TV_SORT_ALIASES[sort] ?? sort) : sort;

  // --- genre (TMDB accepts a comma-separated list) -------------------------
  if (filters.genre) params.with_genres = filters.genre;

  // --- year ---------------------------------------------------------------
  if (filters.year) {
    if (isTv) params.first_air_date_year = filters.year;
    else params.primary_release_year = filters.year;
  }

  // --- minimum rating -----------------------------------------------------
  if (filters.rating) {
    params['vote_average.gte'] = filters.rating;
    // Without a vote floor, obscure titles with two 10/10 votes dominate.
    params['vote_count.gte'] = 100;
  }

  // --- runtime bucket, e.g. "90-120" or "180-" ----------------------------
  if (filters.runtime) {
    const [min, max] = String(filters.runtime).split('-');
    if (min) params['with_runtime.gte'] = min;
    if (max) params['with_runtime.lte'] = max;
  }

  // --- original language, company, network --------------------------------
  if (filters.language) params.with_original_language = filters.language;
  if (filters.company) params.with_companies = filters.company;
  if (isTv && filters.network) params.with_networks = filters.network;

  return params;
}
