import { notFound } from 'next/navigation';
import site from '@config/site';
import { getCollection, getMovie } from '@/lib/tmdb/movies';
import { parseId } from '@/lib/format';
import DetailHero from '@/components/detail/DetailHero';
import DetailTabs, { CollectionPanel, ImageGallery, VideoGrid } from '@/components/detail/DetailTabs';
import Overview from '@/components/detail/Overview';
import CreditsSection from '@/components/detail/CreditsSection';
import ReviewsPanel from '@/components/detail/ReviewsPanel';
import MediaRow from '@/components/media/MediaRow';

export const revalidate = 21600;

/** `id` arrives as "550-fight-club"; only the leading number matters. */
async function load(params) {
  const { id } = await params;
  const tmdbId = parseId(id);
  if (!tmdbId) notFound();

  try {
    return await getMovie(tmdbId);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }) {
  const movie = await load(params);

  return {
    title: movie.title,
    description: movie.overview || site.seo.description,
    // No `images` here on purpose — `opengraph-image.js` in this folder draws
    // the share card, and an explicit entry would override it.
    openGraph: {
      type: 'video.movie',
      siteName: site.brand.name,
      title: movie.title,
      description: movie.overview || site.seo.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: movie.title,
      description: movie.overview || site.seo.description,
    },
  };
}

export default async function MovieDetailPage({ params }) {
  const movie = await load(params);

  // Only fetched when the film actually belongs to a franchise.
  const collection = movie.collection
    ? await getCollection(movie.collection.id).catch(() => null)
    : null;

  const tabs = [
    { id: 'overview', label: 'Overview', content: <Overview media={movie} /> },
    {
      id: 'images',
      label: 'Images',
      available: site.detail.showImages && movie.images.backdrops.length > 0,
      content: <ImageGallery images={movie.images.backdrops} aspect="video" />,
    },
    {
      id: 'videos',
      label: 'Videos',
      available: site.detail.showVideos && movie.videos.length > 0,
      content: <VideoGrid videos={movie.videos} />,
    },
    {
      id: 'collection',
      label: 'Collection',
      available: Boolean(collection),
      content: <CollectionPanel collection={collection} />,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <DetailHero media={movie} />

      {/* Main column + reviews rail, stacking on narrow screens. */}
      <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <DetailTabs tabs={tabs} />

        {site.detail.showReviews && (
          <aside className="lg:pt-8">
            <ReviewsPanel reviews={movie.reviews} title={movie.title} />
          </aside>
        )}
      </div>

      <CreditsSection cast={movie.cast} crew={movie.crew} />

      {site.detail.showRelated && movie.related.length > 0 && (
        <div className="mt-10">
          <MediaRow title="Related movies" items={movie.related} />
        </div>
      )}
    </div>
  );
}
