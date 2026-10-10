import site from '@config/site';

/**
 * ============================================================================
 *  BROWSE FILTERS
 * ============================================================================
 *  Everything the /movies and /tv filter UI needs, as pure data and pure
 *  functions. No server imports — `discover.js` (server) and the filter
 *  components (browser) both import this, and they must agree exactly on what a
 *  filter means.
 *
 *  Filters travel in the query string, so a filtered view is shareable, the
 *  server can render the first page from it, and the back button walks through
 *  filter changes. The mapping is:
 *
 *    URL                TMDB (discover/movie | discover/tv)
 *    sort               sort_by
 *    genre=28,35        with_genres        (comma = any of)
 *    without=27         without_genres
 *    yearFrom/To        primary_release_date.gte/.lte  (first_air_date for tv)
 *    ratingFrom/To      vote_average.gte/.lte
 *    runtimeFrom/To     with_runtime.gte/.lte
 *    language           with_original_language
 *    country            with_origin_country
 *    company            with_companies     (comma = any of)
 *    network            with_networks      (tv only)
 * ============================================================================
 */

/** A short list of well-known networks, so a network id can be named without a lookup. */
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

/**
 * The major studios shown before the visitor types anything. TMDB has no
 * "list every company" endpoint, so a company is normally found by search —
 * but an empty box is a poor starting point, so these seed the list.
 */
export const POPULAR_COMPANIES = [
  { value: '41077', label: 'A24 (US)' },
  { value: '2', label: 'Walt Disney Pictures (US)' },
  { value: '174', label: 'Warner Bros. Pictures (US)' },
  { value: '33', label: 'Universal Pictures (US)' },
  { value: '4', label: 'Paramount (US)' },
  { value: '25', label: '20th Century Studios (US)' },
  { value: '420', label: 'Marvel Studios (US)' },
  { value: '5', label: 'Columbia Pictures (US)' },
];

/** Sort choices, in the order the "Sort By" dialog lists them. */
const ALL_SORTS = [
  { value: 'popularity.desc', label: 'Popularity' },
  { value: 'vote_average.desc', label: 'Rating' },
  { value: 'primary_release_date.desc', label: 'Release Date (Newest)' },
  { value: 'primary_release_date.asc', label: 'Release Date (Oldest)' },
  { value: 'revenue.desc', label: 'Revenue' },
  { value: 'vote_count.desc', label: 'Vote Count' },
  { value: 'title.asc', label: 'Title (A-Z)' },
];

/** TMDB uses different field names for the date and title sorts on TV. */
const TV_SORT_ALIASES = {
  'primary_release_date.desc': 'first_air_date.desc',
  'primary_release_date.asc': 'first_air_date.asc',
  'title.asc': 'name.asc',
  'revenue.desc': 'popularity.desc', // revenue is not tracked for shows
};

/** Revenue is not reported for TV, so the option is dropped rather than lying. */
export function sortOptions(mediaType) {
  if (mediaType !== 'tv') return ALL_SORTS;
  return ALL_SORTS.filter((option) => option.value !== 'revenue.desc');
}

/** Row-length presets offered above the runtime slider. */
export const RUNTIME_PRESETS = [
  { id: 'short', label: 'Under 90m', from: 1, to: 90 },
  { id: 'medium', label: '90-150m', from: 90, to: 150 },
  { id: 'long', label: '150m+', from: 150, to: 600 },
];

/** Bounds for every range control. Kept here so the UI and the query agree. */
export const BOUNDS = {
  year: { min: 1900, max: new Date().getFullYear() },
  rating: { min: 0, max: 10, step: 0.5, marks: [0, 5, 10] },
  runtime: { min: 1, max: 600, step: 10, marks: [1, 120, 240, 600] },
};

/**
 * A range at its full extent means "no constraint", so a filter that only
 * touches the ends is dropped instead of being sent as a limit.
 */
const DEFAULTS = {
  year: (from, to) =>
    (from === '' || Number(from) <= BOUNDS.year.min) &&
    (to === '' || Number(to) >= BOUNDS.year.max),
  rating: (from, to) =>
    (from === '' || Number(from) <= BOUNDS.rating.min) &&
    (to === '' || Number(to) >= BOUNDS.rating.max),
  runtime: (from, to) =>
    (from === '' || Number(from) <= BOUNDS.runtime.min) &&
    (to === '' || Number(to) >= BOUNDS.runtime.max),
};

