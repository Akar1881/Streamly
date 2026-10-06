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
 * vidsrc's custom subtitle options, from
 * https://vidsrc.sh/embed/movie/tt1300854?sub_url=https://example.com/en.vtt&sub_label=English&sub_lang=en
 *
 * The file is downloaded and converted by the *viewer's browser* — vidsrc's
 * servers never fetch it. So `sub_url` has to be a URL that browser can reach
 * and whose host sends `Access-Control-Allow-Origin`, which is exactly what
 * `/api/subtitles/[file]` exists to provide. A URL only this server could
 * reach (localhost, an internal host) would silently never load.
 *
 * `sub_lang` is the ISO 639-1 code: it is what lets the player show the track
 * under the right language rather than "unknown".
 */
function subtitleParams(subtitle) {
  if (!subtitle?.url) return {};

  return {
    sub_url: subtitle.url,
    sub_label: subtitle.label,
    sub_lang: subtitle.lang,
  };
}

/**
 * https://vidsrc.sh/embed/movie/{id}?autoplay=1
 *
 * Documented with an IMDB id ("tt1300854"), so that is preferred when TMDB gave
 * us one. TMDB returns `imdb_id` on the movie detail response, so this costs
 * nothing extra — see `shapeMovie` in src/lib/tmdb/movies.js.
 */
function movie(base, { tmdbId, imdbId, autoplay, subtitle }) {
  const id = imdbId || tmdbId;
  if (!id) return null;
  return withQuery(`${base}/movie/${id}`, {
    autoplay: autoplay ? 1 : null,
    ...subtitleParams(subtitle),
  });
}

/**
 * https://vidsrc.sh/embed/tv/{tmdbId}/{season}/{episode}
 *
 * Documented with a TMDB id, so there is no IMDB fallback here.
 */
function episode(base, { tmdbId, season, episode, autoplay, subtitle }) {
  if (!tmdbId || !season || !episode) return null;
  return withQuery(`${base}/tv/${tmdbId}/${season}/${episode}`, {
    autoplay: autoplay ? 1 : null,
    ...subtitleParams(subtitle),
  });
}

export default { id: 'vidsrc', supportsSubtitles: true, movie, episode };
