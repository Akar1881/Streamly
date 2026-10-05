import site from '@config/site';
import { getHomeFeeds } from '@/lib/tmdb/catalog';
import HeroCarousel from '@/components/media/HeroCarousel';
import MediaRow from '@/components/media/MediaRow';
import ContinueWatching from '@/components/media/ContinueWatching';
import EmptyState from '@/components/ui/EmptyState';

/** Home is regenerated at most once per `tmdb.revalidate.catalog` seconds. */
export const revalidate = 3600;

export default async function HomePage() {
  let feeds;

  try {
    feeds = await getHomeFeeds();
  } catch (error) {
    // The overwhelmingly common cause is a missing or invalid TMDB key.
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <EmptyState
          icon="alert-circle"
          title="Could not load content"
          description={`${error.message} — check TMDB_API_KEY in .env.local, then restart the dev server.`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-10 px-4 py-6 sm:px-6 lg:px-8">
      <HeroCarousel items={feeds.hero} />

      {site.features.continueWatching && <ContinueWatching />}

      {feeds.rows.map((row, index) => (
        <MediaRow
          key={row.title}
          title={row.title}
          items={row.items}
          priority={index === 0}
        />
      ))}
    </div>
  );
}
