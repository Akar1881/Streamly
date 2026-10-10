import { inspectStream } from './quality';

/**
 * What viewers are told this source is called.
 *
 * A codename, like every provider here — see the contract in
 * `src/lib/providers/index.js`. It matters more for this one than for Videasy,
 * because Vidnest does not host anything itself: it asks eleven upstream
 * servers and passes through whichever answer. Those servers have names, those
 * names reach us in every reply, and not one of them is ever allowed to reach
 * the viewer. A stream is "Neon 1" or "Neon 2".
 *
 * The route also drops those names before it answers, so they do not reach the
 * browser either; this is the second line of the same defence, not the only one.
 */
const CODENAME = 'Neon';

/** Put valid manifests first, widest rendition first, without discarding fallbacks. */
async function rankSources(sources, signal) {
  const inspected = await Promise.all(
    sources.map(async (source, index) => {
      if (!/mpegurl/i.test(source.type ?? '')) {
        return { source, index, available: null, quality: null };
      }

      const { available, quality } = await inspectStream(source.src, { signal, timeoutMs: 2500 });
      return { source, index, available, quality };
    }),
  );

  const rank = (entry) => (entry.available === true ? 0 : entry.available === null ? 1 : 2);
  return inspected
    .sort(
      (left, right) =>
        rank(left) - rank(right) ||
        (right.quality?.width ?? 0) - (left.quality?.width ?? 0) ||
        left.index - right.index,
    )
    .map(({ source }, index) => ({ ...source, label: `${CODENAME} ${index + 1}` }));
}

/**
 * What a stream is, as a MIME type `isHls` in `src/lib/player/source.js` reads.
 *
 * HLS by default, and that is the reversal of the obvious rule rather than a
 * shortcut. Six of the seven servers that answer are HLS, and the ones that are
 * not say so in their own reply — `type: 'mp4'` — so the explicit statement is
 * the rare case and the small one, and the default is the common one and the
 * safe one.
 *
 * Guessing from the URL instead does not work here, which is what the previous
 * version of this file did. The declarations these servers send are `'hls'` and
 * `'mp4'`, not MIME types, so `'hls'` failed a `/mpegurl/i` test and fell
 * through to the URL — and one server's streams carry no extension at all
 * because every rendition is wrapped behind a path of its own, `/hls/<base64>`,
 * which names the real URL out of sight. A master playlist handed to
 * `<video src>` as `video/mp4` plays nothing, and does it silently.
 */
function mimeType(stream) {
  if (/mp4|matroska|webm/i.test(stream.type ?? '')) return 'video/mp4';
  return 'application/x-mpegURL';
}

/**
 * A stream, pointed through our proxy, with the headers its host wants.
 *
 * Every one of them, and that is not caution. These hosts do not let a browser
 * read what they serve: most send no CORS header at all, one gates it by origin
 * and allows `vidnest.fun` — and, apparently by oversight, `localhost` — while
 * refusing the domain this site is deployed on, and another answers 404 to
 * anything arriving without a `Referer`. None of that is something a page can
 * work around, so the proxy fetches instead and rewrites the playlists so the
 * segments come the same way.
 *
 * `referer` and `origin` travel as query parameters, the way
 * `videasy-provider.js` carries them, because they are no longer a constant.
 * While this API was v1 the hosts were one family behind one gate and the pair
 * lived in the route; the servers now answer on hosts of their own, per title,
 * and so the pair belongs to the stream rather than to the provider. A stream
 * whose reply named neither carries none, and the route falls back to the pair
 * it used before.
 *
 * Relative, and deliberately so. This runs in the browser, so it has to resolve
 * against whatever origin the page was served from; an absolute URL would have
 * to be built on the server, where the scheme is not necessarily the one the
 * viewer is using, and behind a proxy that terminates TLS it would be the wrong
 * one.
 */
function proxied(stream) {
  const params = new URLSearchParams({ url: stream.url });
  if (stream.headers?.referer) params.set('referer', stream.headers.referer);
  if (stream.headers?.origin) params.set('origin', stream.headers.origin);
  return `/api/vidnest/proxy?${params}`;
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
     * server returns its answers in the order the servers gave them, and a
     * server with nothing for this title is already gone from the list by the
     * time it gets here — the empty answers are dropped where they are made.
     * That leaves a working stream first whenever there is one, which is the
     * only ordering signal that means anything. Nothing here reorders or
     * filters.
     */
    const sources = streams
        .filter((stream) => typeof stream.url === 'string' && stream.url.length > 0)
        .map((stream, index) => ({
          src: proxied(stream),
          type: mimeType(stream),
          label: `${CODENAME} ${index + 1}`,
        }));

    return {
      sources: await rankSources(sources, signal),

      // No `tracks`, and that is the decision rather than an omission. The
      // servers behind this provider do not hand back a subtitle a player can
      // use, so none is offered — the site's own pipeline finds one instead,
      // which is what every viewer was getting anyway. The account is in
      // `src/lib/providers/vidnest.js`, where those links are dropped.
    };
  },
};
