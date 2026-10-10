import site from '@config/site';
import { discover } from '@/lib/tmdb/discover';
import { getCompanyName, getCountries, getGenres, getLanguages, getNetworkName } from '@/lib/tmdb/genres';
import { buildFilterChips, parseBrowseFilters } from '@/lib/tmdb/filters';
import BrowseResults from './BrowseResults';
import FilterBar from './FilterBar';
import EmptyState from '@/components/ui/EmptyState';

/**
 * Shared implementation of the /movies and /tv browse pages.
 *
 * The route files are thin wrappers around this so the two pages can never
 * drift apart — the only difference between them is `mediaType`.
 *
 * The filters live in the query string. They are parsed here, applied to the
 * first page of results on the server (so the grid is part of the HTML and
 * indexable), and handed to `FilterBar` and `BrowseResults` as plain props —
 * which is what lets both render correctly on the first paint.
 */
export default async function BrowsePage({ mediaType, searchParams }) {
  const config = site.browse[mediaType];
  const filters = parseBrowseFilters(await searchParams);

  // Lookup lists for the filter dialogs. Cached for a day, so this is cheap.
  const [genres, languages, countries] = await Promise.all([
    getGenres(mediaType),
    getLanguages(),
    getCountries(),
  ]);

  let results;

  try {
    results = await discover(mediaType, filters, 1);
  } catch (error) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <EmptyState
          icon="alert-circle"
          title="Could not load titles"
          description={`${error.message} — check TMDB_API_KEY in .env.local, then restart the dev server.`}
        />
      </div>
    );
  }

  // Chips and the selected-company list need names, so the ids in the URL are
  // resolved here — the browser has no way to look a company id up on its own.
  const companyNames = filters.company.length
    ? Object.fromEntries(
        await Promise.all(
          filters.company.map(async (id) => [id, (await getCompanyName(id)) ?? id]),
        ),
      )
    : {};

  const chips = buildFilterChips(filters, {
    genre: Object.fromEntries(genres.map((genre) => [String(genre.id), genre.name])),
    language: Object.fromEntries(languages.map((language) => [language.value, language.label])),
    country: Object.fromEntries(countries.map((country) => [country.value, country.label])),
    company: companyNames,
    network: filters.network
      ? { [filters.network]: (await getNetworkName(filters.network)) ?? filters.network }
      : {},
  });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{config.title}</h1>
        <p className="mt-1 text-sm text-muted">{config.subtitle}</p>
      </header>

      <FilterBar
        mediaType={mediaType}
        filters={filters}
        chips={chips}
        genres={genres}
        languages={languages}
        countries={countries}
        companyNames={companyNames}
      />

      <BrowseResults
        mediaType={mediaType}
        filters={filters}
        initialItems={results.items}
        initialTotalPages={results.totalPages}
      />
    </div>
  );
}
