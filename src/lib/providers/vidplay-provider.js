/**
 * ============================================================================
 *  VIDPLAY — the provider
 * ============================================================================
 *  The browser half of the lookup: ask our own route for the addresses, then
 *  hand each one to the player through the proxy, because neither the request
 *  nor the response for a stream is something a page can make on its own. The
 *  account of both is in `src/app/api/vidplay/proxy/route.js`.
 * ============================================================================
 */

/**
 * What viewers are told this source is called.
 *
 * A codename, like every provider here — see the contract in
 * `src/lib/providers/index.js`. Alpha, Neon and Delta are taken; Vega belonged
 * to a provider that was removed and is left alone rather than reused.
 */
const CODENAME = 'Onyx';

/**
 * A stream, pointed through our proxy, carrying the headers it is gated on.
 *
 * The player page and its origin travel as query parameters rather than sitting
 * in the route as constants, exactly as `videasy-provider.js` passes them, and
 * for the same reason: the host rotates per title, so the pair belongs to the
 * stream rather than to the provider.
 *
 * Relative, and deliberately so — this runs in the browser and has to resolve
 * against whatever origin the page was served from.
 */
function proxiedStreamUrl(url, playback) {
  const query = new URLSearchParams({
    url,
    referer: playback.playerFullUrl,
    origin: playback.origin,
  });
  return `/api/vidplay/proxy?${query}`;
}

export default {
  id: 'vidplay',
  label: CODENAME,

  async resolve({ mediaType, tmdbId, season, episode, signal }) {
    const response = await fetch('/api/vidplay/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType, tmdbId, season, episode }),
      signal,
    });

    if (!response.ok) throw new Error(`Vidplay resolution failed (${response.status}).`);

    const playback = await response.json();
    if (!Array.isArray(playback.streamUrls) || playback.streamUrls.length === 0) return null;

    return {
      sources: playback.streamUrls.map((url, index) => ({
        src: proxiedStreamUrl(url, playback),
        type: 'application/x-mpegURL',
        label: `${CODENAME} ${index + 1}`,
      })),
    };
  },
};
