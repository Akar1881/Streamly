import site from '@config/site';
import BrowsePage from '@/components/browse/BrowsePage';

export const metadata = {
  title: site.browse.tv.title,
  description: site.browse.tv.subtitle,
  // See the matching note in `../movies/page.js` — filters live in the query
  // string, so every filtered view points back at the one canonical URL.
  alternates: { canonical: '/tv' },
};

export default function TvPage() {
  return <BrowsePage mediaType="tv" />;
}
