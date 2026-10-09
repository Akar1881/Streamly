/**
 * What viewers are told this source is called.
 *
 * A codename, like every provider here — see the contract in
 * `src/lib/providers/index.js`. It matters more for this one than for Videasy,
 * because Vidnest does not host anything itself: it asks ten upstream servers
 * and passes through whichever answer. Those servers have names, those names
 * reach us in every reply, and not one of them is ever allowed to reach the
 * viewer. A stream is "Neon 1" or "Neon 2".
 *
 * The route also drops those names before it answers, so they do not reach the
 * browser either; this is the second line of the same defence, not the only one.
 */
const CODENAME = 'Neon';

/**
 * The reply's own type tag, translated to what a `<video>` element understands.
 *
 * `isHls` in `src/lib/player/source.js` reads a MIME type, not a nickname, and
 * it only falls back to inspecting the URL when the type is missing entirely.
 * Handing it `'hls'` — which is what these servers send — is not "unknown", it
 * is a string that fails the `/mpegurl/i` test, so the player would take a
 * master playlist for a plain file and hand it to `<video src>`, where it plays
 * nothing. So translate rather than pass through.
 */
function mimeType(stream) {
  if (/mpegurl|hls/i.test(stream.type ?? '')) return 'application/x-mpegURL';
  if (/\.m3u8(\?|#|$)/i.test(stream.url)) return 'application/x-mpegURL';
  return 'video/mp4';
}

/**
 * A stream the browser cannot fetch for itself, pointed through our proxy.
 *
 * One of the ten servers behind this provider answers on a bare rotating host
 * that returns 404 to anything without a `Referer` and sends no CORS header at
 * all, so the page can never read its streams however it asks for them. The
 * route does the asking instead, with the header, and rewrites the playlists so
 * the segments come the same way — see `src/app/api/vidnest/proxy/route.js`.
 *
 * Relative, and deliberately so. This runs in the browser, so it has to resolve
 * against whatever origin the page was served from; an absolute URL would have
 * to be built on the server, where the scheme is not necessarily the one the
 * viewer is using, and behind a proxy that terminates TLS it would be the wrong
 * one. `videasy-provider.js` makes the same choice for the same reason.
 */
function proxied(url) {
  return `/api/vidnest/proxy?url=${encodeURIComponent(url)}`;
}

export default {
  id: 'vidnest',
  label: CODENAME,

  async resolve({ mediaType, tmdbId, season, episode, signal }) {
    const response = await fetch('/api/vidnest/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType, tmdbId, season, episode }),
      signal,
    });

    if (!response.ok) throw new Error(`Vidnest resolution failed (${response.status}).`);

    const { streams, subtitles } = await response.json();
    if (!Array.isArray(streams) || streams.length === 0) return null;

    /**
     * Order is load-bearing even though every entry is listed.
     *
     * Only the first source is attached when playback starts, so the one at
     * index 0 is the one that decides whether this provider works at all. The
     * server returns its answers in a fixed order settled by `Promise.allSettled`
     * — dead servers drop out, live ones keep their place — and the working
     * server happens to sit late in that list, which is exactly why the six
     * servers ahead of it returning nothing is what puts it first here. That is
     * luck on this title and not a guarantee on the next, so nothing here
     * reorders or filters: whatever the server could not answer is already gone,
     * and that is the only ordering signal that means anything.
     */
    return {
      sources: streams
        .filter((stream) => typeof stream.url === 'string' && stream.url.length > 0)
        .map((stream, index) => ({
          src: stream.proxy ? proxied(stream.url) : stream.url,
          type: mimeType(stream),
          label: `${CODENAME} ${index + 1}`,
        })),

      // Whatever subtitles came back with the streams. Passed through as they
      // arrive, duplicates and all: collapsing them is a decision about what a
      // menu should look like, and `src/lib/player/tracks.js` is where the
      // player's menu makes it — for every provider at once, rather than each
      // provider guessing at what the others will send.
      //
      // `label` is the language as the upstream server wrote it, which is the
      // only name these files have.
      tracks: (Array.isArray(subtitles) ? subtitles : [])
        .filter((track) => typeof track?.url === 'string' && track.url.length > 0)
        .map((track) => ({
          src: track.url,
          label: track.lang ?? 'Unknown',
        })),
    };
  },
};
