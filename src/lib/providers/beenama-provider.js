/**
 * What viewers are told this source is called.
 *
 * A codename, like every provider here — see the contract in
 * `src/lib/providers/index.js`. Alpha and Neon are taken. Vega belonged to a
 * provider that was removed, and it is left alone rather than reused: a name a
 * viewer has already seen on one source should not turn up on another.
 */
const CODENAME = 'Gamma';

/**
 * The codec string the browser is asked about.
 *
 * Not a specific stream — nothing here knows anything about a stream — but the
 * question `canPlayType` answers is really "does this browser have an HEVC
 * decoder at all", and any well-formed HEVC codec string gets at that.
 */
const HEVC_CODEC = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

/**
 * Whether this browser can decode HEVC, as far as it will say.
 *
 * It is worth asking because this provider is almost entirely HEVC: 26 of the 27
 * rungs measured across eleven titles were, against one h264. Safari and iOS
 * decode that in hardware, and so does Chrome wherever the platform has a
 * decoder to hand it — Windows, macOS, Android, ChromeOS. On Linux, Chrome and
 * Firefox do not, and a viewer there gets a black screen from a stream that was
 * otherwise perfectly good.
 *
 * `''` is the only answer read as no. `maybe` and `probably` both mean the
 * browser is willing to try, and this is no place to be more certain than the
 * browser is about itself.
 */
function canPlayHevc() {
  // No DOM means this is not a browser at all — a prerender, a test. Nothing is
  // known, so nothing is given up: the widest rung is taken, which is what a
  // provider that asked no question would do.
  if (typeof document === 'undefined') return true;

  const probe = document.createElement('video');
  if (typeof probe.canPlayType !== 'function') return true;

  return probe.canPlayType(HEVC_CODEC) !== '';
}

/**
 * The rung to play, out of the ladder the route returned.
 *
 * The widest one, with one exception: when it is HEVC and this browser has said
 * it cannot decode HEVC, an h264 rung is taken instead if the title has one.
 * That exception carries most of this provider's weight on desktop Linux, and it
 * can only ever cost picture quality — never the picture. When there is no h264
 * rung to fall back to, the HEVC one is still the right answer, because it may
 * work and the alternative is nothing at all.
 */
function choose(streams) {
  const best = streams[0];
  if (!best || !/hevc|h265/i.test(best.codec) || canPlayHevc()) return best ?? null;

  return streams.find((stream) => !/hevc|h265/i.test(stream.codec)) ?? best;
}

export default {
  id: 'beenama',
  label: CODENAME,

  async resolve({ mediaType, tmdbId, season, episode, signal }) {
    const response = await fetch('/api/beenama/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType, tmdbId, season, episode }),
      signal,
    });

    if (!response.ok) throw new Error(`Beenama resolution failed (${response.status}).`);

    const { sources } = await response.json();
    if (!Array.isArray(sources) || sources.length === 0) return null;

    const stream = choose(sources);
    if (!stream?.url) return null;

    /**
     * One source, not the ladder.
     *
     * The player attaches `sources[0]` and has no way to reach a second one —
     * `VideoPlayer` reads the index-nought entry and stops — and unlike HLS
     * there is no quality menu here to choose from, because there is no manifest
     * and so no levels to list. Handing over the rungs below would be a list
     * nothing can reach.
     *
     * `width` and `height` are carried out because this provider is the reason
     * they exist on a source at all. There is no manifest for `measureStream` to
     * read, so without them this stream would compare as zero against every
     * other provider's and lose to a 480p HLS. See the contract in
     * `src/lib/providers/index.js`.
     */
    return {
      sources: [
        {
          src: stream.url,
          type: 'video/mp4',
          label: stream.height ? `${CODENAME} ${stream.height}p` : CODENAME,
          width: stream.width,
          height: stream.height,
        },
      ],
    };
  },
};
