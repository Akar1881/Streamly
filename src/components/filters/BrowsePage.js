import site from '@config/site';
import { discover } from '@/lib/tmdb/discover';
import { getGenres, getLanguages } from '@/lib/tmdb/genres';
import FilterBar from '@/components/filters/FilterBar';
import BrowseResults from '@/components/filters/BrowseResults';
import EmptyState from '@/components/ui/EmptyState';

/**
 * Shared implementation of the /movies and /tv browse pages.
 *
 * The route files are thin wrappers around this so the two pages can never
 * drift apart — the only difference between them is `mediaType`, and which
 * filter controls the config enables.
 */
export default async function BrowsePage({ mediaType, searchParams }) {
  const config = site.browse[mediaType];
  const filters = await searchParams;

  let results;
  let genres = [];
  let languages = [];

  try {
    [results, genres, languages] = await Promise.all([
      discover(mediaType, filters, 1),
      getGenres(mediaType),
      // Loaded here rather than in the browser: it is one cached request, and
      // it saves the Language filter from having to fetch on first open.
      getLanguages(),
    ]);
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

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{config.title}</h1>
        <p className="mt-1 text-sm text-muted">{config.subtitle}</p>
      </header>

      <FilterBar mediaType={mediaType} genres={genres} languages={languages} />

      {/* `key` forces a fresh component when the filters change, so the result
          list resets instead of appending to the previous query's items. */}
      <BrowseResults
        key={JSON.stringify(filters)}
        mediaType={mediaType}
        initialItems={results.items}
        initialTotalPages={results.totalPages}
      />
    </div>
  );
}
