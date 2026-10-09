/**
 * What viewers are told this source is called.
 *
 * A codename, like every provider here — see the contract in
 * `src/lib/providers/index.js`. This one needs it as much as any of them: behind
 * it are several upstream servers with names of their own, and while the resolve
 * route already strips those before they leave the server, the rule is applied
 * at every layer rather than assumed to have been applied at the last one.
 *
 * `Vega` was chosen over the obvious names — `Nova`, `Atlas`, `Orion` — because
 * those are what the servers are actually called, and a codename that happens to
 * be the real name is not a codename.
 */
const CODENAME = 'Vega';

/**
 * Where a stream has to be fetched from.
 *
 * Every one of these goes through our own proxy, and not as a precaution: the
 * hosts reject a request without a `Referer` and an `Origin` of `vidrock.net`,
 * and both of those are on the browser's forbidden-header list, so a viewer
 * fetching one of these directly gets a 404 and no explanation. The proxy sends
 * them, and unwraps what comes back.
 *
 * Unlike Videasy's, this URL carries nothing but the destination — the headers
 * are constants that live on the server, so there is no reason to repeat them
 * across a few thousand segment URLs.
 */
function proxiedStreamUrl(url) {
  return `/api/vidrock/proxy?${new URLSearchParams({ url })}`;
}

/**
 * The reply's own type tag, translated to what a `<video>` element understands.
 *
 * `isHls` in `src/lib/player/source.js` reads a MIME type, not a nickname, and
 * it only falls back to inspecting the URL when the type is missing entirely.
 * Handing it `'hls'` — which is what the source sends — is not "unknown", it is
 * a string that fails the `/mpegurl/i` test, so the player would take a playlist
 * for a plain file and hand it to `<video src>`, where it plays nothing.
 */
function mimeType(stream) {
  if (/mpegurl|hls/i.test(stream.type ?? '')) return 'application/x-mpegURL';
  if (/\.m3u8(\?|#|$)/i.test(stream.url)) return 'application/x-mpegURL';
  return 'video/mp4';
}

export default {
  id: 'vidrock',
  label: CODENAME,

  async resolve({ mediaType, tmdbId, season, episode, signal }) {
    const response = await fetch('/api/vidrock/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType, tmdbId, season, episode }),
      signal,
    });

    if (!response.ok) throw new Error(`VidRock resolution failed (${response.status}).`);

    const { streams, subtitles } = await response.json();
    if (!Array.isArray(streams) || streams.length === 0) return null;

    /**
     * Order is load-bearing even though every entry is listed.
     *
     * Only the first source is attached when playback starts, so index 0 is what
     * decides whether this provider plays at all — and the dead server is not
     * necessarily last. `inspectVidrock` drops the ones whose token will not
     * open, and now also the ones whose host will not serve a playlist, but a
     * server can pass both of those and still fail later — so `Vega 1` failing
     * over to `Vega 2` is still one click.
     *
     * The order is the server's, and it is by picture size descending. That is
     * what makes the first entry the one worth playing; see `rankStreams`.
     */
    return {
      sources: streams
        .filter((stream) => typeof stream.url === 'string' && stream.url.length > 0)
        .map((stream, index) => ({
          src: proxiedStreamUrl(stream.url),
          type: mimeType(stream),
          label: `${CODENAME} ${index + 1}`,
          // What the server measured this stream at, when it could, and the
          // reason the first entry is the one that plays: the servers here are
          // not alternative routes to one file, they are different files, and
          // they arrive in the order the provider happens to list them.
          quality: stream.quality ?? null,
        })),

      /**
       * Every subtitle the source has, which is a great many — a popular film
       * runs to a hundred-odd, and the duplicates are spelled out rather than
       * collapsed (`Arabic`, `Arabic2` … `Arabic5`). They are handed on as they
       * arrive and reduced in the captions menu, which is the only place with
       * both the whole list in hand and a reason to care which of them a viewer
       * actually wants to see.
       *
       * These need no proxy: they are served from a different host that sends
       * `Access-Control-Allow-Origin: *` and asks for no referer.
       */
      tracks: (Array.isArray(subtitles) ? subtitles : [])
        .filter((track) => typeof track.url === 'string' && track.url.length > 0)
        .map((track) => ({
          src: track.url,
          label: track.lang ?? 'Unknown',
        })),
    };
  },
};
