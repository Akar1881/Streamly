/**
 * ============================================================================
 *  BEENAMA — the lookup
 * ============================================================================
 *  One title in, a ladder of MP4 rungs out. Unlike the other two providers this
 *  is neither a fan-out nor a playlist: one request, and the answer arrives with
 *  the whole ladder in it and every resolution already spelled out.
 *
 *  Server-side only, and that is a requirement rather than a preference. The
 *  request goes out with a `Referer` and a `User-Agent`, both of which are on the
 *  browser's forbidden-header list — a `fetch` from the page drops them silently
 *  and sends the site's own origin instead — so this runs in a route handler and
 *  the player only ever sees the URLs that come out of it.
 *
 *  ---------------------------------------------------------------------------
 *  Why nothing here is measured later
 *  ---------------------------------------------------------------------------
 *
 *  These are progressive MP4 files, not HLS. `deliveryType` is `"file"` and the
 *  `playlist` field beside it is empty, which is why the sources this returns
 *  declare `video/mp4` and why `measureStream` — which reads HLS manifests and
 *  nothing else — would answer null for every one of them. It does not have to
 *  read anything: each quality arrives carrying its own `width`, `height` and
 *  `codec`. Those are what this hands on, and `resolveBestPlayback` in
 *  `src/lib/providers/index.js` knows how to use a stated resolution when the
 *  probe has none.
 *
 *  The media host is no trouble at all, which makes this provider the odd one
 *  out among the three: it wants no `Referer`, and it answers with
 *  `Access-Control-Allow-Origin: *`, so there is nothing to proxy and the player
 *  fetches the file directly. See `src/app/api/beenama/proxy/` — there is no such
 *  directory, and that is the point.
 *
 *  ---------------------------------------------------------------------------
 *  No subtitles, deliberately
 *  ---------------------------------------------------------------------------
 *
 *  A reply carries fifteen caption files and none of them is used. They are
 *  served from a CDN that sends no CORS header at all, so none could be handed
 *  to a player as a track; and the one that reads like Kurdish is not.
 *  `هَرْشٜن هَوْس` is "Harshen Hausa" — Hausa in Ajami. Titles get their
 *  subtitles from this site's own pipeline, as they do for every provider.
 * ============================================================================
 */

const API_BASE_URL = 'https://beenama.com';

/**
 * What this API wants to see.
 *
 * Two of the three are forbidden to a browser, which is the whole reason the
 * lookup is here rather than in the provider. Measured, not guessed: without the
 * `Referer` the request is refused, and the `Accept` matters because the default
 * `*&#47;*` invites an HTML error page with a 200 on it.
 */
const HEADERS = {
  Accept: 'application/json',
  Referer: `${API_BASE_URL}/`,
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
};

/**
 * How long the lookup gets before it counts as failed.
 *
 * One request rather than ten, so this is a plain wait for an answer and not a
 * fan-out's budget. It is still a deadline: a host that accepts the connection
 * and then says nothing would otherwise hold the watch page's resolve open until
 * the platform's own limit, and the viewer would get a spinner and keep it.
 */
const LOOKUP_TIMEOUT_MS = 8000;

/** Whether a quality in the reply is one a player can be given. */
function isUsable(quality) {
  return typeof quality?.url === 'string' && quality.url.length > 0;
}

/**
 * One rung, in the shape the player's contract describes.
 *
 * `type` is fixed rather than copied off the reply. Every entry in it says
 * `video/mp4` and every entry is one, and this is the field the player uses to
 * choose between hls.js and a plain `<video>` — a value that disagreed with the
 * file behind it would hand an MP4 to hls.js, where it plays nothing.
 */
function toStream(quality) {
  const height = Number(quality.height) || 0;

  return {
    url: quality.url,
    type: 'video/mp4',
    width: Number(quality.width) || 0,
    height,
    codec: String(quality.codec ?? ''),
    quality: quality.quality ?? (height ? `${height}p` : 'Auto'),
  };
}

/**
 * The ladder, widest first.
 *
 * Sorted on width rather than height, for the reason `quality.js` sets out at
 * length: height moves with the film's aspect ratio, so a 720p copy of a scope
 * film and a 480p copy of a 16:9 one are not two numbers on the same scale.
 * Width is the resolution class and does not move with the letterbox.
 *
 * A reply this does not recognise — no `stream`, no `qualities`, a shape that
 * has changed since this was written — yields an empty list rather than an
 * error, because not carrying a title is an ordinary answer here and the API
 * says so with a 200 and no stream in it at all. There is nothing in a reply
 * that separates "we do not have this film" from "we do not understand you".
 */
function readStreams(data) {
  const qualities = data?.stream?.stream?.qualities;
  if (!Array.isArray(qualities)) return [];

  return qualities
    .filter(isUsable)
    .map(toStream)
    .sort((a, b) => b.width - a.width);
}

/**
 * Every stream this provider has for a title.
 *
 * @param {object} request
 * @param {number|string} request.tmdbId
 * @param {'movie'|'tv'} [request.mediaType]
 * @param {number} [request.season]   episodes only
 * @param {number} [request.episode]  episodes only
 * @param {AbortSignal} [request.signal]  the caller's, so a viewer who leaves
 *        the page takes the lookup with them
 * @returns {Promise<{streams: Array<{url: string, type: string, width: number,
 *          height: number, codec: string, quality: string}>}>} — empty when the
 *          title is not carried
 * @throws when the request itself failed, which is a different thing and is
 *         worth saying out loud — see the status check below
 */
export async function inspectBeenama({
  tmdbId,
  mediaType = 'movie',
  season = null,
  episode = null,
  signal,
}) {
  if (!tmdbId) throw new Error('tmdbId is required for Beenama');

  const path =
    mediaType === 'tv'
      ? `/api/v/${tmdbId}/${season}/${episode}`
      : `/api/v/${tmdbId}`;

  /**
   * The deadline covers the body, not just the wait for headers.
   *
   * The reply is small, so the difference is small too — but it is the same
   * arrangement `askServer` uses in `vidnest.js`, and for the same reason: an
   * abort that is disarmed once the headers land is an abort that does nothing
   * about the part that can hang.
   */
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: controller.signal,
    });

    // A title this API does not carry is a 200 with no stream in it, so a
    // status that is not ok is the host failing rather than the title being
    // absent — a different sentence to whoever reads the log, and a different
    // one to the viewer. Let it throw.
    if (!response.ok) throw new Error(`Beenama answered ${response.status}`);

    return { streams: readStreams(await response.json()) };
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
