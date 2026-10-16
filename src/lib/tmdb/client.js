import { unstable_cache } from 'next/cache';
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
  // Fail fast (outside the cache) when no credentials are configured.
  credentials();

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

  return cachedRequest(url.href, revalidate ?? site.tmdb.revalidate.catalog);
}

/**
 * Caches the response under the credential-free URL.
 *
 * The v3 key can only travel as an `api_key` query param, and Next's fetch
 * cache records each request's full URL in `.next/cache/fetch-cache` — which
 * is deployed with the build, putting the key in plain text in the output.
 * `unstable_cache` stores only the result, and fetches inside it bypass the
 * fetch cache, so the key is added here and never written anywhere.
 */
function cachedRequest(href, revalidate) {
  return unstable_cache(requestTmdb, ['tmdb'], { revalidate })(href);
}

async function requestTmdb(href) {
  const { token, key } = credentials();
  const url = new URL(href);

  if (!token) url.searchParams.set('api_key', key);

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new TmdbError(
      detail.status_message ?? `TMDB request failed for ${url.pathname}`,
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
