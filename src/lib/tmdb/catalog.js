import site from '@config/site';
import { pickLogo } from '@/lib/images';
import { tmdbFetch, tmdbFetchSafe } from './client';
import { normaliseMedia } from './normalise';

/**
 * The named feeds the home page can show. `config/site.js` refers to these by
 * key in `home.hero.source` and `home.rows[].source` — add an entry here to
 * make a new feed available to the config.
 */
const SOURCES = {
  trending_all_week: { path: 'trending/all/week', mediaType: null },
  trending_all_day: { path: 'trending/all/day', mediaType: null },
  trending_movie_week: { path: 'trending/movie/week', mediaType: 'movie' },
  trending_tv_week: { path: 'trending/tv/week', mediaType: 'tv' },

  movie_popular: { path: 'movie/popular', mediaType: 'movie' },
  movie_top_rated: { path: 'movie/top_rated', mediaType: 'movie' },
  movie_now_playing: { path: 'movie/now_playing', mediaType: 'movie' },
  movie_upcoming: { path: 'movie/upcoming', mediaType: 'movie' },

  tv_popular: { path: 'tv/popular', mediaType: 'tv' },
  tv_top_rated: { path: 'tv/top_rated', mediaType: 'tv' },
  tv_on_the_air: { path: 'tv/on_the_air', mediaType: 'tv' },
  tv_airing_today: { path: 'tv/airing_today', mediaType: 'tv' },
};

export function isValidSource(key) {
  return Object.hasOwn(SOURCES, key);
}

/**
 * Loads one named feed and normalises it into the shape every card expects.
 *
 * Mixed feeds (`trending/all/*`) carry `media_type` per item; single-type feeds
 * do not, so we stamp it on from the source definition.
 */
export async function getFeed(sourceKey, { limit = 20, page = 1 } = {}) {
  const source = SOURCES[sourceKey];
  if (!source) {
    throw new Error(
      `Unknown home feed "${sourceKey}". Valid keys: ${Object.keys(SOURCES).join(', ')}`,
    );
  }

  const data = await tmdbFetch(source.path, {
    params: { page, region: site.tmdb.region },
    revalidate: site.tmdb.revalidate.catalog,
  });

  return (data.results ?? [])
    .map((item) => normaliseMedia(item, source.mediaType))
    // Mixed feeds also return people, which have no poster and no detail page.
    .filter((item) => item.mediaType === 'movie' || item.mediaType === 'tv')
    .slice(0, limit);
}

/**
 * The hero needs each title's logo artwork, which the list endpoints do not
 * return. Fetch them in parallel and attach; a title with no logo simply falls
 * back to text in the UI.
 */
async function attachLogos(items) {
  const language = site.tmdb.language.split('-')[0];

  return Promise.all(
    items.map(async (item) => {
      const data = await tmdbFetchSafe(
        `${item.mediaType}/${item.id}/images`,
        {
          params: { include_image_language: `${language},null` },
          revalidate: site.tmdb.revalidate.detail,
        },
        null,
      );

      return { ...item, logoPath: pickLogo(data?.logos ?? [], language) };
    }),
  );
}

/** Loads every row the config asks for, in parallel. */
export async function getHomeFeeds() {
  const rows = site.home.rows;

  const [hero, ...results] = await Promise.all([
    getFeed(site.home.hero.source, { limit: site.home.hero.limit }),
    ...rows.map((row) => getFeed(row.source, { limit: row.limit })),
  ]);

  return {
    hero: await attachLogos(hero),
    rows: rows.map((row, index) => ({ ...row, items: results[index] })),
  };
}
