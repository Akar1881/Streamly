import site from '@config/site';
import BrowsePage from '@/components/browse/BrowsePage';

export const metadata = {
  title: site.browse.tv.title,
  description: site.browse.tv.subtitle,
};

export default function TvPage() {
  return <BrowsePage mediaType="tv" />;
}
