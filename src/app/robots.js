import site from '@config/site';

/**
 * ============================================================================
 *  ROBOTS.TXT
 * ============================================================================
 *
 *  Served at `/robots.txt`, and the first thing a crawler asks for.
 *
 *  WHAT IS NOT HERE, AND WHY
 *
 *  There is no `Disallow: /watch/`. That looks like an oversight next to the
 *  `noindex` on those pages, and it is the opposite — it is the whole point.
 *
 *  A URL blocked in robots.txt is never fetched, so a crawler can never read
 *  the `noindex` on it. Google is explicit that a Disallowed URL may still be
 *  indexed (from links pointing at it) and will appear in results as a bare
 *  link with no description, because the page itself was never allowed to say
 *  "do not index me".
 *
 *  The way to keep a page out of the index is to let it be crawled and let it
 *  say so itself, which is what `robots: { index: false }` on the watch pages
 *  does. So `/watch/` is absent from the sitemap, absent from here, and carries
 *  `noindex` on the page: three signals that agree instead of two that fight.
 *
 *  `/api/` is a different case — those are JSON endpoints with no HTML to
 *  carry a directive, so blocking them outright is correct.
 * ============================================================================
 */
export default function robots() {
  const base = siteBase();

  // `site.seo.allowIndexing` stays the one switch for the whole site: turning
  // it off disables crawling here, and `layout.js` already sets `noindex` on
  // every page from the same flag.
  if (!site.seo.allowIndexing) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${base}/sitemap.xml`,
  };
}

/** Same guard as `src/lib/og/cards.jsx` — the variable is unset in previews. */
function siteBase() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim()).origin;
  } catch {
    return 'http://localhost:3000';
  }
}
