import { getFeed } from '@/lib/tmdb/catalog';
import { toSlugId } from '@/lib/format';

/**
 * ============================================================================
 *  SITEMAP
 * ============================================================================
 *
 *  Tells search engines which pages exist, so titles are found by being listed
 *  rather than by a crawler happening to follow a link to them.
 *
 *  Two groups:
 *
 *    the fixed pages        — home, the two browse pages, settings
 *    popular titles         — pulled from the same TMDB feeds the home page
 *                             already loads, and cached exactly the same way
 *
 *  The watch pages (`/watch/…`) are deliberately absent. They carry `noindex`
 *  for their own reasons — see `robots.js` — and listing a page you are asking
 *  not to index is a contradiction a crawler has to resolve.
 *
 *  No `lastModified` anywhere: TMDB exposes no modification date for a title,
 *  and stamping everything with the build time would be a claim that every page
 *  changed at once, every time. A field that is always wrong is worse than an
 *  absent one.
 * ============================================================================
 */

/**
 * Refreshed daily rather than frozen at build time, so newly popular titles
 * enter the sitemap without needing a deploy.
 */
export const revalidate = 86400;

/**
 * The feeds the sitemap advertises. Kept to four so a regeneration costs four
 * TMDB requests, all of which are the same cached feeds the home page uses.
 */
const FEEDS = ['movie_popular', 'movie_top_rated', 'tv_popular', 'tv_top_rated'];

const STATIC_PAGES = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/movies', changeFrequency: 'daily', priority: 0.9 },
  { path: '/tv', changeFrequency: 'daily', priority: 0.9 },
  { path: '/settings', changeFrequency: 'monthly', priority: 0.5 },
];

/**
 * The site's own origin, without a trailing slash.
 *
 * `NEXT_PUBLIC_SITE_URL` is not set in every environment — a preview build or a
 * fresh clone has none — and `new URL(undefined)` throws, so the fallback is
 * the one Next serves locally. Same guard as `siteHost()` in
 * `src/lib/og/cards.jsx`.
 */
function siteBase() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim()).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/** `/movies/550-fight-club`, `/tv/1399-game-of-thrones`. */
function detailPath(item) {
  return `/${item.mediaType === 'tv' ? 'tv' : 'movies'}/${toSlugId(item.id, item.title)}`;
}

export default async function sitemap() {
  const base = siteBase();

  const feeds = await Promise.all(
    // A missing or rate-limited TMDB key must not break the sitemap — the
    // fixed pages are still worth publishing, so a failed feed contributes
    // nothing rather than throwing the whole route.
    FEEDS.map((key) => getFeed(key, { limit: 20 }).catch(() => [])),
  );

  // The same title can appear in several feeds, and a sitemap should not list
  // a URL twice.
  const seen = new Set();
  const titles = [];

  for (const item of feeds.flat()) {
    const path = detailPath(item);
    if (seen.has(path)) continue;

    seen.add(path);
    titles.push({
      url: `${base}${path}`,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  return [
    ...STATIC_PAGES.map((page) => ({
      url: `${base}${page.path}`,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...titles,
  ];
}
