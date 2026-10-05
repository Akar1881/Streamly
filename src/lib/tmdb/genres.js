import { tmdbFetchSafe } from './client';
import { POPULAR_NETWORKS } from './filters';

/**
 * Lookup lists that populate the filter dropdowns. These change rarely, so
 * they are cached for a day.
 */

const DAY = 86400;

/** Genre list for one media type: [{ id, name }] */
export async function getGenres(mediaType) {
  const data = await tmdbFetchSafe(
    `genre/${mediaType}/list`,
    { revalidate: DAY },
    { genres: [] },
  );
  return data.genres ?? [];
}

/** Maps genre ids to names, for cards that only receive `genre_ids`. */
export async function getGenreMap(mediaType) {
  const genres = await getGenres(mediaType);
  return new Map(genres.map((genre) => [genre.id, genre.name]));
}

/**
 * Spoken languages TMDB knows about, sorted by English name.
 * Shape: [{ value: 'en', label: 'English' }]
 */
export async function getLanguages() {
  const data = await tmdbFetchSafe('configuration/languages', { revalidate: DAY }, []);
  return (data ?? [])
    .filter((language) => language.english_name)
    .map((language) => ({ value: language.iso_639_1, label: language.english_name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Production companies and TV networks have no "list all" endpoint, so these
 * are searched on demand as the user types in the filter.
 */
export async function searchCompanies(query) {
  if (!query) return [];
  const data = await tmdbFetchSafe(
    'search/company',
    { params: { query }, revalidate: DAY },
    { results: [] },
  );
  return (data.results ?? [])
    .slice(0, 20)
    .map((company) => ({ value: String(company.id), label: company.name }));
}

/** Resolves a company or network id to its name, for the active-filter chips. */
export async function getNetworkName(id) {
  const known = POPULAR_NETWORKS.find((network) => network.value === String(id));
  if (known) return known.label;
  const data = await tmdbFetchSafe(`network/${id}`, { revalidate: DAY }, null);
  return data?.name ?? null;
}

export async function getCompanyName(id) {
  const data = await tmdbFetchSafe(`company/${id}`, { revalidate: DAY }, null);
  return data?.name ?? null;
}
