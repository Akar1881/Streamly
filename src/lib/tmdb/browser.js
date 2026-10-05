'use client';

/**
 * Thin wrapper around the `/api/tmdb/...` proxy, for use in Client Components.
 * Server Components should import from `@/lib/tmdb/*` directly instead.
 */

export async function fetchTmdb(endpoint, params = {}, { signal } = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }

  const suffix = query.toString();
  const url = `/api/tmdb/${endpoint}${suffix ? `?${suffix}` : ''}`;

  const response = await fetch(url, { signal });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `Request failed (${response.status})`);
  }

  return response.json();
}
