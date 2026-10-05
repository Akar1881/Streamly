import site from '@config/site';
import { getMovie } from '@/lib/tmdb/movies';
import { parseId } from '@/lib/format';
import { OG_SIZE, ticketImage } from '@/lib/og/cards';

/**
 * The share card for a movie. Its mere existence in this route makes Next.js
 * advertise it in the page's `og:image` / `twitter:image` tags, so a link pasted
 * into a chat app renders the ticket drawn in `src/lib/og/cards.jsx`.
 *
 * The file convention wins over `openGraph.images` in the page's metadata, which
 * is why that page sets no image of its own.
 */
export const alt = 'Movie details';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const revalidate = 21600;

export default async function Image({ params }) {
  const { id } = await params;
  const tmdbId = parseId(id);

  try {
    return ticketImage(await getMovie(tmdbId));
  } catch {
    // A failed lookup should still produce a valid card rather than a broken
    // image in someone else's timeline.
    return ticketImage({ id: tmdbId ?? 0, mediaType: 'movie', title: site.brand.name });
  }
}
