import site from '@config/site';
import { getShow } from '@/lib/tmdb/tv';
import { parseId } from '@/lib/format';
import { OG_SIZE, ticketImage } from '@/lib/og/cards';

/**
 * The share card for a TV show. See the movie route for the full explanation.
 */
export const alt = 'TV show details';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 21600;

export default async function Image({ params }) {
  const { id } = await params;
  const tmdbId = parseId(id);

  try {
    return ticketImage(await getShow(tmdbId));
  } catch {
    return ticketImage({ id: tmdbId ?? 0, mediaType: 'tv', title: site.brand.name });
  }
}
