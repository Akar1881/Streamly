import site from '@config/site';
import { SEGMENT_ORDER } from '@/lib/player/segments';

/**
 * ============================================================================
 *  INTRODB  (server-side only)
 * ============================================================================
 *  The intro, recap and outro timestamps for a title, from introdb.app — a
 *  public, community-maintained database of them. Reads are anonymous, so this
 *  holds no key; the only reason it is a server module at all is that the
 *  service answers with `Access-Control-Allow-Origin: https://introdb.app`, and
 *  a browser cannot read a response that names somebody else's origin.
 *
 *  It is keyed on an IMDb id rather than a TMDB one. TMDB hands a film's over
 *  directly and a show's only on request, which is why the caller has to arrive
 *  with one already in hand — see `getShow` in `src/lib/tmdb/tv.js`.
 *
 *  ---------------------------------------------------------------------------
 *  Nothing here is allowed to fail loudly
 *  ---------------------------------------------------------------------------
 *
 *  A skip button is a convenience on top of a stream that plays with or without
 *  it. A title the community has never covered, a service that is down, a
 *  request that times out — all of them mean the same thing to the viewer, which
 *  is that the episode plays normally and no button appears. So every failure
 *  returns `null` rather than throwing, and the caller never has to catch.
 *
 *  The response is four slots — `intro`, `recap`, `outro`, `post_credits` — each
 *  either an object of timestamps or `null`, and the exact set differs per
 *  title. Only the three the player draws are kept; `post_credits` is a scene
 *  after the credits, which is something to watch rather than something to skip.
 * ============================================================================
 */

/** The three ranges the player offers to skip, and the order they appear in. */
const TYPES = SEGMENT_ORDER;

/**
 * One slot of the response, or `null` if it is absent or unusable.
 *
 * `start_sec`/`end_sec` are whole seconds and already the friendlier of the two
 * shapes the API emits. A range that ends where it starts is a submission with
 * nothing in it, and one that runs past the other way round is nonsense — both
 * are dropped rather than drawn as a zero-width band on the seek bar.
 */
function readRange(slot) {
  if (!slot) return null;

  const start = Number(slot.start_sec);
  const end = Number(slot.end_sec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end <= start) return null;

  return { start, end };
}

/**
 * The skippable ranges for one title, normalised to `{ recap, intro, outro }`.
 *
 * @param {object} request
 * @param {string} request.imdbId      an IMDb id; without one there is nothing to ask for
 * @param {number} [request.season]    episodes only
 * @param {number} [request.episode]   episodes only
 * @param {boolean} [request.isMovie]  films are queried without a season
 * @returns {Promise<{recap: object|null, intro: object|null, outro: object|null}|null>}
 *          `null` when there is nothing to skip — no id, no data, or a failure.
 */
export async function getSegments({ imdbId, season, episode, isMovie = false } = {}) {
  if (!site.player.skip?.enabled || !imdbId) return null;

  const params = new URLSearchParams({ imdb_id: imdbId });
  if (isMovie) {
    params.set('is_movie', 'true');
  } else {
    params.set('season', String(season));
    params.set('episode', String(episode));
  }

  try {
    const response = await fetch(`${site.player.skip.api}/segments?${params}`, {
      next: { revalidate: site.player.skip.revalidate },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const segments = Object.fromEntries(
      TYPES.map((type) => [type, readRange(data?.[type])]),
    );

    // All three empty is the same answer as a title the service has no row for,
    // and it is the common case: most of the catalogue is uncovered.
    return TYPES.some((type) => segments[type]) ? segments : null;
  } catch {
    return null;
  }
}
