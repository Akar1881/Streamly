import site from '@config/site';
import { discover } from '@/lib/tmdb/discover';
import BrowseResults from './BrowseResults';
import EmptyState from '@/components/ui/EmptyState';

/**
 * Shared implementation of the /movies and /tv browse pages.
 *
 * The route files are thin wrappers around this so the two pages can never
 * drift apart — the only difference between them is `mediaType`.
 *
 * The first page is fetched here on the server, so the grid is part of the HTML
 * and indexable. `BrowseResults` takes over from there and appends pages as the
 * visitor scrolls.
 */
export default async function BrowsePage({ mediaType }) {
  const config = site.browse[mediaType];

  let results;

  try {
    results = await discover(mediaType, {}, 1);
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
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{config.title}</h1>
        <p className="mt-1 text-sm text-muted">{config.subtitle}</p>
      </header>

      <BrowseResults
        mediaType={mediaType}
        initialItems={results.items}
        initialTotalPages={results.totalPages}
      />
    </div>
  );
}
