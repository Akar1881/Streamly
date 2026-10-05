import site from '@config/site';

/**
 * ============================================================================
 *  TMDB CLIENT  (server-side only)
 * ============================================================================
 *
 *  Every call to TMDB goes through `tmdbFetch`. The API credentials are read
 *  from the environment here and never leave the server:
 *
 *    - Server Components import these helpers directly.
 *    - Client Components call `/api/tmdb/...`, which proxies to this file.
 *
 *  Never import this module from a file marked `'use client'`.
 * ============================================================================
 */

const BASE_URL = 'https://api.themoviedb.org/3';

export class TmdbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
  }
}

/** v4 bearer token wins if both are present; either one works alone. */
function credentials() {
  const token = process.env.TMDB_ACCESS_TOKEN?.trim();
  const key = process.env.TMDB_API_KEY?.trim();

  if (!token && !key) {
    throw new TmdbError(
      'No TMDB credentials. Copy .env.example to .env.local and set TMDB_API_KEY.',
      500,
    );
  }
  return { token, key };
}

/**
 * Fetches a TMDB endpoint.
 *
 * @param {string} path        e.g. 'movie/550' or 'discover/tv'
 * @param {object} [options]
 * @param {object} [options.params]      query params; undefined/null are dropped
 * @param {number} [options.revalidate]  cache lifetime in seconds
 */
export async function tmdbFetch(path, { params = {}, revalidate } = {}) {
  const { token, key } = credentials();

  const url = new URL(`${BASE_URL}/${String(path).replace(/^\/+/, '')}`);

  // Sensible defaults every endpoint accepts, overridable per call.
  const merged = {
    language: site.tmdb.language,
    include_adult: site.tmdb.includeAdult,
    ...params,
  };

  for (const [name, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(name, String(value));
  }

  if (!token) url.searchParams.set('api_key', key);

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    next: { revalidate: revalidate ?? site.tmdb.revalidate.catalog },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new TmdbError(
      detail.status_message ?? `TMDB request failed for /${path}`,
      response.status,
    );
  }

  return response.json();
}

/**
 * Same as `tmdbFetch` but resolves to `fallback` instead of throwing. Use for
 * non-essential sections so one dead endpoint cannot blank a whole page.
 */
export async function tmdbFetchSafe(path, options, fallback = null) {
  try {
    return await tmdbFetch(path, options);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[tmdb] ${path}: ${error.message}`);
    }
    return fallback;
  }
}
