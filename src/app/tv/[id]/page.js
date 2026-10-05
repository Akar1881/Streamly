import { notFound } from 'next/navigation';
import site from '@config/site';
import { getShow, getUpcomingEpisodes } from '@/lib/tmdb/tv';
import { parseId } from '@/lib/format';
import DetailHero from '@/components/detail/DetailHero';
import DetailTabs, { ImageGallery, VideoGrid } from '@/components/detail/DetailTabs';
import Overview from '@/components/detail/Overview';
import SeasonSection from '@/components/detail/SeasonSection';
import CreditsSection from '@/components/detail/CreditsSection';
import ReviewsPanel from '@/components/detail/ReviewsPanel';
import MediaRow from '@/components/media/MediaRow';

export const revalidate = 21600;

async function load(params) {
  const { id } = await params;
  const tmdbId = parseId(id);
  if (!tmdbId) notFound();

  try {
    return await getShow(tmdbId);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }) {
  const show = await load(params);

  return {
    title: show.title,
    description: show.overview || site.seo.description,
    // No `images` here on purpose — `opengraph-image.js` in this folder draws
    // the share card, and an explicit entry would override it.
    openGraph: {
      type: 'video.tv_show',
      siteName: site.brand.name,
      title: show.title,
      description: show.overview || site.seo.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: show.title,
      description: show.overview || site.seo.description,
    },
  };
}

export default async function TvDetailPage({ params }) {
  const show = await load(params);

  // Non-essential: a dead season endpoint must not blank the whole page.
  const upcoming = await getUpcomingEpisodes(show).catch(() => []);

  const tabs = [
    { id: 'overview', label: 'Overview', content: <Overview media={show} /> },
    {
      id: 'images',
      label: 'Images',
      available: site.detail.showImages && show.images.backdrops.length > 0,
      content: <ImageGallery images={show.images.backdrops} aspect="video" />,
    },
    {
      id: 'videos',
      label: 'Videos',
      available: site.detail.showVideos && show.videos.length > 0,
      content: <VideoGrid videos={show.videos} />,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <DetailHero media={show} />

      {show.seasons.length > 0 && <SeasonSection show={show} upcoming={upcoming} />}

      <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <DetailTabs tabs={tabs} />

        {site.detail.showReviews && (
          <aside className="lg:pt-8">
            <ReviewsPanel reviews={show.reviews} title={show.title} />
          </aside>
        )}
      </div>

      <CreditsSection cast={show.cast} crew={show.crew} />

      {site.detail.showRelated && show.related.length > 0 && (
        <div className="mt-10">
          <MediaRow title="Related shows" items={show.related} />
        </div>
      )}
    </div>
  );
}
