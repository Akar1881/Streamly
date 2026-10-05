import site from '@config/site';
import BrowsePage from '@/components/browse/BrowsePage';

export const metadata = {
  title: site.browse.movie.title,
  description: site.browse.movie.subtitle,
};

export default function MoviesPage() {
  return <BrowsePage mediaType="movie" />;
}
