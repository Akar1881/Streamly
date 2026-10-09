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
          src: stream.url,
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
          src: subtitleSource(track.url),
          label: track.lang ?? 'Unknown',
        })),
    };
  },
};

/**
 * One upstream's subtitle link, as something the browser can actually fetch.
 *
 * One server hands back `/sub/<base64>` — a path relative to its own fetch
 * endpoint, carrying the target URL and the `Referer` that target demands. The
 * browser resolves it against *this* origin, where nothing lives, so every one
 * of those tracks was a 404; and it could not fetch the target directly anyway,
 * because the header it needs is one a page is not allowed to send. So it goes
 * through `/api/vidnest/subtitle`, which opens the payload and does both on the
 * server. See that route for the rest.
 *
 * Everything else — the servers that return a plain absolute URL — is handed on
 * untouched.
 */
function subtitleSource(url) {
  if (!url.startsWith('/sub/')) return url;
  return `/api/vidnest/subtitle?p=${encodeURIComponent(url.slice('/sub/'.length))}`;
}
