import site from '@config/site';
import BrowsePage from '@/components/browse/BrowsePage';

export const metadata = {
  title: site.browse.movie.title,
  description: site.browse.movie.subtitle,
  // Filtering happens through the query string, so `/movies?genre=18&year=1999`
  // and a dozen near-identical variants all render the same page. Pointing them
  // at the bare path keeps the ranking on one URL instead of splitting it.
  alternates: { canonical: '/movies' },
};

export default function MoviesPage() {
  return <BrowsePage mediaType="movie" />;
}
