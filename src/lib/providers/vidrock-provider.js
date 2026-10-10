/**
 * What viewers are told this source is called.
 *
 * A codename, like every provider here — see the contract in
 * `src/lib/providers/index.js`. Alpha, Neon and Gamma are taken. Vega belonged
 * to a provider that was removed, and it is left alone rather than reused: a
 * name a viewer has already seen on one source should not turn up on another.
 */
const CODENAME = 'Delta';

/**
 * A stream, pointed through our proxy.
 *
 * There is only ever one, and it is proxied unconditionally. The host behind
 * this provider answers 403 to a request without a `Referer`, and gates its
 * segments to `https://vidrock.net` with CORS, so a browser here can read
 * neither the playlist nor the fragments. Both are things the page cannot work
 * around and the server can — see `src/app/api/vidrock/proxy/route.js`.
 *
 * Relative, and deliberately so. This runs in the browser, so it has to resolve
 * against whatever origin the page was served from; an absolute URL would have
 * to be built on the server, where the scheme is not necessarily the one the
 * viewer is using, and behind a proxy that terminates TLS it would be the wrong
 * one.
 */
function proxied(url) {
  return `/api/vidrock/proxy?url=${encodeURIComponent(url)}`;
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

    if (!response.ok) throw new Error(`Vidrock resolution failed (${response.status}).`);

    const { streams } = await response.json();
    if (!Array.isArray(streams) || streams.length === 0) return null;

    const stream = streams.find((entry) => typeof entry?.url === 'string' && entry.url.length > 0);
    if (!stream) return null;

    /**
     * One source, and no `width` or `height` on it.
     *
     * The stream is a single rendition — a media playlist with no
     * `#EXT-X-STREAM-INF` and no `RESOLUTION` line anywhere — so there is no
     * ladder to hand over and nothing in the manifest for `measureStream` to
     * read. It measures `null`, and a null measurement compares as zero, so this
     * provider is never the one `resolveBestPlayback` picks while any other
     * provider has an answer for the title.
     *
     * That is the honest arrangement and it is deliberate rather than a gap left
     * open. The contract in `index.js` allows a provider to declare a resolution
     * it knows without being asked; this one does not know one. Vidrock does not
     * know either — its own player offers no quality choice for this server and
     * shows "Auto" — so declaring 1080p here would be inventing a number to win
     * a comparison with, which is exactly the failure the contract warns about.
     *
     * What it leaves is a provider that plays when nobody else has the title and
     * stays out of the way when they do. Coverage is the thing it adds: about
     * two titles in five have an Atlas copy and several of those are titles the
     * other providers answer with nothing, which is the case it exists for. A
     * viewer who wants it on a title that was won on resolution has the source
     * menu, and it is listed there like any other.
     */
    return {
      sources: [
        {
          src: proxied(stream.url),
          type: 'application/x-mpegURL',
          label: CODENAME,
        },
      ],

      // No `tracks`. Vidrock serves 106 subtitle files for a film and none of
      // them is taken: there is no Kurdish among them, the English ones repeat
      // the same dialogue nine times over, and the first cue of each is an
      // advertisement for the service. The account is in
      // `src/lib/providers/vidrock.js`.
    };
  },
};
