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
 * A stream, pointed through our proxy.
 *
 * Every one of them, and that is not caution. The hosts behind this provider do
 * not let a browser read what they serve: one group gates CORS by origin and
 * allows `vidnest.fun` — and, apparently by oversight, `localhost` — while
 * refusing the domain this site is actually deployed on, and another group wants
 * a `Referer` and sends no CORS header at all. The first of those is invisible on
 * a development machine and fatal in production, which is precisely how it was
 * found: Neon measured 2160p and played locally, showed no quality at all on
 * Vercel, and played nothing.
 *
 * The route does the fetching instead, with the headers those hosts want, and
 * rewrites the playlists so the segments come the same way. It is the same
 * arrangement `videasy-provider.js` uses, and the same reason.
 *
 * Relative, and deliberately so. This runs in the browser, so it has to resolve
 * against whatever origin the page was served from; an absolute URL would have
 * to be built on the server, where the scheme is not necessarily the one the
 * viewer is using, and behind a proxy that terminates TLS it would be the wrong
 * one.
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

    const { streams } = await response.json();
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
          src: proxied(stream.url),
          type: mimeType(stream),
          label: `${CODENAME} ${index + 1}`,
        })),

      // No `tracks`, and that is the decision rather than an omission. The
      // servers behind this provider do not hand back a subtitle a player can
      // use, so none is offered — the site's own pipeline finds one instead,
      // which is what every viewer was getting anyway. The account is in
      // `src/lib/providers/vidnest.js`, where those links are dropped.
    };
  },
};
