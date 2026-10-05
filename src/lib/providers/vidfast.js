/**
 * ============================================================================
 *  PROVIDER: VidFast
 * ============================================================================
 *
 *  Documentation: https://vidfast.vc/
 *
 *  Takes a TMDB id for both shapes, so unlike vidsrc it needs no IMDB id
 *  anywhere — playback works for titles TMDB has no IMDB id for, and for TV,
 *  where TMDB never returns one.
 *
 *  Its other documented query options, if you want more than autoplay:
 *
 *    title · poster          show the title / poster inside the player
 *    startAt                 start at a number of seconds
 *    theme                   player colour, hex without the '#' (e.g. 16A085)
 *    sub                     default subtitle, e.g. 'en'
 *    server                  which of the provider's own servers to use
 *    hideServer · fullscreenButton · chromecast
 *    nextButton + autoNext   TV only — its own next-episode button
 *
 *  They are ordinary query-string params; add them to the two calls below.
 * ============================================================================
 */

import { withQuery } from './url';

/** https://vidfast.vc/movie/{id}?autoPlay=true */
function movie(base, { tmdbId, imdbId, autoplay }) {
  const id = tmdbId || imdbId;
  if (!id) return null;
  return withQuery(`${base}/movie/${id}`, { autoPlay: autoplay ? 'true' : null });
}

/** https://vidfast.vc/tv/{id}/{season}/{episode}?autoPlay=true */
function episode(base, { tmdbId, imdbId, season, episode, autoplay }) {
  const id = tmdbId || imdbId;
  if (!id || !season || !episode) return null;
  return withQuery(`${base}/tv/${id}/${season}/${episode}`, {
    autoPlay: autoplay ? 'true' : null,
  });
}

export default { id: 'vidfast', movie, episode };