/** The three ranges, and the URL keys that hold each end. */
export const RANGE_KEYS = {
  year: ['yearFrom', 'yearTo'],
  rating: ['ratingFrom', 'ratingTo'],
  runtime: ['runtimeFrom', 'runtimeTo'],
};

/** Every URL key a filter can occupy, in a stable order. */
export const FILTER_KEYS = [
  'sort',
  'genre',
  'without',
  'yearFrom',
  'yearTo',
  'ratingFrom',
  'ratingTo',
  'runtimeFrom',
  'runtimeTo',
  'language',
  'country',
  'company',
  'network',
];

/** Keys that hold a list of ids rather than a single value. */
const LIST_KEYS = new Set(['genre', 'without', 'company']);

/** The filter state with nothing selected. */
export function emptyFilters() {
  return {
    sort: '',
    genre: [],
    without: [],
    yearFrom: '',
    yearTo: '',
    ratingFrom: '',
    ratingTo: '',
    runtimeFrom: '',
    runtimeTo: '',
    language: '',
    country: '',
    company: [],
    network: '',
  };
}

const split = (value) =>
  String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * Reads the query string into a filter object. Accepts Next's `searchParams`
 * (strings, or arrays for a repeated key) so the page can hand it straight over.
 */
export function parseBrowseFilters(searchParams = {}) {
  const pick = (key) => {
    const value = searchParams[key];
    return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  };

  const filters = emptyFilters();
  for (const key of FILTER_KEYS) {
    if (LIST_KEYS.has(key)) filters[key] = split(pick(key));
    else filters[key] = String(pick(key));
  }
  return filters;
}

/**
 * Drops anything at its default, so "everything selected" never reaches the
 * URL — that keeps a filtered view equal to the plain one.
 */
export function compactFilters(filters) {
  const clean = { ...filters };
  for (const [name, keys] of Object.entries(RANGE_KEYS)) {
    const [fromKey, toKey] = keys;
    if (DEFAULTS[name](clean[fromKey], clean[toKey])) {
      clean[fromKey] = '';
      clean[toKey] = '';
    }
  }
  return clean;
}

/** Turns a filter object back into a query string. */
export function serialiseBrowseFilters(filters) {
  const clean = compactFilters(filters);
  const params = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    const value = clean[key];
    if (LIST_KEYS.has(key)) {
      if (value.length) params.set(key, value.join(','));
    } else if (value !== '' && value != null) {
      params.set(key, String(value));
    }
  }
  return params;
}

/** How many facets are active — the badge on the "All Filters" button. */
export function countActiveFilters(filters) {
  let count = 0;
  for (const key of FILTER_KEYS) {
    if (key === 'sort') continue; // the default ordering is not a filter
    const value = filters[key];
    if (LIST_KEYS.has(key) ? value.length : value !== '' && value != null) count += 1;
  }
  return count;
}

/**
 * Flattens the active filters into removable chips, each carrying the URL keys
 * that clearing it must drop (and, for a list, the one value it removes).
 *
 * @param {object} filters
 * @param {object} labels  id -> name maps, keyed by filter name
 */
