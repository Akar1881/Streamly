/**
 * ============================================================================
 *  PROVIDER: vidsrc
 * ============================================================================
 *
 *  One file per playback provider. Each exports a `movie` and an `episode`
 *  builder and knows nothing about the rest of the app: it is handed a base URL
 *  and some ids, and returns an embed URL — or `null` if it cannot.
 *
 *  The base URL comes from `config/site.js` → `player.servers`, so the same
 *  provider can be listed twice against two mirrors with no code change.
 *
 *  Reference: https://vidsrc.sh/vidsrc/docs/
 * ============================================================================
 */

import { withQuery } from './url';

/**
 * https://vidsrc.sh/embed/movie/{id}?autoplay=1
 *
 * Documented with an IMDB id ("tt1300854"), so that is preferred when TMDB gave
 * us one. TMDB returns `imdb_id` on the movie detail response, so this costs
 * nothing extra — see `shapeMovie` in src/lib/tmdb/movies.js.
 */
function movie(base, { tmdbId, imdbId, autoplay }) {
  const id = imdbId || tmdbId;
  if (!id) return null;
  return withQuery(`${base}/movie/${id}`, { autoplay: autoplay ? 1 : null });
}

/**
 * https://vidsrc.sh/embed/tv/{tmdbId}/{season}/{episode}
 *
 * Documented with a TMDB id, so there is no IMDB fallback here.
 */
function episode(base, { tmdbId, season, episode, autoplay }) {
  if (!tmdbId || !season || !episode) return null;
  return withQuery(`${base}/tv/${tmdbId}/${season}/${episode}`, {
    autoplay: autoplay ? 1 : null,
  });
}

export default { id: 'vidsrc', movie, episode };
