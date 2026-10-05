import { OG_SIZE, bannerImage } from '@/lib/og/cards';

/**
 * The default share card, inherited by every route that does not provide its
 * own. Detail pages override it with their own `opengraph-image.js`, which
 * draws the per-title ticket.
 *
 * It is generated rather than a static file in `/public` so the brand name,
 * tagline and description in `config/site.js` flow straight into it.
 */
export const alt = 'Home';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return bannerImage();
}