export function buildFilterChips(filters, labels = {}) {
  const name = (kind, id) => labels[kind]?.[id] ?? id;
  const chips = [];

  for (const id of filters.genre) {
    chips.push({ id: `genre:${id}`, label: `Genre: ${name('genre', id)}`, keys: ['genre'], value: id });
  }
  for (const id of filters.without) {
    chips.push({ id: `without:${id}`, label: `Not: ${name('genre', id)}`, keys: ['without'], value: id });
  }
  if (filters.yearFrom || filters.yearTo) {
    chips.push({ id: 'year', label: `Year: ${rangeLabel(filters.yearFrom, filters.yearTo, BOUNDS.year)}`, keys: RANGE_KEYS.year });
  }
  if (filters.ratingFrom || filters.ratingTo) {
    chips.push({ id: 'rating', label: `Rating: ${rangeLabel(filters.ratingFrom, filters.ratingTo, BOUNDS.rating)}`, keys: RANGE_KEYS.rating });
  }
  if (filters.runtimeFrom || filters.runtimeTo) {
    chips.push({ id: 'runtime', label: `Runtime: ${rangeLabel(filters.runtimeFrom, filters.runtimeTo, BOUNDS.runtime)}m`, keys: RANGE_KEYS.runtime });
  }
  if (filters.language) {
    chips.push({ id: 'language', label: `Lang: ${name('language', filters.language)}`, keys: ['language'] });
  }
  if (filters.country) {
    chips.push({ id: 'country', label: `Country: ${name('country', filters.country)}`, keys: ['country'] });
  }
  for (const id of filters.company) {
    chips.push({ id: `company:${id}`, label: `Company: ${name('company', id)}`, keys: ['company'], value: id });
  }
  if (filters.network) {
    chips.push({ id: 'network', label: `Network: ${name('network', filters.network)}`, keys: ['network'] });
  }
  return chips;
}

function rangeLabel(from, to, bounds) {
  const start = from === '' || Number(from) <= bounds.min ? '' : from;
  const end = to === '' || Number(to) >= bounds.max ? '' : to;
  if (start && end) return `${start}–${end}`;
  if (start) return `${start}+`;
  return `up to ${end}`;
}

/**
 * Maps a filter object onto TMDB's `discover` params.
 *
 * Ranges are guarded a second time here: a bound sitting on the minimum or
 * maximum is not sent, so a slider left untouched never narrows the query.
 */
export function buildDiscoverParams(mediaType, filters = {}) {
  const isTv = mediaType === 'tv';
  const params = {};

  // --- sort ---------------------------------------------------------------
  const sort = filters.sort || site.browse.defaultSort;
  params.sort_by = isTv ? (TV_SORT_ALIASES[sort] ?? sort) : sort;

  // --- genres (TMDB accepts a comma-separated list) ------------------------
  if (filters.genre?.length) params.with_genres = filters.genre.join(',');
  if (filters.without?.length) params.without_genres = filters.without.join(',');

  // --- release year --------------------------------------------------------
  if (!DEFAULTS.year(filters.yearFrom, filters.yearTo)) {
    const field = isTv ? 'first_air_date' : 'primary_release_date';
    if (filters.yearFrom && Number(filters.yearFrom) > BOUNDS.year.min) {
      params[`${field}.gte`] = `${filters.yearFrom}-01-01`;
    }
    if (filters.yearTo && Number(filters.yearTo) < BOUNDS.year.max) {
      params[`${field}.lte`] = `${filters.yearTo}-12-31`;
    }
  }

  // --- rating --------------------------------------------------------------
  if (!DEFAULTS.rating(filters.ratingFrom, filters.ratingTo)) {
    if (filters.ratingFrom && Number(filters.ratingFrom) > BOUNDS.rating.min) {
      params['vote_average.gte'] = filters.ratingFrom;
      // Without a vote floor, obscure titles with two 10/10 votes dominate.
      params['vote_count.gte'] = 100;
    }
    if (filters.ratingTo && Number(filters.ratingTo) < BOUNDS.rating.max) {
      params['vote_average.lte'] = filters.ratingTo;
    }
  }

  // --- runtime (minutes) ---------------------------------------------------
  if (!DEFAULTS.runtime(filters.runtimeFrom, filters.runtimeTo)) {
    if (filters.runtimeFrom && Number(filters.runtimeFrom) > BOUNDS.runtime.min) {
      params['with_runtime.gte'] = filters.runtimeFrom;
    }
    if (filters.runtimeTo && Number(filters.runtimeTo) < BOUNDS.runtime.max) {
      params['with_runtime.lte'] = filters.runtimeTo;
    }
  }

  // --- language, country, company, network ---------------------------------
  if (filters.language) params.with_original_language = filters.language;
  if (filters.country) params.with_origin_country = filters.country;
  if (filters.company?.length) params.with_companies = filters.company.join(',');
  if (isTv && filters.network) params.with_networks = filters.network;

  return params;
}
